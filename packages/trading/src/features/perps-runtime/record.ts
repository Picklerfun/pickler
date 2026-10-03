import type { PerpsPaperMovement } from "../perps-paper/types.js";
import { utcDayStart } from "./exits.js";
import { microAusd } from "./sizing.js";

const HOUR_MS = 3_600_000;

/** A paper ledger movement; `delta` may be the store's decimal string. */
export interface RecordMovement {
  kind: PerpsPaperMovement["kind"];
  delta: string | number;
  at: number;
}

export interface RecordInput {
  movements: RecordMovement[];
  /** Closed positions with their net realized P&L (fees and funding included), in AUSD. */
  closed: Array<{ closedAt: number; pnl: number }>;
  /** Unrealized P&L of open positions marked to the board; null when a mark is unknown. */
  openPnl: number | null;
  checks: number;
  entries: number;
  now: number;
  /** How many hours back the equity series reaches (default 720, thirty days). */
  hours?: number;
}

export interface EquityPoint {
  at: number;
  equity: number;
}

export interface PerpsRecordStats {
  realizedAusd: number;
  realizedTodayAusd: number;
  openPnlAusd: number | null;
  feesAndFundingAusd: number;
  /** Paper cash: every movement, the initial stake included. */
  cashAusd: number;
  /** Cash plus open P&L; null when open P&L is unknown. */
  equityAusd: number | null;
  closedCount: number;
  wins: number;
  /** Closed positions with pnl > 0 over closed positions; null before the first close. */
  hitRate: number | null;
  maxDrawdownAusd: number;
  /** The worst drawdown as a fraction of the peak it fell from; null without one. */
  maxDrawdownPct: number | null;
  checks: number;
  entries: number;
  /** One point per hour, per close and now, oldest first. */
  series: EquityPoint[];
}

export const RECORD_SERIES_HOURS = 720;

function amount(movement: RecordMovement): number {
  return Number(movement.delta);
}

/** Realized P&L (every movement but the initial stake) at or after `since`. */
export function realizedSince(movements: RecordMovement[], since: number): number {
  let sum = 0;
  for (const movement of movements) {
    if (movement.kind !== "initial" && movement.at >= since) {
      sum += amount(movement);
    }
  }
  return microAusd(sum);
}

/** R13: the record from the paper ledger. */
export function recordStats(input: RecordInput): PerpsRecordStats {
  const movements = [...input.movements].sort((a, b) => a.at - b.at);

  let cash = 0;
  let feesAndFunding = 0;
  for (const movement of movements) {
    cash += amount(movement);
    if (movement.kind === "fee" || movement.kind === "funding") {
      feesAndFunding += amount(movement);
    }
  }
  cash = microAusd(cash);

  const equityAt = (at: number) => {
    let sum = 0;
    for (const movement of movements) {
      if (movement.at > at) {
        break;
      }
      sum += amount(movement);
    }
    return microAusd(sum);
  };
  const last = input.openPnl === null ? cash : microAusd(cash + input.openPnl);

  // Drawdown over equity after each instant (movements sharing a time count together), then now.
  const instants = [...new Set(movements.map((movement) => movement.at))];
  const curve = instants.map(equityAt);
  if (movements.length) {
    curve.push(last);
  }
  let peak = Number.NEGATIVE_INFINITY;
  let maxDrawdown = 0;
  let drawdownPeak = 0;
  for (const value of curve) {
    peak = Math.max(peak, value);
    if (peak - value > maxDrawdown) {
      maxDrawdown = peak - value;
      drawdownPeak = peak;
    }
  }
  maxDrawdown = microAusd(maxDrawdown);

  const series: EquityPoint[] = [];
  if (movements.length) {
    const from = Math.max(
      movements[0]!.at,
      input.now - (input.hours ?? RECORD_SERIES_HOURS) * HOUR_MS,
    );
    const times = new Set<number>();
    for (let at = Math.ceil(from / HOUR_MS) * HOUR_MS; at < input.now; at += HOUR_MS) {
      times.add(at);
    }
    for (const position of input.closed) {
      if (position.closedAt >= from && position.closedAt < input.now) {
        times.add(position.closedAt);
      }
    }
    for (const at of [...times].sort((a, b) => a - b)) {
      series.push({ at, equity: equityAt(at) });
    }
    series.push({ at: input.now, equity: last });
  }

  const wins = input.closed.filter((position) => position.pnl > 0).length;

  return {
    realizedAusd: realizedSince(movements, Number.NEGATIVE_INFINITY),
    realizedTodayAusd: realizedSince(movements, utcDayStart(input.now)),
    openPnlAusd: input.openPnl,
    feesAndFundingAusd: microAusd(feesAndFunding),
    cashAusd: cash,
    equityAusd: input.openPnl === null ? null : last,
    closedCount: input.closed.length,
    wins,
    hitRate: input.closed.length ? wins / input.closed.length : null,
    maxDrawdownAusd: maxDrawdown,
    maxDrawdownPct: maxDrawdown > 0 && drawdownPeak > 0 ? maxDrawdown / drawdownPeak : null,
    checks: input.checks,
    entries: input.entries,
    series,
  };
}
