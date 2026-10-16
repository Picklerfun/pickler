import type { Pool, PoolClient } from "pg";
import { PilotError } from "@pickler/core";
import type {
  PaperHistoryEntities,
  PaperHistoryPage,
  PaperHistoryPageOptions,
  PerpsPaperPosition,
  PerpsPaperScope,
} from "@pickler/trading/perps";
import { scopeValues } from "./paper-operational-read.js";
type Database = Pool | PoolClient;
type Kind = keyof PaperHistoryEntities;
type Cursor = {
  v: 1;
  account: string;
  kind: Kind;
  watermark: string;
  sequence: string;
  key: string;
};
const decimal = (value: unknown): value is string =>
  typeof value === "string" && /^\d{1,19}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const invalid = () => new PilotError("INVALID_INPUT", "Invalid Paper history cursor");
async function identity(db: Database, scope: PerpsPaperScope) {
  const result = await db.query<{ id: string; mode: string }>(
    `SELECT a.id,s.mode FROM pickler.perps_paper_accounts a
    LEFT JOIN pickler.paper_storage s ON s.account_id=a.id
    WHERE a.tenant_id=$1 AND a.agent_id=$2 AND a.session_id=$3 AND a.network=$4`,
    scopeValues(scope),
  );
  if (!result.rows[0]) {
    throw new PilotError("NOT_FOUND", "Paper account not found");
  }
  return result.rows[0];
}
/** One authorized-scope position, without historical arrays. */
export async function position(
  db: Database,
  scope: PerpsPaperScope,
  id: string,
): Promise<PerpsPaperPosition | null> {
  if (!id || id.length > 512) {
    throw new PilotError("INVALID_INPUT", "Invalid Paper position");
  }
  const account = await identity(db, scope);
  const result = await db.query<{ document: PerpsPaperPosition }>(
    "SELECT document-'sizeUps' AS document FROM pickler.perps_paper_positions WHERE account_id=$1 AND id=$2",
    [account.id, id],
  );
  return result.rows[0]?.document ?? null;
}
/** Cursor bounds the committed cohort. Late epoch visibility uses its atomic booking fact,
 * never the earlier staging sequence. No financial arrays or full archive are read. */
export async function historyPage<K extends Kind>(
  db: Database,
  scope: PerpsPaperScope,
  kind: K,
  options: PaperHistoryPageOptions = {},
): Promise<PaperHistoryPage<PaperHistoryEntities[K]>> {
  const limit = options.limit ?? 50;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !["positions", "attempts", "movements", "sizeUps"].includes(kind)
  ) {
    throw new PilotError("INVALID_INPUT", "Invalid Paper history page");
  }
  const account = await identity(db, scope);
  if (account.mode !== "operational") {
    throw new PilotError(
      "PAPER_MIGRATION_REQUIRED",
      "Convert Paper history before paginated reads",
    );
  }
  let cursor: Cursor | null = null;
  if (options.cursor !== undefined) {
    try {
      if (!options.cursor || options.cursor.length > 4096) {
        throw invalid();
      }
      const value = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8"));
      if (
        value.v !== 1 ||
        value.account !== account.id ||
        value.kind !== kind ||
        !decimal(value.watermark) ||
        !decimal(value.sequence) ||
        BigInt(value.sequence) > BigInt(value.watermark) ||
        typeof value.key !== "string" ||
        value.key.length > 1024
      ) {
        throw invalid();
      }
      cursor = value;
    } catch {
      throw invalid();
    }
  }
  const table = {
    positions: "perps_paper_positions",
    attempts: "perps_paper_attempts",
    movements: "paper_record_facts",
    sizeUps: "paper_position_sizeups",
  }[kind];
  const watermark =
    cursor?.watermark ??
    (
      await db.query<{ watermark: string }>(
        `SELECT coalesce(max(sequence),0)::text AS watermark FROM pickler.${table} WHERE account_id=$1`,
        [account.id],
      )
    ).rows[0]!.watermark;
  let source: string;
  if (kind === "movements") {
    source = `(
      SELECT f.sequence,m.key,m.document FROM pickler.perps_paper_movements m
      JOIN pickler.paper_record_facts f ON f.account_id=m.account_id AND f.key=m.key
      WHERE m.account_id=$1 AND f.sequence<=$2::bigint
        AND ($3::bigint IS NULL OR (f.sequence,m.key)<($3::bigint,$4::text))
      ORDER BY f.sequence DESC,m.key DESC LIMIT $5
    ) UNION ALL (
      SELECT f.sequence,p.key,p.document || jsonb_build_object('at',e.committed_at) AS document
      FROM pickler.paper_funding_postings p
      JOIN pickler.paper_funding_epochs e ON e.id=p.epoch_id AND e.status='committed'
      JOIN pickler.paper_record_facts f ON f.account_id=p.account_id AND f.key='epoch:'||p.epoch_id::text
      WHERE p.account_id=$1 AND f.sequence<=$2::bigint
        AND ($3::bigint IS NULL OR (f.sequence,p.key)<($3::bigint,$4::text))
      ORDER BY f.sequence DESC,p.key DESC LIMIT $5
    )`;
  } else if (kind === "sizeUps") {
    source = `SELECT sequence,key,jsonb_build_object('key',key,'positionId',position_id,'at',at,'margin',trim_scale(margin)::text) AS document
      FROM pickler.${table} WHERE account_id=$1`;
  } else {
    source = `SELECT sequence,${kind === "positions" ? "id" : "key"} AS key,
      document${kind === "positions" ? "-'sizeUps'" : ""} AS document
      FROM pickler.${table} WHERE account_id=$1`;
  }
  const result = await db.query<{
    sequence: string;
    key: string;
    document: PaperHistoryEntities[K];
  }>(
    `WITH source AS (${source})
    SELECT s.sequence::text,s.key,s.document FROM source s
    WHERE s.sequence<=$2::bigint AND ($3::bigint IS NULL OR (s.sequence,s.key)<($3::bigint,$4::text))
    ORDER BY s.sequence DESC,s.key DESC LIMIT $5`,
    [account.id, watermark, cursor?.sequence ?? null, cursor?.key ?? null, limit + 1],
  );
  const rows = result.rows.slice(0, limit);
  const last = rows.at(-1);
  return {
    items: rows.map((row) => row.document),
    watermark,
    nextCursor:
      result.rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({
              v: 1,
              account: account.id,
              kind,
              watermark,
              sequence: last.sequence,
              key: last.key,
            }),
          ).toString("base64url")
        : null,
  };
}
