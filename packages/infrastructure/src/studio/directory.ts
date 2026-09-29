import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  ACCENTS,
  AccessDeniedError,
  MIN_AGENT_WALLET_POLICIES,
  PilotError,
  assertPreviewAdoptable,
  type AdoptablePreview,
  type Accent,
  type StudioAccess,
  type StudioDirectory,
  type AgentConfig,
  type AgentProfileInput,
  type AgentWalletLink,
  type CreateAdmission,
  type Scope,
} from "@pickler/core";

/** Which unique index a duplicate hit, so the refusal names the field a person can change. */
const CONFLICTS: Record<string, string> = {
  agent_profiles_x_handle_key: "X handle already used",
  agent_wallets_wallet_key: "That wallet already belongs to an agent",
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
  async createAgent(
    access: StudioAccess,
    userId: string,
    input: {
      name: string;
      handle: string;
      config: AgentConfig;
      key: string;
      profile: AgentProfileInput;
      wallet: AgentWalletLink;
    },
    admit?: CreateAdmission,
  ) {
    // The beat the profile shows is the category the runtime is scoped to. Core has already
    // required it; narrowing here keeps the profile from ever being written without one.
    const scope = input.config.marketScope;
    if (!scope) {
      throw new PilotError("INVALID_INPUT", "A category selection is required");
    }
    return this.transaction(async (client) => {
      const allowed = await client.query(
        `SELECT w.id FROM identity.workspaces w
        JOIN pickler.research_access a ON a.user_id=w.owner_user_id
        WHERE w.id=$1 AND w.owner_user_id=$2 AND w.is_active AND a.enabled FOR UPDATE OF w,a`,
        [access.workspaceId, userId],
      );
      if (!allowed.rows.length) {
        throw new AccessDeniedError("Research access revoked");
      }
      const request = JSON.stringify({
        name: input.name,
        handle: input.handle,
        config: input.config,
        profile: input.profile,
        wallet: input.wallet,
      });
      const existing = await client.query(
        `SELECT runtime_agent_id, request=$3::jsonb AS matches FROM pickler.product_agents
        WHERE workspace_id=$1 AND request_key=$2`,
        [access.workspaceId, input.key, request],
      );
      if (existing.rows[0]) {
        if (!existing.rows[0].matches) {
          throw new PilotError("CONFLICT", "Idempotency key has different terms");
        }
        return { tenantId: access.tenantId, agentId: existing.rows[0].runtime_agent_id as string };
      }
      // Only a genuinely new agent meets the funding lock; a replay above does not.
      await admit?.();
      const available = await client.query("SELECT identity.handle_available($1) AS available", [
        input.handle,
      ]);
      if (!available.rows[0].available) {
        throw new PilotError("CONFLICT", "Handle unavailable");
      }
      const id = randomUUID();
      await client.query(
        "INSERT INTO agents.agents (id, workspace_id, name, handle, status, created_by) VALUES ($1,$2,$3,$4,'active',$5)",
        [id, access.workspaceId, input.name, input.handle, userId],
      );
      await client.query(
        `INSERT INTO agents.agent_profiles
           (agent_id, beat, accent, blurb, venue, vibe, voice, decides, wrong, x_handle)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          scope.category,
          input.profile.accent,
          input.profile.blurb,
          input.profile.venue,
          input.profile.vibe,
          input.profile.voice,
          input.profile.decides,
          input.profile.wrong,
          input.profile.xHandle,
        ],
      );
      // The wallet must be this person's own agent wallet, locked so a concurrent creation
      // cannot race the check. Its policy ids come from this row, never from the caller: the
      // server is the only source of which rules a wallet carries, because `confirmPolicies` is
      // the only writer of `approved_policy_ids`. An agent is created with its wallet, or not at
      // all: this rejects (rolling the agent and its profile back) before anything else is
      // written.
      const owned = await client.query<{ approvedPolicyIds: string[] | null }>(
        `SELECT approved_policy_ids AS "approvedPolicyIds"
        FROM wallets.wallets WHERE wallet_id=$1 AND user_id=$2 AND kind='agent' FOR UPDATE`,
        [input.wallet.walletId, userId],
      );
      if (!owned.rows.length) {
        throw new PilotError("NOT_FOUND", "Wallet not found");
      }
      const approvedPolicyIds = owned.rows[0]!.approvedPolicyIds;
      // Every wallet is written with at least the three DENYs, and `confirmPolicies` records
      // exactly what was prepared, so fewer ids than that means the rules were never approved.
      if (!approvedPolicyIds || approvedPolicyIds.length < MIN_AGENT_WALLET_POLICIES) {
        throw new PilotError("CONFLICT", "Approve the wallet's rules first");
      }
      await client.query(
        "INSERT INTO wallets.agent_wallets (agent_id, wallet_id, policy_ids) VALUES ($1,$2,$3)",
        [id, input.wallet.walletId, approvedPolicyIds],
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
        [id, access.workspaceId, access.tenantId, input.key, request],
      );
      return { tenantId: access.tenantId, agentId: id };
    });
  }
  /**
   * The private draft (studio-brief-v1 §6). One transaction: lock the person's workspace, run the
   * funding lock, lock the preview and check it (PREVIEW_UNUSABLE, then RUN_STALE, then
   * HANDLE_TAKEN), then write the agent as a draft with no wallet, its profile and handle, its
   * runtime row with the run's config snapshot, the preview as its first run with its trace, and
   * the preview's adoption. Any failure rolls all of it back.
   */
  async createDraft(
    access: StudioAccess,
    userId: string,
    input: { name: string; handle: string; previewRunId: string; fingerprint: string },
    now: number,
    admit?: CreateAdmission,
  ): Promise<{ productId: string; scope: Scope }> {
    try {
      return await this.transaction(async (client) => {
        const allowed = await client.query(
          `SELECT w.id FROM identity.workspaces w
          JOIN pickler.research_access a ON a.user_id=w.owner_user_id
          WHERE w.id=$1 AND w.owner_user_id=$2 AND w.is_active AND a.enabled FOR UPDATE OF w,a`,
          [access.workspaceId, userId],
        );
        if (!allowed.rows.length) {
          throw new AccessDeniedError("Research access revoked");
        }
        await admit?.();
        const found = await client.query<
          AdoptablePreview & {
            config: AgentConfig;
            decision: unknown;
            error: string | null;
            createdAt: number;
            startedAt: number | null;
            finishedAt: number | null;
          }
        >(
          `SELECT user_id AS "userId", workspace_id AS "workspaceId", status,
            expires_at::double precision AS "expiresAt", adopted_at IS NOT NULL AS adopted,
            fingerprint, config, decision, error, created_at::double precision AS "createdAt",
            started_at::double precision AS "startedAt", finished_at::double precision AS "finishedAt"
          FROM pickler.preview_runs WHERE id=$1 FOR UPDATE`,
          [input.previewRunId],
        );
        const preview = found.rows[0] ?? null;
        assertPreviewAdoptable(
          preview,
          { userId, workspaceId: access.workspaceId },
          input.fingerprint,
          now,
        );
        const run = preview!;
        const available = await client.query("SELECT identity.handle_available($1) AS available", [
          input.handle,
        ]);
        if (!available.rows[0].available) {
          throw new PilotError("HANDLE_TAKEN", "Handle unavailable");
        }
        const id = randomUUID();
        await client.query(
          "INSERT INTO agents.agents (id, workspace_id, name, handle, status, created_by) VALUES ($1,$2,$3,$4,'draft',$5)",
          [id, access.workspaceId, input.name, input.handle, userId],
        );
        // The public face comes in Go Public; the beat is the scope the brief runs on.
        await client.query(
          "INSERT INTO agents.agent_profiles (agent_id, beat, accent) VALUES ($1, 'sports', 'lime')",
          [id],
        );
        await client.query("INSERT INTO identity.handles (handle,agent_id) VALUES ($1,$2)", [
          input.handle,
          id,
        ]);
        await client.query(
          "INSERT INTO pickler.agents (tenant_id,id,config) VALUES ($1,$2,$3::jsonb)",
          [access.tenantId, id, JSON.stringify(run.config)],
        );
        const request = JSON.stringify({
          name: input.name,
          handle: input.handle,
          previewRunId: input.previewRunId,
        });
        await client.query(
          `INSERT INTO pickler.product_agents (product_agent_id,workspace_id,tenant_id,runtime_agent_id,request_key,request)
          VALUES ($1::uuid,$2,$3,$1::text,$4,$5::jsonb)`,
          [id, access.workspaceId, access.tenantId, `preview:${input.previewRunId}`, request],
        );
        // The preview becomes its first run: a completed manual run at version 1, which is what
        // readiness counts (§6: "its first run counts as done").
        await client.query(
          `INSERT INTO pickler.runs
            (id, tenant_id, agent_id, request_key, market_id, trigger, status, created_at, started_at,
             finished_at, config_version, config, decision, error)
          VALUES ($1,$2,$3,$4,NULL,'manual','completed',$5,$6,$7,1,$8::jsonb,$9::jsonb,$10)`,
          [
            input.previewRunId,
            access.tenantId,
            id,
            `preview:${input.previewRunId}`,
            run.createdAt,
            run.startedAt,
            run.finishedAt,
            JSON.stringify(run.config),
            run.decision === null ? null : JSON.stringify(run.decision),
            run.error,
          ],
        );
        await client.query(
          `INSERT INTO pickler.events (run_id, type, data, created_at)
          SELECT $1, type, data, created_at FROM pickler.preview_events
          WHERE preview_run_id=$1 ORDER BY id`,
          [input.previewRunId],
        );
        await client.query(
          "UPDATE pickler.preview_runs SET adopted_at=$2, adopted_agent_id=$3 WHERE id=$1",
          [input.previewRunId, now, id],
        );
        return { productId: id, scope: { tenantId: access.tenantId, agentId: id } };
      });
    } catch (error) {
      // A handle claimed between the check and the insert hits the unique index instead.
      if (error instanceof PilotError && error.code === "CONFLICT") {
        throw new PilotError("HANDLE_TAKEN", "Handle unavailable");
      }
      throw error;
    }
  }
  /** The same lookup `createAgent` replays from: workspace and key. */
  async createdWithKey(access: StudioAccess, key: string): Promise<Scope | null> {
    const result = await this.pool.query(
      `SELECT tenant_id AS "tenantId", runtime_agent_id AS "agentId"
      FROM pickler.product_agents WHERE workspace_id=$1 AND request_key=$2`,
      [access.workspaceId, key],
    );
    return (result.rows[0] as Scope | undefined) ?? null;
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
