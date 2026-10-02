import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  ACCENTS,
  AccessDeniedError,
  MIN_AGENT_WALLET_POLICIES,
  PilotError,
  type Accent,
  type StudioAccess,
  type StudioDirectory,
  type AgentConfig,
  type CreateAdmission,
  type DraftProfile,
  type Scope,
} from "@pickler/core";

/** Which unique index a duplicate hit, so the refusal names the field a person can change. */
const WALLET_ASSIGNED = "That wallet already belongs to an agent";
const CONFLICTS: Record<string, string> = {
  agent_profiles_x_handle_key: "X handle already used",
  agent_wallets_wallet_key: WALLET_ASSIGNED,
};

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
  async onboard(userId: string): Promise<void> {
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
      `SELECT a.id,a.name,a.handle,a.status='draft' AS draft,pr.accent,p.tenant_id,p.runtime_agent_id
      FROM agents.agents a
      JOIN pickler.product_agents p ON p.product_agent_id=a.id
      LEFT JOIN agents.agent_profiles pr ON pr.agent_id=a.id
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
      draft: row.draft === true,
      scope: { tenantId: row.tenant_id as string, agentId: row.runtime_agent_id as string },
    }));
  }
}
