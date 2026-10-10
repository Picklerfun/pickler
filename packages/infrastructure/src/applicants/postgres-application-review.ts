import type { Pool } from "pg";
import {
  DataSourceUnavailableError,
  type ApplicationDecision,
  type ApplicationReviewEntry,
  type ApplicationReviewFilter,
  type ApplicationReviewRepository,
} from "@pickler/core";
import { readRows } from "../persistence/data-source.js";

type ApplicationRow = Omit<ApplicationReviewEntry, "id"> & { id: string };

function toEntry(row: ApplicationRow): ApplicationReviewEntry {
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new DataSourceUnavailableError("postgres.growth.applications.id");
  }
  return { ...row, id };
}

const COLUMNS = `
  a.waitlist_id AS "id", w.email, a.agent_name AS "agentName", a.ticker, a.x_handle AS "xHandle",
  a.category, a.personality, a.edge, a.why_you AS "whyYou", a.status,
  a.submitted_at AS "submittedAt", a.reviewed_at AS "reviewedAt", a.reviewed_by AS "reviewedBy",
  a.decision_note AS "decisionNote", a.invited_at AS "invitedAt"`;

/**
 * The operators' view of growth.applications. Reads join the seat for the email; the one write
 * goes through growth.review_application, the only thing that changes a status.
 */
export class PostgresApplicationReview implements ApplicationReviewRepository {
  constructor(private readonly pool: Pool) {}

  async list(filter: ApplicationReviewFilter): Promise<ApplicationReviewEntry[]> {
    const status = filter.status ?? null;
    const rows = await readRows<ApplicationRow>(
      this.pool,
      "growth.applications.list",
      `SELECT ${COLUMNS}
       FROM growth.applications a
       JOIN growth.waitlist w ON w.id = a.waitlist_id
       WHERE $1::text IS NULL OR a.status = $1
       ORDER BY a.submitted_at DESC
       LIMIT 500`,
      [status],
    );
    return rows.map(toEntry);
  }

  async review(
    id: number,
    decision: ApplicationDecision,
    note: string | null,
    reviewer: string,
  ): Promise<ApplicationReviewEntry | null> {
    const decided = await this.pool.query<{ result: unknown }>(
      "SELECT growth.review_application($1, $2, $3, $4) AS result",
      [id, decision, note, reviewer],
    );
    if (!decided.rows[0]?.result) {
      return null;
    }
    const rows = await readRows<ApplicationRow>(
      this.pool,
      "growth.applications.read",
      `SELECT ${COLUMNS}
       FROM growth.applications a
       JOIN growth.waitlist w ON w.id = a.waitlist_id
       WHERE a.waitlist_id = $1`,
      [id],
    );
    return rows[0] ? toEntry(rows[0]) : null;
  }
}
