import type { Pool } from "pg";
import type {
  ApplicationStatus,
  StudioAccessRequest,
  StudioAccessRequestEntry,
  StudioAccessRequestRepository,
} from "@pickler/core";

/**
 * Reads over pickler.studio_access_requests and, through growth.application_status_for, the
 * application sent under the account's email. Nothing here writes: the request was retired with
 * the public application (docs/specs/landing-trade-v1.md §7), and the rows recorded before that
 * stay readable for operators.
 */
export class PostgresStudioAccessRequests implements StudioAccessRequestRepository {
  constructor(private readonly pool: Pool) {}

  async read(userId: string, email?: string | undefined): Promise<StudioAccessRequest> {
    const result = await this.pool.query(
      `SELECT a.enabled, r.requested_at FROM pickler.research_access a
       LEFT JOIN pickler.studio_access_requests r ON r.user_id = a.user_id
       WHERE a.user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    const application = email
      ? ((
          await this.pool.query<{ status: ApplicationStatus | null }>(
            "SELECT growth.application_status_for($1) AS status",
            [email],
          )
        ).rows[0]?.status ?? null)
      : null;
    return {
      status: row?.enabled ? "enabled" : row?.requested_at ? "pending" : "not_requested",
      requestedAt: row?.requested_at ?? null,
      application,
    };
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
