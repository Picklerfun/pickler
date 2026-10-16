import type { Pool } from "pg";
import { paperUnits, paperDecimal } from "@pickler/trading/perps";

// All monetary checkpoint values are integer paper units serialized as strings.
// Call mutation hooks inside the transaction already holding the paper account fence.
type Database = Pick<Pool, "query">;
type Fact = { key: string; at: number; kind: string; delta: string; sequence?: string };
type Fold = {
  cash: string;
  realized: string;
  fees: string;
  peak: string;
  drawdown: string;
  drawdownPeak: string;
  firstAt: number | null;
  lastAt: number | null;
  group: { cash: string; peak: string; drawdown: string; drawdownPeak: string; delta: string };
  hours: Array<{ at: number; cash: string }>;
};
type Checkpoint = {
  fold: Fold;
  cursor: string;
  ready: boolean;
  dirty: boolean;
  pending: boolean;
  closedCount: number;
  wins: number;
  rebuild: null | { max: string; afterAt: number | null; afterKey: string; fold: Fold };
};
const HOUR = 3_600_000;
const BATCH = 100;
function emptyFold(): Fold {
  return {
    cash: "0",
    realized: "0",
    fees: "0",
    peak: "0",
    drawdown: "0",
    drawdownPeak: "0",
    firstAt: null,
    lastAt: null,
    group: { cash: "0", peak: "0", drawdown: "0", drawdownPeak: "0", delta: "0" },
    hours: [],
  };
}
function empty(): Checkpoint {
  return {
    fold: emptyFold(),
    cursor: "0",
    ready: false,
    dirty: false,
    pending: false,
    closedCount: 0,
    wins: 0,
    rebuild: null,
  };
}
function maximum(a: bigint, b: bigint) {
  return a > b ? a : b;
}
function apply(fold: Fold, fact: Fact) {
  const delta = paperUnits(fact.delta);
  if (fold.lastAt !== null && fact.at < fold.lastAt) {
    throw new Error("PAPER_RECORD_OUT_OF_ORDER");
  }
  if (fold.lastAt !== fact.at) {
    if (fold.lastAt !== null) {
      const from = Math.max(
        Math.floor(fold.lastAt / HOUR) * HOUR + HOUR,
        Math.ceil((fact.at - 720 * HOUR) / HOUR) * HOUR,
      );
      for (let at = from; at < fact.at; at += HOUR) {
        fold.hours.push({ at, cash: fold.cash });
      }
    }
    fold.group = {
      cash: fold.cash,
      peak: fold.peak,
      drawdown: fold.drawdown,
      drawdownPeak: fold.drawdownPeak,
      delta: "0",
    };
    fold.lastAt = fact.at;
    fold.firstAt ??= fact.at;
  }
  fold.group.delta = String(BigInt(fold.group.delta) + delta);
  const cash = BigInt(fold.group.cash) + BigInt(fold.group.delta);
  const peak = maximum(BigInt(fold.group.peak), cash);
  const drop = peak - cash;
  fold.cash = String(cash);
  fold.peak = String(peak);
  fold.drawdown = String(maximum(BigInt(fold.group.drawdown), drop));
  fold.drawdownPeak = drop > BigInt(fold.group.drawdown) ? String(peak) : fold.group.drawdownPeak;
  if (fact.kind !== "initial") {
    fold.realized = String(BigInt(fold.realized) + delta);
  }
  if (fact.kind === "fee" || fact.kind === "funding") {
    fold.fees = String(BigInt(fold.fees) + delta);
  }
  fold.hours = fold.hours.filter((p) => p.at >= fact.at - 720 * HOUR && p.at !== fact.at);
  if (fact.at % HOUR === 0) {
    fold.hours.push({ at: fact.at, cash: fold.cash });
  }
}
async function lock(db: Database, accountId: string) {
  await db.query(
    "INSERT INTO pickler.paper_record_state(account_id,document) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [accountId, empty()],
  );
  return (
    await db.query<{ document: Checkpoint }>(
      "SELECT document FROM pickler.paper_record_state WHERE account_id=$1 FOR UPDATE",
      [accountId],
    )
  ).rows[0]!.document;
}
async function save(db: Database, accountId: string, state: Checkpoint) {
  await db.query(
    "UPDATE pickler.paper_record_state SET document=$2,revision=revision+1,complete=$3 WHERE account_id=$1",
    [accountId, state, state.ready && !state.dirty && !state.pending && state.rebuild === null],
  );
}
export async function recordMovement(db: Database, accountId: string, movement: Fact) {
  const state = await lock(db, accountId);
  const inserted = await db.query<{ sequence: string }>(
    `INSERT INTO pickler.paper_record_facts(account_id,key,at,kind,delta)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING sequence::text`,
    [accountId, movement.key, movement.at, movement.kind, movement.delta],
  );
  if (!inserted.rows[0]) {
    const old = (
      await db.query<Fact>(
        "SELECT key,at,kind,delta FROM pickler.paper_record_facts WHERE account_id=$1 AND key=$2",
        [accountId, movement.key],
      )
    ).rows[0]!;
    if (
      Number(old.at) !== movement.at ||
      old.kind !== movement.kind ||
      paperUnits(old.delta) !== paperUnits(movement.delta)
    ) {
      throw new Error("PAPER_RECORD_CONFLICT");
    }
    return;
  }
  if (movement.kind === "initial" && state.cursor === "0" && !state.rebuild) {
    state.ready = true;
  }
  if (state.rebuild || state.pending) {
    state.pending = true;
  } else if (state.dirty || (state.fold.lastAt !== null && movement.at < state.fold.lastAt)) {
    state.dirty = true;
  } else {
    apply(state.fold, movement);
    state.cursor = inserted.rows[0].sequence;
  }
  await save(db, accountId, state);
}
export async function recordEpoch(
  db: Database,
  accountId: string,
  epochId: string,
  bookingAt: number,
  delta: string,
) {
  // One epoch's funding postings have one booking time and kind. Their aggregate is exactly
  // equivalent to the existing same-timestamp grouping, without an unbounded final write.
  await recordMovement(db, accountId, {
    key: `epoch:${epochId}`,
    kind: "funding",
    at: bookingAt,
    delta,
  });
}
export async function recordClosedPosition(
  db: Database,
  accountId: string,
  positionId: string,
  pnl: string,
) {
  const state = await lock(db, accountId);
  const old = (
    await db.query<{ pnl: string }>(
      "SELECT pnl FROM pickler.paper_record_closes WHERE account_id=$1 AND position_id=$2 FOR UPDATE",
      [accountId, positionId],
    )
  ).rows[0];
  await db.query(
    `INSERT INTO pickler.paper_record_closes(account_id,position_id,pnl) VALUES($1,$2,$3)
    ON CONFLICT(account_id,position_id) DO UPDATE SET pnl=excluded.pnl`,
    [accountId, positionId, pnl],
  );
  if (!old) {
    state.closedCount++;
  }
  state.wins += (paperUnits(pnl) > 0n ? 1 : 0) - (old && paperUnits(old.pnl) > 0n ? 1 : 0);
  await save(db, accountId, state);
}
/** One page only, under an account transaction. A fixed watermark cannot be reset by arrivals. */
export async function advanceRecordProjection(db: Database, accountId: string) {
  const state = await lock(db, accountId);
  if (!state.rebuild && state.dirty) {
    const max = (
      await db.query<{ max: string }>(
        "SELECT coalesce(max(sequence),0)::text AS max FROM pickler.paper_record_facts WHERE account_id=$1",
        [accountId],
      )
    ).rows[0]!.max;
    state.rebuild = { max, afterAt: null, afterKey: "", fold: emptyFold() };
    state.dirty = false;
  }
  if (state.rebuild) {
    const phase = state.rebuild;
    const facts = await db.query<Fact>(
      `SELECT key,at::double precision AS at,kind,delta FROM pickler.paper_record_facts
      WHERE account_id=$1 AND sequence<=$2::bigint AND ($3::bigint IS NULL OR (at,key)>($3::bigint,$4::text))
      ORDER BY at,key LIMIT ${BATCH}`,
      [accountId, phase.max, phase.afterAt, phase.afterKey],
    );
    for (const fact of facts.rows) {
      apply(phase.fold, fact);
      phase.afterAt = fact.at;
      phase.afterKey = fact.key;
    }
    const more = (
      await db.query(
        `SELECT 1 FROM pickler.paper_record_facts WHERE account_id=$1 AND sequence<=$2::bigint
      AND ($3::bigint IS NULL OR (at,key)>($3::bigint,$4::text)) LIMIT 1`,
        [accountId, phase.max, phase.afterAt, phase.afterKey],
      )
    ).rowCount;
    if (!more) {
      state.fold = phase.fold;
      state.cursor = phase.max;
      state.rebuild = null;
    }
  } else {
    const pending = await db.query<Fact>(
      `SELECT key,at::double precision AS at,kind,delta,sequence::text
      FROM pickler.paper_record_facts f WHERE account_id=$1 AND sequence>$2::bigint ORDER BY f.sequence LIMIT ${BATCH}`,
      [accountId, state.cursor],
    );
    for (const fact of pending.rows) {
      if (state.fold.lastAt !== null && fact.at < state.fold.lastAt) {
        state.dirty = true;
        break;
      }
      apply(state.fold, fact);
      state.cursor = fact.sequence!;
    }
  }
  if (!state.rebuild && !state.dirty) {
    state.pending = Boolean(
      (
        await db.query(
          "SELECT 1 FROM pickler.paper_record_facts WHERE account_id=$1 AND sequence>$2::bigint LIMIT 1",
          [accountId, state.cursor],
        )
      ).rowCount,
    );
  }
  await save(db, accountId, state);
  return state.ready && !state.dirty && !state.pending && !state.rebuild;
}
/** Migration only: copy <=100 immutable ledger facts server-side, never export documents. */
export async function backfillRecordPage(db: Database, accountId: string, afterKey: string | null) {
  const state = await lock(db, accountId);
  const page = await db.query<{ key: string }>(
    `WITH page AS MATERIALIZED (
      SELECT key,document FROM pickler.perps_paper_movements WHERE account_id=$1 AND ($2::text IS NULL OR key>$2)
      ORDER BY key LIMIT ${BATCH}
    ), copied AS (
      INSERT INTO pickler.paper_record_facts(account_id,key,at,kind,delta)
      SELECT $1,key,(document->>'at')::bigint,document->>'kind',document->>'delta' FROM page
      ON CONFLICT DO NOTHING
    ) SELECT key FROM page ORDER BY key`,
    [accountId, afterKey],
  );
  state.dirty = true;
  if (page.rows.length < BATCH) {
    state.ready = true;
  }
  await save(db, accountId, state);
  return { afterKey: page.rows.at(-1)?.key ?? afterKey, done: page.rows.length < BATCH };
}
export async function backfillRecordClosesPage(
  db: Database,
  accountId: string,
  afterKey: string | null,
) {
  const state = await lock(db, accountId);
  const page = await db.query<{ id: string; pnl: string }>(
    `SELECT t.position_id AS id,t.pnl::text FROM pickler.paper_position_totals t
    JOIN pickler.perps_paper_positions p ON p.account_id=t.account_id AND p.id=t.position_id
    WHERE t.account_id=$1 AND p.closed_at IS NOT NULL
      AND ($2::text IS NULL OR t.position_id>$2) ORDER BY t.position_id LIMIT ${BATCH}`,
    [accountId, afterKey],
  );
  for (const row of page.rows) {
    const old = await db.query(
      "SELECT 1 FROM pickler.paper_record_closes WHERE account_id=$1 AND position_id=$2",
      [accountId, row.id],
    );
    if (!old.rowCount) {
      await db.query(
        "INSERT INTO pickler.paper_record_closes(account_id,position_id,pnl) VALUES($1,$2,$3)",
        [accountId, row.id, row.pnl],
      );
      state.closedCount++;
      if (paperUnits(row.pnl) > 0n) {
        state.wins++;
      }
    }
  }
  await save(db, accountId, state);
  return { afterKey: page.rows.at(-1)?.id ?? afterKey, done: page.rows.length < BATCH };
}
/** Point state plus at most 721 hourly samples; no ledger scan on HTTP reads. */
export async function readRecordProjection(
  db: Database,
  accountId: string,
  now: number,
  openPnl: string | null,
) {
  const row = (
    await db.query<{ document: Checkpoint; revision: string; complete: boolean }>(
      "SELECT document,revision::text,complete FROM pickler.paper_record_state WHERE account_id=$1",
      [accountId],
    )
  ).rows[0];
  const state = row?.document ?? empty(),
    fold = state.fold;
  const cash = BigInt(fold.cash),
    open = openPnl === null ? null : paperUnits(openPnl);
  const equity = open === null ? null : cash + open;
  const peak = maximum(BigInt(fold.peak), equity ?? cash);
  const currentDrawdown = peak - (equity ?? cash);
  const worst = maximum(BigInt(fold.drawdown), currentDrawdown);
  const worstPeak = currentDrawdown > BigInt(fold.drawdown) ? peak : BigInt(fold.drawdownPeak);
  const number = (n: bigint) => Number(paperDecimal(n));
  const series: Array<{ at: number; equity: number }> = [];
  if (fold.firstAt !== null) {
    const hours = new Map(fold.hours.map((p) => [p.at, p.cash]));
    let previous = fold.hours[0]?.cash ?? fold.cash;
    const from = Math.ceil(Math.max(fold.firstAt, now - 720 * HOUR) / HOUR) * HOUR;
    for (let at = from; at < now; at += HOUR) {
      previous =
        hours.get(at) ?? (fold.lastAt !== null && at >= fold.lastAt ? fold.cash : previous);
      series.push({ at, equity: number(BigInt(previous)) });
    }
    series.push({ at: now, equity: number(equity ?? cash) });
  }
  return {
    projection: {
      revision: row?.revision ?? "0",
      asOf: row?.complete ? now : (fold.lastAt ?? now),
      complete: row?.complete ?? false,
    },
    realizedAusd: number(BigInt(fold.realized)),
    feesAndFundingAusd: number(BigInt(fold.fees)),
    cashAusd: number(cash),
    openPnlAusd: open === null ? null : number(open),
    equityAusd: equity === null ? null : number(equity),
    closedCount: state.closedCount,
    wins: state.wins,
    hitRate: state.closedCount ? state.wins / state.closedCount : null,
    maxDrawdownAusd: number(worst),
    maxDrawdownPct: worst > 0n && worstPeak > 0n ? Number(worst) / Number(worstPeak) : null,
    checks: 0,
    entries: 0,
    series,
  };
}
