import type { Pool } from "pg";
import type { ApiKeyDirectory, StoredApiKey, Workspace, WorkspaceDirectory } from "@pickler/core";
import { readRows } from "./data-source.js";

// identity.workspaces (Relayer's integrators), identity.workspace_members and identity.api_keys
// over the API's pool. Same reads the Supabase adapters made through PostgREST, column for column.

const WORKSPACE_SELECT = `SELECT id, name, owner_user_id AS "userId", is_active AS "isActive",
         active_modules::text[] AS "activeModules"
    FROM identity.workspaces`;

export class PostgresWorkspaceDirectory implements WorkspaceDirectory {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<Workspace | null> {
    const rows = await readRows<Workspace>(
      this.pool,
      "identity.workspaces.findById",
      `${WORKSPACE_SELECT} WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findOwnedBy(userId: string): Promise<Workspace | null> {
    const rows = await readRows<Workspace>(
      this.pool,
      "identity.workspaces.findOwnedBy",
      `${WORKSPACE_SELECT} WHERE owner_user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async findOldestMembership(
    userId: string,
  ): Promise<{ workspaceId: string; role: string | null } | null> {
    const rows = await readRows<{ workspaceId: string; role: string | null }>(
      this.pool,
      "identity.workspace_members.findOldest",
      `SELECT workspace_id AS "workspaceId", role::text AS role FROM identity.workspace_members
        WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async roleOf(userId: string, workspaceId: string): Promise<string | null> {
    const owner = await readRows<{ ownerUserId: string }>(
      this.pool,
      "identity.workspaces.owner",
      `SELECT owner_user_id AS "ownerUserId" FROM identity.workspaces WHERE id = $1`,
      [workspaceId],
    );
    if (owner[0]?.ownerUserId === userId) {
      return "admin";
    }
    const membership = await readRows<{ role: string }>(
      this.pool,
      "identity.workspace_members.role",
      `SELECT role::text AS role FROM identity.workspace_members
        WHERE user_id = $1 AND workspace_id = $2`,
      [userId, workspaceId],
    );
    return membership[0]?.role ?? null;
  }
}

/** A revoked key is inactive. identity.api_keys carries workspace_id directly. */
export class PostgresApiKeyDirectory implements ApiKeyDirectory {
  constructor(private readonly pool: Pool) {}

  async findByHash(hash: string): Promise<StoredApiKey | null> {
    const rows = await readRows<StoredApiKey>(
      this.pool,
      "identity.api_keys.findByHash",
      `SELECT id, scopes::text[] AS scopes, revoked_at IS NULL AS active,
              expires_at AS "expiresAt", allowed_cidrs::text[] AS "allowedCidrs",
              workspace_id AS "workspaceId", NULL::timestamptz AS "linkExpiresAt"
         FROM identity.api_keys WHERE hash = $1`,
      [hash],
    );
    return rows[0] ?? null;
  }
}
