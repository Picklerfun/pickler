import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  AccessDeniedError,
  PilotError,
  type ConsoleAccess,
  type ConsoleDirectory,
  type AgentConfig,
  type Scope,
} from "@pickler/core";

export class PostgresConsoleDirectory implements ConsoleDirectory {
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
      if ((error as { code?: string }).code === "23505") {
        throw new PilotError("CONFLICT", "Name or handle already used");
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
  async access(userId: string, workspaceId: string | null): Promise<ConsoleAccess | null> {
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
    access: ConsoleAccess,
    userId: string,
    input: { name: string; handle: string; config: AgentConfig; key: string },
  ) {
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
  async agentScope(access: ConsoleAccess, productAgentId: string) {
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
  async list(access: ConsoleAccess) {
    const result = await this.pool.query(
      `SELECT a.id,a.name,a.handle,p.tenant_id,p.runtime_agent_id FROM agents.agents a
      JOIN pickler.product_agents p ON p.product_agent_id=a.id WHERE p.workspace_id=$1 AND p.tenant_id=$2 ORDER BY a.created_at`,
      [access.workspaceId, access.tenantId],
    );
    return result.rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      handle: row.handle as string,
      scope: { tenantId: row.tenant_id as string, agentId: row.runtime_agent_id as string },
    }));
  }
}
