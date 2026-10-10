import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  ACCENTS,
  AccessDeniedError,
  MIN_AGENT_WALLET_POLICIES,
  PilotError,
  PublishBlockedError,
  type Accent,
  type AgentActivityEvent,
  type PublishCheck,
  type SetupVersion,
  type StudioAccess,
  type StudioDirectory,
  type AgentConfig,
  type CreateAdmission,
  type DraftProfile,
  type Scope,
} from "@pickler/core";
import { tokenAmount } from "./ledger.js";

/** Which unique index a duplicate hit, so the refusal names the field a person can change. */
const WALLET_ASSIGNED = "That wallet already belongs to an agent";
const CONFLICTS: Record<string, string> = {
  agent_profiles_x_handle_key: "X handle already used",
  agent_wallets_wallet_key: WALLET_ASSIGNED,
};

/** What publish re-reads under the lock to know its check still holds. */
interface PublishState {
  visibility: "private" | "public";
  publishedAt: Date | null;
  killed: boolean;
  walletAddress: string | null;
}

/** The agent's state for publish, `FOR UPDATE` of the agent row when `lock`; null outside the workspace. */
async function publishState(
  db: Pool | PoolClient,
  access: StudioAccess,
  productAgentId: string,
  lock: boolean,
): Promise<PublishState | null> {
  const { rows } = await db.query<PublishState>(
    `SELECT a.visibility::text AS visibility, a.published_at AS "publishedAt",
       a.killed_at IS NOT NULL AS killed, acct.address AS "walletAddress"
     FROM agents.agents a
     JOIN pickler.product_agents p ON p.product_agent_id = a.id
     LEFT JOIN wallets.agent_wallets l ON l.agent_id = a.id
     LEFT JOIN LATERAL (
       SELECT address FROM wallets.wallet_accounts
        WHERE wallet_id = l.wallet_id ORDER BY created_at LIMIT 1
     ) acct ON true
     WHERE a.id::text = $3 AND p.workspace_id = $1 AND p.tenant_id = $2
     ${lock ? "FOR UPDATE OF a" : ""}`,
    [access.workspaceId, access.tenantId, productAgentId],
  );
  return rows[0] ?? null;
}

/** "0x91be…4a07": the first four and last four hex digits, as the studio shows a wallet. */
const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** A profile's avatar pattern (0–5); an agent without a profile row draws the first. */
const avatarPatternOf = (value: unknown): number => {
  const pattern = Number(value ?? 0);
  return Number.isInteger(pattern) && pattern >= 0 && pattern <= 5 ? pattern : 0;
};

const notFound = () => new PilotError("NOT_FOUND", "Agent not found");

export class PostgresStudioDirectory implements StudioDirectory {
  constructor(private readonly pool: Pool) {}
  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      const { code, constraint } = error as { code?: string; constraint?: string };
      if (code === "23505") {
        throw new PilotError(
          "CONFLICT",
          CONFLICTS[constraint ?? ""] ?? "Name or handle already used",
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }
  async onboard(userId: string, email?: string | undefined): Promise<void> {
    await this.transaction(async (client) => {
      const profile = await client.query(
        "SELECT display_name FROM identity.profiles WHERE user_id=$1",
        [userId],
      );
      if (!profile.rows[0]) {
        throw new AccessDeniedError("Complete your profile first");
      }
      await client.query(
        `INSERT INTO identity.workspaces (owner_user_id, name) VALUES ($1,$2)
        ON CONFLICT (owner_user_id) DO NOTHING`,
        [userId, profile.rows[0].display_name],
      );
      await client.query(
        `INSERT INTO pickler.workspace_tenants (workspace_id, tenant_id)
        SELECT id, id::text FROM identity.workspaces WHERE owner_user_id=$1 ON CONFLICT DO NOTHING`,
        [userId],
      );
      await client.query(
        "INSERT INTO pickler.research_access (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
        [userId],
      );
      // An application invited under this email is claimed here, once, and turns access on.
      if (email) {
        await client.query("SELECT growth.claim_invite($1, $2)", [userId, email]);
      }
    });
  }
  async access(userId: string, workspaceId: string | null): Promise<StudioAccess | null> {
    const result = await this.pool.query(
      `SELECT w.id AS "workspaceId", t.tenant_id AS "tenantId",
      w.owner_user_id AS "ownerUserId", CASE WHEN w.owner_user_id=$1 THEN 'admin' ELSE m.role::text END AS role,
      coalesce(a.enabled, false) AS enabled
      FROM identity.workspaces w JOIN pickler.workspace_tenants t ON t.workspace_id=w.id
      LEFT JOIN identity.workspace_members m ON m.workspace_id=w.id AND m.user_id=$1
      LEFT JOIN pickler.research_access a ON a.user_id=$1
      WHERE w.is_active AND (w.owner_user_id=$1 OR m.user_id=$1)
        AND ($2::uuid IS NULL OR w.id=$2) ORDER BY w.created_at LIMIT 1`,
      [userId, workspaceId],
    );
    return result.rows[0] ?? null;
  }
  /**
   * The private draft with its wallet (studio-create-simplified-v1 §4.1), the studio's only create.
   * One transaction: lock the person's workspace, and answer the draft this wallet already became
   * when this is the same create retried (same wallet, handle, name, config and profile), without
   * meeting the lock; under any other terms the wallet is WALLET_ASSIGNED. Otherwise check the
   * handle, lock the wallet and check it (this person's agent wallet, unlinked, with its rules
   * approved), run the create lock (funding, the draft limit and the wallet's balances), then write
   * the agent as a draft, its profile and handle, its runtime row, its product row, and the
   * wallet's link with the policy ids `confirmPolicies` recorded — never ids from the caller. Any
   * failure rolls all of it back.
   */
  async createDraft(
    access: StudioAccess,
    userId: string,
    input: {
      name: string;
      handle: string;
      config: AgentConfig;
      profile: DraftProfile;
      walletId: string;
    },
    admit?: CreateAdmission,
  ): Promise<{ productId: string; scope: Scope }> {
    try {
      return await this.transaction(async (client) => {
        // NO KEY UPDATE, not UPDATE: it still serializes two creates in this workspace and conflicts
        // with revoking research access or deactivating the workspace (both non-key updates), but
        // not with the KEY SHARE locks foreign-key inserts take, so other rows for this workspace
        // are not held up while the funding lock reads balances over the network.
        const allowed = await client.query(
          `SELECT w.id FROM identity.workspaces w
          JOIN pickler.research_access a ON a.user_id=w.owner_user_id
          WHERE w.id=$1 AND w.owner_user_id=$2 AND w.is_active AND a.enabled FOR NO KEY UPDATE OF w,a`,
          [access.workspaceId, userId],
        );
        if (!allowed.rows.length) {
          throw new AccessDeniedError("Research access revoked");
        }
        // A wallet becomes one agent, so the wallet is the create's key. The terms are everything
        // the draft is made of: a retry that changes the voice, brief, caps or sites is not a replay.
        const key = `draft:${input.walletId}`;
        const request = JSON.stringify({
          name: input.name,
          handle: input.handle,
          walletId: input.walletId,
          config: input.config,
          profile: input.profile,
        });
        const replay = await client.query<{ productId: string; agentId: string; matches: boolean }>(
          `SELECT product_agent_id::text AS "productId", runtime_agent_id AS "agentId",
            request=$3::jsonb AS matches
          FROM pickler.product_agents WHERE workspace_id=$1 AND tenant_id=$2 AND request_key=$4`,
          [access.workspaceId, access.tenantId, request, key],
        );
        const replayed = replay.rows[0];
        if (replayed) {
          // The same wallet under another name or handle: it already belongs to that draft.
          if (!replayed.matches) {
            throw new PilotError("WALLET_ASSIGNED", WALLET_ASSIGNED);
          }
          return {
            productId: replayed.productId,
            scope: { tenantId: access.tenantId, agentId: replayed.agentId },
          };
        }
        const available = await client.query("SELECT identity.handle_available($1) AS available", [
          input.handle,
        ]);
        if (!available.rows[0].available) {
          throw new PilotError("HANDLE_TAKEN", "Handle unavailable");
        }
        // Locked so a concurrent create cannot race the checks. Fewer ids than the three DENYs
        // every wallet is written with means its rules were never approved.
        const owned = await client.query<{ approvedPolicyIds: string[] | null; linked: boolean }>(
          `SELECT w.approved_policy_ids AS "approvedPolicyIds",
            EXISTS (SELECT 1 FROM wallets.agent_wallets l WHERE l.wallet_id=w.wallet_id) AS linked
          FROM wallets.wallets w WHERE w.wallet_id=$1 AND w.user_id=$2 AND w.kind='agent' FOR UPDATE`,
          [input.walletId, userId],
        );
        const wallet = owned.rows[0];
        if (!wallet) {
          throw new PilotError("WALLET_NOT_FOUND", "Wallet not found");
        }
        if (wallet.linked) {
          throw new PilotError("WALLET_ASSIGNED", WALLET_ASSIGNED);
        }
        const approvedPolicyIds = wallet.approvedPolicyIds;
        if (!approvedPolicyIds || approvedPolicyIds.length < MIN_AGENT_WALLET_POLICIES) {
          throw new PilotError("POLICIES_MISSING", "Sign its caps first");
        }
        // Only a genuinely new draft meets the lock, and only once its handle and wallet are good.
        await admit?.();
        const id = randomUUID();
        await client.query(
          "INSERT INTO agents.agents (id, workspace_id, name, handle, status, created_by) VALUES ($1,$2,$3,$4,'draft',$5)",
          [id, access.workspaceId, input.name, input.handle, userId],
        );
        // A draft trades BTC and ETH perpetuals on Perpl: its beat is crypto, its venue perps.
        await client.query(
          `INSERT INTO agents.agent_profiles (agent_id, beat, accent, avatar_pattern, venue, voice)
          VALUES ($1, 'crypto', $2, $3, 'perps', $4)`,
          [id, input.profile.accent, input.profile.avatarPattern, input.profile.voice],
        );
        await client.query(
          "INSERT INTO wallets.agent_wallets (agent_id, wallet_id, policy_ids) VALUES ($1,$2,$3)",
          [id, input.walletId, approvedPolicyIds],
        );
        await client.query("INSERT INTO identity.handles (handle,agent_id) VALUES ($1,$2)", [
          input.handle,
          id,
        ]);
        await client.query(
          "INSERT INTO pickler.agents (tenant_id,id,config) VALUES ($1,$2,$3::jsonb)",
          [access.tenantId, id, JSON.stringify(input.config)],
        );
        await client.query(
          `INSERT INTO pickler.product_agents (product_agent_id,workspace_id,tenant_id,runtime_agent_id,request_key,request)
          VALUES ($1::uuid,$2,$3,$1::text,$4,$5::jsonb)`,
          [id, access.workspaceId, access.tenantId, key, request],
        );
        return { productId: id, scope: { tenantId: access.tenantId, agentId: id } };
      });
    } catch (error) {
      // A unique index hit between the checks and the inserts: the wallet's link, or else the
      // handle.
      if (error instanceof PilotError && error.code === "CONFLICT") {
        if (error.message === WALLET_ASSIGNED) {
          throw new PilotError("WALLET_ASSIGNED", WALLET_ASSIGNED);
        }
        throw new PilotError("HANDLE_TAKEN", "Handle unavailable");
      }
      throw error;
    }
  }
  async agentScope(access: StudioAccess, productAgentId: string) {
    const result = await this.pool.query(
      `SELECT tenant_id AS "tenantId", runtime_agent_id AS "agentId"
      FROM pickler.product_agents WHERE workspace_id=$1 AND tenant_id=$2 AND product_agent_id::text=$3`,
      [access.workspaceId, access.tenantId, productAgentId],
    );
    if (!result.rows[0]) {
      throw new PilotError("NOT_FOUND", "Agent not found");
    }
    return result.rows[0];
  }
  async runs(scope: Scope, before: number | null): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT id FROM pickler.runs
      WHERE tenant_id=$1 AND agent_id=$2 AND ($3::bigint IS NULL OR created_at<$3)
      ORDER BY created_at DESC,id DESC LIMIT 50`,
      [scope.tenantId, scope.agentId, before],
    );
    return result.rows.map((row) => row.id as string);
  }
  async list(access: StudioAccess) {
    const result = await this.pool.query(
      `SELECT a.id,a.name,a.handle,a.status='draft' AS draft,a.visibility::text AS visibility,
        a.published_at,xa.handle AS x_handle,pr.accent,pr.avatar_pattern,a.advice_price_micro_ausd::text AS advice_price_micro_ausd,
        p.tenant_id,p.runtime_agent_id
      FROM agents.agents a
      JOIN pickler.product_agents p ON p.product_agent_id=a.id
      LEFT JOIN agents.agent_profiles pr ON pr.agent_id=a.id
      LEFT JOIN agents.x_accounts xa ON xa.agent_id=a.id
      WHERE p.workspace_id=$1 AND p.tenant_id=$2 ORDER BY a.created_at`,
      [access.workspaceId, access.tenantId],
    );
    return result.rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      handle: row.handle as string,
      // An agent created before profiles existed has no row; one outside the palette reads lime.
      accent: (ACCENTS as readonly string[]).includes(row.accent)
        ? (row.accent as Accent)
        : ("lime" as const),
      avatarPattern: avatarPatternOf(row.avatar_pattern),
      draft: row.draft === true,
      visibility: row.visibility === "public" ? ("public" as const) : ("private" as const),
      publishedAt: (row.published_at as Date | null) ?? null,
      xHandle: (row.x_handle as string | null) ?? null,
      advicePriceMicro:
        row.advice_price_micro_ausd === null ? null : BigInt(row.advice_price_micro_ausd as string),
      scope: { tenantId: row.tenant_id as string, agentId: row.runtime_agent_id as string },
    }));
  }
  /**
   * Go Public (studio-draft-dashboard-v1 D8). The check may read the chain, so no lock or
   * transaction is held across it: read killed and the wallet, run the check, then lock the agent
   * row in a short transaction and publish only if killed and the wallet are what the check saw.
   * Changed in between (killed, unlinked, relinked): check again once, then PUBLISH_CONFLICT. The
   * balance itself can still move after the read; that is the same window the drafts route accepts
   * for its funding read just before its transaction, and the chain is the truth afterwards.
   *
   * The transaction holds the wallet link `FOR SHARE` before it locks and re-reads the agent, so
   * the link cannot change unseen before COMMIT. A killed agent is refused here too, whatever the
   * check answered: D8 does not rest on the callback alone.
   */
  async publish(access: StudioAccess, productAgentId: string, check: PublishCheck) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const seen = await publishState(this.pool, access, productAgentId, false);
      if (!seen) {
        throw notFound();
      }
      if (seen.visibility === "public" && seen.publishedAt) {
        return { visibility: "public" as const, publishedAt: seen.publishedAt };
      }
      const blockers = await check({ killed: seen.killed, walletAddress: seen.walletAddress });
      if (blockers.length) {
        throw new PublishBlockedError(blockers);
      }
      const published = await this.transaction(async (client) => {
        const owner = await client.query(
          `SELECT w.id FROM identity.workspaces w
          JOIN pickler.research_access r ON r.user_id=w.owner_user_id
          WHERE w.id=$1 AND w.owner_user_id=$2 AND w.is_active AND r.enabled
          FOR SHARE OF w,r`,
          [access.workspaceId, access.ownerUserId],
        );
        if (!owner.rowCount) {
          throw new AccessDeniedError("Creator access changed");
        }
        // A separate statement: Postgres refuses FOR SHARE on the nullable side of an outer join.
        await client.query(
          "SELECT 1 FROM wallets.agent_wallets WHERE agent_id::text = $1 FOR SHARE",
          [productAgentId],
        );
        const now = await publishState(client, access, productAgentId, true);
        if (!now) {
          throw notFound();
        }
        // Published by a concurrent request meanwhile: the same answer as an already public agent.
        if (now.visibility === "public" && now.publishedAt) {
          return now.publishedAt;
        }
        if (now.killed !== seen.killed || now.walletAddress !== seen.walletAddress) {
          return null;
        }
        if (now.killed) {
          throw new PublishBlockedError(["KILLED"]);
        }
        // Same agent lock as OAuth writes: revocation cannot interleave this publication.
        const connection = await client.query(
          `SELECT 1 FROM agents.x_oauth_grants g
          JOIN agents.x_accounts x ON x.agent_id=g.agent_id
          JOIN identity.workspaces w ON w.id=g.workspace_id
          JOIN pickler.research_access r ON r.user_id=w.owner_user_id
          WHERE g.agent_id=$1 AND g.user_id=$2 AND g.workspace_id=$3 AND g.tenant_id=$4
            AND w.owner_user_id=$2 AND w.is_active AND r.enabled
            AND g.status='connected' AND g.refresh_claim IS NULL AND g.expires_at>now()
            AND g.validated_at>now()-interval '30 seconds'
            AND g.scopes @> '["users.read","tweet.read","offline.access"]'::jsonb
            AND x.verification_method='oauth' FOR SHARE OF g,w,r`,
          [productAgentId, access.ownerUserId, access.workspaceId, access.tenantId],
        );
        if (!connection.rowCount) {
          throw new PublishBlockedError(["X_CONNECTION_REQUIRED"]);
        }

        const { rows } = await client.query<{ publishedAt: Date }>(
          `UPDATE agents.agents SET visibility = 'public', published_at = now(),
             status = CASE WHEN status = 'draft' THEN 'active' ELSE status END
           WHERE id = $1 RETURNING published_at AS "publishedAt"`,
          [productAgentId],
        );
        return rows[0]!.publishedAt;
      });
      if (published) {
        return { visibility: "public" as const, publishedAt: published };
      }
    }
    throw new PilotError("PUBLISH_CONFLICT", "The agent changed while publishing; try again");
  }
  /**
   * Name, accent, avatar pattern and voice name (D14), each only when given. The bounds are the
   * database's checks and enum; a violation is INVALID_INPUT, as the person's input was out of range.
   */
  async updateIdentity(
    access: StudioAccess,
    productAgentId: string,
    identity: { name?: string; accent?: Accent; avatarPattern?: number; voice?: string },
  ): Promise<void> {
    try {
      await this.transaction(async (client) => {
        const agent = await client.query(
          `UPDATE agents.agents a SET name = coalesce($4, a.name)
           FROM pickler.product_agents p
           WHERE p.product_agent_id = a.id AND p.workspace_id = $1 AND p.tenant_id = $2
             AND a.id::text = $3
           RETURNING a.id`,
          [access.workspaceId, access.tenantId, productAgentId, identity.name ?? null],
        );
        if (!agent.rows.length) {
          throw notFound();
        }
        if (
          identity.accent === undefined &&
          identity.avatarPattern === undefined &&
          identity.voice === undefined
        ) {
          return;
        }
        // Studio drafts are created with a profile; an older agent may have none (readers join
        // it with LEFT JOIN). Every profile column has a default, so give it one and then edit it.
        await client.query(
          `INSERT INTO agents.agent_profiles (agent_id) VALUES ($1) ON CONFLICT (agent_id) DO NOTHING`,
          [agent.rows[0].id],
        );
        const profile = await client.query(
          `UPDATE agents.agent_profiles SET accent = coalesce($2::agents.accent, accent),
             avatar_pattern = coalesce($3, avatar_pattern), voice = coalesce($4, voice)
           WHERE agent_id = $1`,
          [
            agent.rows[0].id,
            identity.accent ?? null,
            identity.avatarPattern ?? null,
            identity.voice ?? null,
          ],
        );
        if (profile.rowCount !== 1) {
          throw new PilotError("NOT_FOUND", "Agent profile not found");
        }
      });
    } catch (error) {
      // 23514: a check (name length, avatar pattern, voice length); 22P02: not an accent;
      // 22003: a number past the column's range (an avatar pattern of 70000).
      const { code } = error as { code?: string };
      if (code === "23514" || code === "22P02" || code === "22003") {
        throw new PilotError("INVALID_INPUT", "Name or avatar out of range");
      }
      throw error;
    }
  }
  /**
   * The Overview's activity (D18): the agent created, its linked wallet created, and each transfer
   * into or out of that wallet, newest first, at most 50. Only what the database recorded; nothing
   * is invented. On equal times the later step of the story comes first. Transfers are the wallet
   * owner's own rows only. History follows the wallet: a transfer is shown on the agent that holds
   * the wallet now, which is the agent it was made for while wallets are never relinked.
   */
  async activity(access: StudioAccess, productAgentId: string): Promise<AgentActivityEvent[]> {
    const agent = await this.pool.query<{
      name: string;
      createdAt: Date;
      walletId: string | null;
      walletOwner: string | null;
      walletCreatedAt: Date | null;
      address: string | null;
    }>(
      `SELECT a.name, a.created_at AS "createdAt", w.wallet_id AS "walletId",
         w.user_id AS "walletOwner", w.created_at AS "walletCreatedAt", acct.address
       FROM agents.agents a
       JOIN pickler.product_agents p ON p.product_agent_id = a.id
       LEFT JOIN wallets.agent_wallets l ON l.agent_id = a.id
       LEFT JOIN wallets.wallets w ON w.wallet_id = l.wallet_id
       LEFT JOIN LATERAL (
         SELECT address FROM wallets.wallet_accounts
          WHERE wallet_id = l.wallet_id ORDER BY created_at LIMIT 1
       ) acct ON true
       WHERE a.id::text = $3 AND p.workspace_id = $1 AND p.tenant_id = $2`,
      [access.workspaceId, access.tenantId, productAgentId],
    );
    const row = agent.rows[0];
    if (!row) {
      throw notFound();
    }
    const events: (AgentActivityEvent & { rank: number })[] = [
      { kind: "created", text: `${row.name} created`, at: row.createdAt, rank: 0 },
    ];
    if (row.walletId && row.walletCreatedAt) {
      events.push({
        kind: "wallet",
        text: row.address
          ? `Agent wallet created · ${shortAddress(row.address)}`
          : "Agent wallet created",
        at: row.walletCreatedAt,
        rank: 1,
      });
      const transfers = await this.pool.query<{
        inbound: boolean;
        token: "ausd" | "mon";
        amount: string;
        at: Date;
      }>(
        `SELECT to_wallet_id = $1 AS inbound, token, amount::text AS amount, created_at AS at
         FROM wallets.transfers
         WHERE (to_wallet_id = $1 OR from_wallet_id = $1) AND user_id = $2
         ORDER BY created_at DESC, id DESC LIMIT 50`,
        [row.walletId, row.walletOwner],
      );
      for (const move of transfers.rows) {
        const amount = `${tokenAmount(move.token, move.amount)} ${move.token === "mon" ? "MON" : "AUSD"}`;
        events.push({
          kind: "transfer",
          text: move.inbound ? `To ${row.name}'s wallet · ${amount}` : `Back to master · ${amount}`,
          at: move.at,
          rank: 2,
        });
      }
    }
    return events
      .sort((a, b) => b.at.getTime() - a.at.getTime() || b.rank - a.rank)
      .slice(0, 50)
      .map(({ kind, text, at }) => ({ kind, text, at }));
  }
  async setAdvicePrice(
    userId: string,
    productAgentId: string,
    micro: bigint | null,
  ): Promise<bigint | null> {
    const { rows } = await this.pool.query<{ wallet: string | null }>(
      `SELECT l.wallet_id AS wallet
         FROM pickler.product_agents p
         JOIN identity.workspaces w ON w.id = p.workspace_id
         LEFT JOIN wallets.agent_wallets l ON l.agent_id = p.product_agent_id
        WHERE p.product_agent_id::text = $1 AND w.owner_user_id = $2`,
      [productAgentId, userId],
    );
    if (!rows.length) {
      throw notFound();
    }
    if (micro !== null && rows[0]!.wallet === null) {
      throw new PilotError("CONFLICT", "AGENT_WALLET_REQUIRED");
    }
    await this.pool.query(
      "UPDATE agents.agents SET advice_price_micro_ausd = $2 WHERE id::text = $1",
      [productAgentId, micro === null ? null : micro.toString()],
    );
    return micro;
  }
  /** The agent's recorded setup versions (studio-live-v1 L10), newest first, at most 20. */
  async versions(access: StudioAccess, productAgentId: string): Promise<SetupVersion[]> {
    // An agent with no version yet answers an empty list, so its ownership is its own read.
    await this.agentScope(access, productAgentId);
    const { rows } = await this.pool.query<SetupVersion>(
      `SELECT version, summary, created_at AS at
       FROM agents.setup_versions
       WHERE agent_id = $1::uuid
       ORDER BY version DESC LIMIT 20`,
      [productAgentId],
    );
    return rows;
  }
}
