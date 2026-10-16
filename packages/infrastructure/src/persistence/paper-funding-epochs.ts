import { randomUUID } from "node:crypto";
import { recordEpoch, advanceRecordProjection } from "./paper-record-projection.js";
import type { Pool, PoolClient } from "pg";
import { PilotError, type PerpFundingHistory } from "@pickler/core";
import {
  applyPaperObservation,
  paperDecimal,
  paperUnits,
  type PerpsPaperAccount,
  type PerpsPaperMovement,
  type PerpsPaperPosition,
  type PerpsPaperScope,
} from "@pickler/trading/perps";
import { paperLedger, scopeValues } from "./paper-operational-read.js";

export type PaperFundingAnchor = { number: number; hash: string; timestamp: number };
type Epoch = {
  anchor: PaperFundingAnchor;
  id: string;
  account_id: string;
  cutoff_at: string;
  max_sequence: string;
  cursor: string;
  owner: string;
  event_cursor: string | null;
};

/** An audit owns an immutable closed-position cohort. Each call processes at most 50 positions;
 * provider failure retains its durable cursor. Pending postings have no financial visibility. */
export class PaperFundingEpochs {
  constructor(private readonly pool: Pool) {}
  private async transaction<T>(operation: (db: PoolClient) => Promise<T>) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT set_config('pickler.paper_writer','2',true)");
      const result = await operation(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async pass(
    scope: PerpsPaperScope,
    funding: (
      position: PerpsPaperPosition,
      from: number,
      to: number,
    ) => Promise<PerpFundingHistory>,
    verify: (expected?: PaperFundingAnchor) => Promise<PaperFundingAnchor>,
  ) {
    const saved = await this.pool.query(
      `SELECT e.anchor,(e.owner IS NOT NULL AND e.expires_at>floor(extract(epoch FROM clock_timestamp())*1000)) AS busy FROM pickler.paper_funding_epochs e JOIN pickler.perps_paper_accounts a ON a.id=e.account_id
      WHERE a.tenant_id=$1 AND a.agent_id=$2 AND a.session_id=$3 AND a.network=$4 AND e.status IN ('pending','running') ORDER BY e.cutoff_at,e.id LIMIT 1`,
      scopeValues(scope),
    );
    if (saved.rows[0]?.busy) {
      return { kind: "busy" as const };
    }
    const anchor = await verify(saved.rows[0]?.anchor);
    if (
      !Number.isSafeInteger(anchor.number) ||
      !Number.isSafeInteger(anchor.timestamp) ||
      !/^0x[a-f0-9]{64}$/i.test(anchor.hash)
    ) {
      throw new PilotError("FUNDING_PENDING", "Confirmed historical anchor is unavailable");
    }
    const deadline = Date.now() + 20000;
    const owner = randomUUID();
    const epoch = await this.transaction(async (db) => {
      const result = await db.query(
        `SELECT a.id,s.coverage_required,s.coverage_complete FROM pickler.perps_paper_accounts a
        JOIN pickler.paper_storage s ON s.account_id=a.id
        WHERE a.tenant_id=$1 AND a.agent_id=$2 AND a.session_id=$3 AND a.network=$4
          AND s.mode='operational' AND a.document->>'fundingDisputed' IS DISTINCT FROM 'true' FOR UPDATE OF a SKIP LOCKED`,
        scopeValues(scope),
      );
      const accountId = result.rows[0]?.id;
      if (!accountId) {
        return null;
      }
      await db.query(
        "UPDATE pickler.paper_storage SET audit_at=floor(extract(epoch FROM clock_timestamp())*1000) WHERE account_id=$1",
        [accountId],
      );
      const current = await db.query(
        `SELECT * FROM pickler.paper_funding_epochs
        WHERE account_id=$1 AND status IN ('pending','running') ORDER BY cutoff_at,id LIMIT 1 FOR UPDATE`,
        [accountId],
      );
      let row = current.rows[0];
      if (!row) {
        const latest = await db.query(
          `SELECT 1 FROM pickler.paper_funding_epochs WHERE account_id=$1
          AND status='committed' AND committed_at>floor(extract(epoch FROM clock_timestamp())*1000)-86400000 LIMIT 1`,
          [accountId],
        );
        const coverage = result.rows[0];
        if (
          latest.rowCount &&
          BigInt(coverage.coverage_required) <= BigInt(coverage.coverage_complete)
        ) {
          return null;
        }
        const created = await db.query(
          `INSERT INTO pickler.paper_funding_epochs(id,account_id,cutoff_at,max_sequence,anchor)
          SELECT $1,$2,least(floor(extract(epoch FROM clock_timestamp())*1000),$3::bigint),coalesce(max(closed_sequence),0),$4::jsonb
          FROM pickler.perps_paper_positions WHERE account_id=$2 AND closed_at IS NOT NULL
          RETURNING *`,
          [randomUUID(), accountId, anchor.timestamp, anchor],
        );
        row = created.rows[0];
        await db.query(
          "UPDATE pickler.paper_storage SET coverage_required=greatest(coverage_required,$2) WHERE account_id=$1",
          [accountId, row.max_sequence],
        );
      }
      const claimed = await db.query(
        `UPDATE pickler.paper_funding_epochs
        SET status='running',owner=$2,expires_at=floor(extract(epoch FROM clock_timestamp())*1000)+60000
        WHERE id=$1 AND (owner IS NULL OR expires_at<=floor(extract(epoch FROM clock_timestamp())*1000)) RETURNING *`,
        [row.id, owner],
      );
      return (claimed.rows[0] ?? null) as Epoch | null;
    });
    if (!epoch) {
      return { kind: "busy" as const };
    }
    try {
      const page = await this.pool.query<{ sequence: string; document: PerpsPaperPosition }>(
        `SELECT closed_sequence::text AS sequence,document FROM pickler.perps_paper_positions
        WHERE account_id=$1 AND closed_at IS NOT NULL AND closed_sequence>$2 AND closed_sequence<=$3
        ORDER BY closed_sequence LIMIT 50`,
        [epoch.account_id, epoch.cursor, epoch.max_sequence],
      );
      for (const row of page.rows) {
        if (Date.now() >= deadline) {
          await this.pool.query(
            "UPDATE pickler.paper_funding_epochs SET owner=NULL,expires_at=NULL WHERE id=$1 AND owner=$2",
            [epoch.id, owner],
          );
          return { kind: "continued" as const, positions: 0 };
        }
        await verify(epoch.anchor);
        const from =
          epoch.event_cursor === null ? row.document.openedAt : Number(epoch.event_cursor);
        const to = Math.min(row.document.closedAt!, Number(epoch.cutoff_at), from + 3600000);
        if (to < from) {
          await this.transaction(async (db) => {
            await db.query("SELECT 1 FROM pickler.perps_paper_accounts WHERE id=$1 FOR UPDATE", [
              epoch.account_id,
            ]);
            const updated = await db.query(
              `UPDATE pickler.paper_funding_epochs SET cursor=$3,event_cursor=NULL
              WHERE id=$1 AND owner=$2 AND status='running' AND expires_at>floor(extract(epoch FROM clock_timestamp())*1000) RETURNING id`,
              [epoch.id, owner, row.sequence],
            );
            if (!updated.rowCount) {
              throw new PilotError("LEASE_LOST", "Historical audit ownership expired");
            }
          });
          epoch.cursor = row.sequence;
          epoch.event_cursor = null;
          continue;
        }
        const history = await funding(row.document, from, to);
        if (history.events.some((event) => event.eventBlock > epoch.anchor.number)) {
          throw new PilotError("FUNDING_PENDING", "Funding exceeds the pinned confirmed block");
        }
        if (!history.complete || history.from > from || history.to < to - 30000) {
          throw new PilotError("FUNDING_PENDING", "Historical funding coverage is incomplete");
        }
        await this.transaction(async (db) => {
          const account = await db.query<{ document: PerpsPaperAccount }>(
            "SELECT document FROM pickler.perps_paper_accounts WHERE id=$1 FOR UPDATE",
            [epoch.account_id],
          );
          const owned = await db.query(
            `SELECT 1 FROM pickler.paper_funding_epochs WHERE id=$1 AND owner=$2
            AND status='running' AND expires_at>floor(extract(epoch FROM clock_timestamp())*1000) FOR UPDATE`,
            [epoch.id, owner],
          );
          if (!owned.rowCount) {
            throw new PilotError("LEASE_LOST", "Historical audit ownership expired");
          }
          const keys = history.events.map(
            (event) => `funding:${row.document.id}:${event.eventBlock}`,
          );
          const previous = await db.query<{ document: PerpsPaperMovement }>(
            `WITH ledger AS (${paperLedger})
            SELECT document FROM ledger WHERE account_id=$1 AND key=ANY($2::text[])
            UNION ALL SELECT document FROM pickler.paper_funding_postings WHERE account_id=$1 AND epoch_id=$3 AND key=ANY($2::text[])`,
            [epoch.account_id, keys, epoch.id],
          );
          const input = {
            ...account.rows[0]!.document,
            positions: [{ ...row.document, openedAt: from, closedAt: to }],
            fundingDisputed: false,
          };
          const result = applyPaperObservation(
            input,
            previous.rows.map((r) => r.document),
            { frames: [], funding: [history] },
            `audit:${epoch.id}`,
            Number(epoch.cutoff_at),
          );
          if (result.account.fundingDisputed) {
            await db.query(
              "UPDATE pickler.paper_funding_epochs SET status='disputed',error='FUNDING_DISPUTED',owner=NULL,expires_at=NULL WHERE id=$1",
              [epoch.id],
            );
            await db.query(
              `UPDATE pickler.perps_paper_accounts SET document=jsonb_set(jsonb_set(document,'{fundingDisputed}','true'),'{fundingPending}','true') WHERE id=$1`,
              [epoch.account_id],
            );
            return;
          }
          if (result.account.fundingPending) {
            throw new PilotError(
              "FUNDING_PENDING",
              "Historical funding contains unverified events",
            );
          }
          let delta = 0n;
          for (const movement of result.movements) {
            const inserted = await db.query(
              `INSERT INTO pickler.paper_funding_postings(account_id,key,epoch_id,delta,document)
              VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING key`,
              [epoch.account_id, movement.key, epoch.id, movement.delta, movement],
            );
            if (inserted.rowCount) {
              delta += paperUnits(movement.delta);
            }
          }
          await db.query(
            `UPDATE pickler.paper_funding_epochs SET cursor=$2,event_cursor=$4,delta=delta+$3::numeric,
            expires_at=floor(extract(epoch FROM clock_timestamp())*1000)+60000 WHERE id=$1`,
            [
              epoch.id,
              to < Math.min(row.document.closedAt!, Number(epoch.cutoff_at))
                ? epoch.cursor
                : row.sequence,
              paperDecimal(delta),
              to < Math.min(row.document.closedAt!, Number(epoch.cutoff_at)) ? to - 30000 : null,
            ],
          );
        });
        const status = await this.pool.query(
          "SELECT status FROM pickler.paper_funding_epochs WHERE id=$1",
          [epoch.id],
        );
        if (status.rows[0].status === "disputed") {
          return { kind: "disputed" as const };
        }
        if (to < Math.min(row.document.closedAt!, Number(epoch.cutoff_at))) {
          await this.pool.query(
            "UPDATE pickler.paper_funding_epochs SET owner=NULL,expires_at=NULL WHERE id=$1 AND owner=$2",
            [epoch.id, owner],
          );
          return { kind: "continued" as const, positions: 1 };
        }
        epoch.cursor = row.sequence;
        epoch.event_cursor = null;
      }
      await verify(epoch.anchor);
      const finished = await this.transaction(async (db) => {
        const current = await db.query<{ document: PerpsPaperAccount }>(
          "SELECT document FROM pickler.perps_paper_accounts WHERE id=$1 FOR UPDATE",
          [epoch.account_id],
        );
        const committed = await db.query(
          `UPDATE pickler.paper_funding_epochs e
          SET status='committed',committed_at=floor(extract(epoch FROM clock_timestamp())*1000),owner=NULL,expires_at=NULL
          WHERE id=$1 AND owner=$2 AND status='running'
            AND expires_at>floor(extract(epoch FROM clock_timestamp())*1000)
            AND NOT EXISTS(SELECT 1 FROM pickler.perps_paper_positions p WHERE p.account_id=e.account_id
              AND p.closed_at IS NOT NULL AND p.closed_sequence>e.cursor AND p.closed_sequence<=e.max_sequence)
          RETURNING delta::text,max_sequence::text,committed_at::text`,
          [epoch.id, owner],
        );
        const value = committed.rows[0];
        if (!value) {
          await db.query(
            "UPDATE pickler.paper_funding_epochs SET owner=NULL,expires_at=NULL WHERE id=$1 AND owner=$2",
            [epoch.id, owner],
          );
          return false;
        }
        const open = await db.query<{ document: PerpsPaperPosition }>(
          "SELECT document FROM pickler.perps_paper_positions WHERE account_id=$1 AND closed_at IS NULL",
          [epoch.account_id],
        );
        const account = {
          ...current.rows[0]!.document,
          positions: open.rows.map((row) => row.document),
        };
        account.cash = paperDecimal(paperUnits(account.cash) + paperUnits(value.delta));
        account.blocked ||= paperUnits(account.cash) <= 0n;
        // Use the unchanged financial formulas on current exposure. Storage's historical
        // coverage overlay is intentionally absent, so temporary audit pending cannot stick.
        const refreshed = applyPaperObservation(
          account,
          [],
          { frames: [], funding: [], marksOnly: true },
          `epoch:${epoch.id}`,
          Number(value.committed_at),
        ).account;
        await db.query("UPDATE pickler.perps_paper_accounts SET document=$2 WHERE id=$1", [
          epoch.account_id,
          { ...refreshed, positions: [] },
        ]);
        await db.query(
          `INSERT INTO pickler.paper_daily_totals(account_id,day,realized)
          VALUES($1,($2::bigint/86400000)*86400000,$3)
          ON CONFLICT(account_id,day) DO UPDATE SET realized=paper_daily_totals.realized+excluded.realized`,
          [epoch.account_id, value.committed_at, value.delta],
        );
        await recordEpoch(db, epoch.account_id, epoch.id, Number(value.committed_at), value.delta);
        await advanceRecordProjection(db, epoch.account_id);
        await db.query(
          `UPDATE pickler.paper_storage SET revision=revision+1,coverage_complete=CASE WHEN EXISTS(SELECT 1 FROM pickler.perps_paper_positions p WHERE p.account_id=$1
          AND p.closed_at IS NOT NULL AND p.closed_sequence<=$2 AND p.closed_at>$3) THEN coverage_complete ELSE greatest(coverage_complete,$2) END WHERE account_id=$1`,
          [epoch.account_id, value.max_sequence, epoch.cutoff_at],
        );
        return true;
      });
      return {
        kind: finished ? ("complete" as const) : ("continued" as const),
        positions: page.rows.length,
      };
    } catch (error) {
      await this.pool.query(
        "UPDATE pickler.paper_funding_epochs SET owner=NULL,expires_at=NULL WHERE id=$1 AND owner=$2",
        [epoch.id, owner],
      );
      throw error;
    }
  }
}
