import type { Pool } from "pg";
import { PilotError } from "@pickler/core";
import { positionPnl } from "./paper-operational-read.js";
import {
  advanceRecordProjection,
  backfillRecordPage,
  backfillRecordClosesPage,
} from "./paper-record-projection.js";

/** Explicit operator operation. Never invoked by account reads, runtime startup or a model. */
export async function migratePaperAccount(pool: Pool, accountId: string, apply = false) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT set_config('pickler.paper_migration','1',true)");
    const found = await db.query(
      `SELECT a.id,s.mode,s.cursor,s.phase,
      jsonb_array_length(coalesce(a.document->'positions','[]')) AS positions,
      EXISTS(SELECT 1 FROM pickler.perps_paper_positions p WHERE p.account_id=a.id AND p.closed_at IS NULL) AS open,
      EXISTS(SELECT 1 FROM pickler.perps_paper_attempts t WHERE t.account_id=a.id AND t.owner IS NOT NULL
        AND t.expires_at>floor(extract(epoch FROM clock_timestamp())*1000)) AS busy
      FROM pickler.perps_paper_accounts a LEFT JOIN pickler.paper_storage s ON s.account_id=a.id
      WHERE a.id=$1 FOR UPDATE OF a`,
      [accountId],
    );
    const row = found.rows[0];
    if (!row) {
      throw new PilotError("NOT_FOUND", "Paper account not found");
    }
    if (!apply || row.mode === "operational") {
      await db.query("COMMIT");
      return {
        accountId,
        mode: row.mode ?? "legacy",
        positions: row.positions,
        eligible: !row.open && !row.busy,
        complete: row.mode === "operational",
      };
    }
    if (row.open || row.busy) {
      throw new PilotError(
        "CONFLICT",
        "Close existing positions and finish current attempts before conversion",
      );
    }
    await db.query(
      `INSERT INTO pickler.paper_storage(account_id,mode,original,cursor)
      SELECT id,'frozen',document,'0' FROM pickler.perps_paper_accounts WHERE id=$1
      ON CONFLICT(account_id) DO UPDATE SET mode='frozen',original=coalesce(paper_storage.original,excluded.original),
        cursor=paper_storage.cursor`,
      [accountId],
    );
    const progress = (
      await db.query("SELECT phase,cursor FROM pickler.paper_storage WHERE account_id=$1", [
        accountId,
      ])
    ).rows[0];
    let phase: string = progress.phase;
    let cursor: string | null = progress.cursor;
    let complete = false;
    if (phase === "positions") {
      const copied = await db.query(
        `WITH page AS MATERIALIZED(
        SELECT s.original->'positions'->((x.ordinality-1)::int) AS value,x.ordinality
        FROM pickler.paper_storage s CROSS JOIN LATERAL generate_series(
          coalesce(s.cursor,'0')::bigint+1,
          least(coalesce(s.cursor,'0')::bigint+100,jsonb_array_length(coalesce(s.original->'positions','[]')))
        ) x(ordinality) WHERE s.account_id=$1 ORDER BY x.ordinality
      ), inserted AS (
        INSERT INTO pickler.perps_paper_positions(account_id,id,symbol,closed_at,document,
          check_id,config_version,leverage,margin,stop_price,take_profit_price,exit_due_at,close_reason)
        SELECT $1,value->>'id',value->>'symbol',(value->>'closedAt')::bigint,value,
          (value->>'checkId')::uuid,(value->>'configVersion')::int,(value->>'leverage')::int,
          (value->>'margin')::numeric,(value->>'stopPrice')::numeric,(value->>'takeProfitPrice')::numeric,
          (value->>'exitDueAt')::bigint,value->>'closeReason' FROM page
        ON CONFLICT(account_id,id) DO UPDATE SET closed_sequence=perps_paper_positions.closed_sequence
        RETURNING id,document
      ) SELECT p.ordinality::text,p.value->>'id' AS id,p.value=i.document AS matches
        FROM page p JOIN inserted i ON i.id=p.value->>'id' ORDER BY p.ordinality`,
        [accountId],
      );
      if (copied.rows.some((item) => !item.matches)) {
        throw new PilotError(
          "CONFLICT",
          "Normalized position evidence differs from preserved account",
        );
      }
      cursor = copied.rows.at(-1)?.ordinality ?? cursor;
      if (Number(cursor) >= row.positions) {
        phase = "totals";
        cursor = null;
      }
    } else if (phase === "totals") {
      const page = await db.query(
        `SELECT id FROM pickler.perps_paper_positions
        WHERE account_id=$1 AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT 100`,
        [accountId, cursor],
      );
      for (const item of page.rows) {
        const pnl = await positionPnl(db, accountId, item.id);
        await db.query(
          `INSERT INTO pickler.paper_position_totals(account_id,position_id,pnl)
          VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
          [accountId, item.id, pnl],
        );
      }
      cursor = page.rows.at(-1)?.id ?? cursor;
      if (page.rows.length < 100) {
        phase = "ledger";
        cursor = null;
      }
    } else if (phase === "ledger") {
      // Copy facts and daily realized totals from the same immutable <=100 movement keys.
      await db.query(
        `WITH page AS MATERIALIZED (
        SELECT document FROM pickler.perps_paper_movements WHERE account_id=$1
          AND ($2::text IS NULL OR key>$2) ORDER BY key LIMIT 100
      ) INSERT INTO pickler.paper_daily_totals(account_id,day,realized)
        SELECT $1,floor((document->>'at')::numeric/86400000)::bigint*86400000,
          sum((document->>'delta')::numeric) FROM page WHERE document->>'kind'<>'initial' GROUP BY 2
        ON CONFLICT(account_id,day) DO UPDATE SET realized=paper_daily_totals.realized+excluded.realized`,
        [accountId, cursor],
      );
      const result = await backfillRecordPage(db, accountId, cursor);
      cursor = result.afterKey;
      if (result.done) {
        phase = "sizeups";
        cursor = null;
      }
    } else if (phase === "sizeups") {
      const page = await db.query(
        `WITH parents AS MATERIALIZED (
        SELECT id,document,jsonb_array_length(coalesce(document->'sizeUps','[]')) AS total
        FROM pickler.perps_paper_positions WHERE account_id=$1
          AND ($2::jsonb IS NULL OR id>=($2::jsonb->>0)) ORDER BY id LIMIT 100
      ), page AS MATERIALIZED (
        SELECT p.id,x.ordinality,p.document->'sizeUps'->((x.ordinality-1)::int) AS value FROM parents p
        CROSS JOIN LATERAL generate_series(
          CASE WHEN p.id=($2::jsonb->>0) THEN ($2::jsonb->>1)::int+1 ELSE 1 END,
          least(p.total,CASE WHEN p.id=($2::jsonb->>0) THEN ($2::jsonb->>1)::int+100 ELSE 100 END)
        ) x(ordinality) ORDER BY p.id,x.ordinality LIMIT 100
      ), inserted AS (
        INSERT INTO pickler.paper_position_sizeups(account_id,position_id,key,at,margin)
        SELECT $1,id,'legacy:'||ordinality,(value->>'at')::bigint,(value->>'margin')::numeric
        FROM page ORDER BY id,ordinality ON CONFLICT DO NOTHING RETURNING position_id,at,margin
      ), totals AS (
        UPDATE pickler.paper_position_totals t SET sizeup_margin=t.sizeup_margin+x.margin
        FROM (SELECT position_id,sum(margin) AS margin FROM inserted GROUP BY position_id) x
        WHERE t.account_id=$1 AND t.position_id=x.position_id
      ), daily AS (
        INSERT INTO pickler.paper_daily_totals(account_id,day,margin)
        SELECT $1,(at/86400000)*86400000,sum(margin) FROM inserted GROUP BY 2
        ON CONFLICT(account_id,day) DO UPDATE SET margin=paper_daily_totals.margin+excluded.margin
      ) SELECT (SELECT count(*)::int FROM page) AS facts,(SELECT count(*)::int FROM parents) AS parents,
        (SELECT jsonb_build_array(id,ordinality) FROM page ORDER BY id DESC,ordinality DESC LIMIT 1) AS last_fact,
        (SELECT jsonb_build_array(id,total) FROM parents ORDER BY id DESC LIMIT 1) AS last_parent`,
        [accountId, cursor],
      );
      const result = page.rows[0];
      cursor = JSON.stringify(result.facts === 100 ? result.last_fact : result.last_parent);
      if (result.facts < 100 && result.parents < 100) {
        phase = "compact";
        cursor = null;
      }
    } else if (phase === "compact") {
      const page = await db.query(
        `WITH page AS MATERIALIZED (
        SELECT p.id,(p.document->>'openedAt')::bigint AS at,
          coalesce(p.document->>'margin',p.document->>'entryNotional')::numeric-coalesce(t.sizeup_margin,0) AS margin
        FROM pickler.perps_paper_positions p LEFT JOIN pickler.paper_position_totals t ON t.account_id=p.account_id AND t.position_id=p.id
        WHERE p.account_id=$1 AND ($2::text IS NULL OR p.id>$2) ORDER BY p.id LIMIT 100
      ), daily AS (
        INSERT INTO pickler.paper_daily_totals(account_id,day,margin)
        SELECT $1,(at/86400000)*86400000,sum(margin) FROM page GROUP BY 2
        ON CONFLICT(account_id,day) DO UPDATE SET margin=paper_daily_totals.margin+excluded.margin
      ), updated AS (
        UPDATE pickler.perps_paper_positions SET document=document-'sizeUps'
        WHERE account_id=$1 AND id IN (SELECT id FROM page)
      ) SELECT id FROM page ORDER BY id`,
        [accountId, cursor],
      );
      cursor = page.rows.at(-1)?.id ?? cursor;
      if (page.rows.length < 100) {
        phase = "closes";
        cursor = null;
      }
    } else if (phase === "closes") {
      const result = await backfillRecordClosesPage(db, accountId, cursor);
      cursor = result.afterKey;
      if (result.done) {
        phase = "projection";
        cursor = null;
      }
    } else if (phase === "projection") {
      complete = Boolean(await advanceRecordProjection(db, accountId));
      if (complete) {
        await db.query(
          `UPDATE pickler.perps_paper_accounts SET document=document-'positions'||'{"positions":[]}'::jsonb WHERE id=$1`,
          [accountId],
        );
        await db.query(
          `UPDATE pickler.paper_storage SET mode='operational',
          coverage_required=coalesce((SELECT max(closed_sequence) FROM pickler.perps_paper_positions WHERE account_id=$1),0)
          WHERE account_id=$1`,
          [accountId],
        );
        phase = "complete";
      }
    } else {
      throw new PilotError("CONFLICT", "Unknown Paper migration phase");
    }
    await db.query("UPDATE pickler.paper_storage SET phase=$2,cursor=$3 WHERE account_id=$1", [
      accountId,
      phase,
      cursor,
    ]);
    await db.query("COMMIT");
    return { accountId, mode: complete ? "operational" : "frozen", phase, cursor, complete };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
