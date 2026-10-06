import type { Pool } from "pg";
import {
  AccessDeniedError,
  type StudioAccessRequest,
  type StudioAccessRequestEntry,
  type StudioAccessRequestRepository,
} from "@pickler/core";

export class PostgresStudioAccessRequests implements StudioAccessRequestRepository {
  constructor(private readonly pool: Pool) {}

  async read(userId: string): Promise<StudioAccessRequest> {
    const result = await this.pool.query(
      `SELECT a.enabled, r.requested_at FROM pickler.research_access a
       LEFT JOIN pickler.studio_access_requests r ON r.user_id = a.user_id
       WHERE a.user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return {
      status: row?.enabled ? "enabled" : row?.requested_at ? "pending" : "not_requested",
      requestedAt: row?.requested_at ?? null,
    };
  }

  async request(userId: string, workspaceId: string): Promise<StudioAccessRequest> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const owner = await client.query(
        `SELECT a.enabled FROM identity.workspaces w
         JOIN pickler.research_access a ON a.user_id = w.owner_user_id
         WHERE w.id = $1 AND w.owner_user_id = $2 AND w.is_active
         FOR NO KEY UPDATE OF w, a`,
        [workspaceId, userId],
      );
      if (!owner.rows[0]) {
        throw new AccessDeniedError("Workspace owner required");
      }
      if (!owner.rows[0].enabled) {
        await client.query(
          `INSERT INTO pickler.studio_access_requests (user_id, workspace_id)
           VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
          [userId, workspaceId],
        );
      }
      const requested = await client.query(
        "SELECT requested_at FROM pickler.studio_access_requests WHERE user_id = $1",
        [userId],
      );
      await client.query("COMMIT");
      return {
        status: owner.rows[0].enabled ? "enabled" : "pending",
        requestedAt: requested.rows[0]?.requested_at ?? null,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async pending(): Promise<StudioAccessRequestEntry[]> {
    const result = await this.pool.query<StudioAccessRequestEntry>(
      `SELECT r.user_id AS "userId", p.handle, p.display_name AS "displayName",
              r.requested_at AS "requestedAt"
       FROM pickler.studio_access_requests r
       JOIN pickler.research_access a ON a.user_id = r.user_id
       JOIN identity.profiles p ON p.user_id = r.user_id
       JOIN identity.workspaces w ON w.id = r.workspace_id AND w.owner_user_id = r.user_id
       WHERE NOT a.enabled AND w.is_active ORDER BY r.requested_at LIMIT 100`,
    );
    return result.rows;
  }
}
