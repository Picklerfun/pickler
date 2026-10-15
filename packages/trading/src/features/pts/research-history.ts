import type { PerpCandles } from "@pickler/core";
import { PilotError } from "@pickler/core";
import { closedSeries, ptsSeries } from "./calendar.js";
import { ptsPivots } from "./pivots.js";
import { units } from "./math.js";
import { PTS_INTRADAY_RESPONSIVE_VERSION } from "./types.js";
import type { PtsBar, PtsHistory, PtsPeriod, PtsPivot, PtsPivotEvent } from "./types.js";

function upperBound<T>(items: readonly T[], at: number, value: (item: T) => number) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (value(items[middle]!) <= at) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

interface NativeIndex {
  source: PerpCandles | null;
  raw: PerpCandles["candles"];
  bars: PtsBar[];
  validated: number;
  monotone: boolean;
  processed: number;
  pivots: PtsPivot[];
  events: PtsPivotEvent[];
  states: { at: number; pivots: PtsPivot[]; eventCount: number }[];
}

/** Prefix indices cache only facts available by a bar's original closing/confirmation instant. */
export class PtsResearchHistoryIndex {
  private native = new Map<PtsPeriod, NativeIndex>();
  private roles = new WeakMap<PtsBar[], PtsPeriod>();

  constructor(readonly history: PtsHistory) {
    // Identity/revision checks are identical to the reference; no future candle is validated here.
    ptsSeries(
      { ...history, series: history.series.map((series) => ({ ...series, candles: [] })) },
      0,
      PTS_INTRADAY_RESPONSIVE_VERSION,
    );
    for (const [period, resolution] of [
      ["1h", 3600],
      ["15m", 900],
      ["5m", 300],
    ] as const) {
      const source = history.series.find((series) => series.resolution === resolution) ?? null;
      const raw = source?.candles.filter((bar) => bar.closed) ?? [];
      this.native.set(period, {
        source,
        raw,
        bars: [],
        validated: 0,
        monotone: raw.every((bar, i) => i === 0 || bar.openTime > raw[i - 1]!.openTime),
        processed: 0,
        pivots: [],
        events: [],
        states: [],
      });
    }
  }

  private read(period: PtsPeriod, at: number) {
    const index = this.native.get(period)!;
    const interval = index.source ? index.source.resolution * 1000 : 0;
    if (!index.monotone) {
      // Preserve original order and failure timing; sorting would invent a repaired history.
      return index.source ? closedSeries(index.source, at) : [];
    }
    const count = upperBound(index.raw, at, (bar) => bar.openTime + interval);
    while (index.validated < count) {
      const bar = index.raw[index.validated]!;
      const one = closedSeries({ ...index.source!, candles: [bar] }, at)[0]!;
      index.bars.push(one);
      index.validated++;
    }
    const bars = index.bars.slice(0, count);
    this.roles.set(bars, period);
    return bars;
  }

  series(at: number): Record<PtsPeriod, PtsBar[]> {
    if (!Number.isSafeInteger(at) || at < 0) {
      throw new PilotError("INVALID_INPUT", "Invalid offline PTS research time");
    }
    return {
      "1h": this.read("1h", at),
      "15m": this.read("15m", at),
      "5m": this.read("5m", at),
    } as Record<PtsPeriod, PtsBar[]>;
  }

  pivots(period: PtsPeriod, at: number) {
    const bars = this.read(period, at);
    const index = this.native.get(period)!;
    if (!index.monotone) {
      return ptsPivots(bars, at);
    }
    while (index.processed < bars.length) {
      const last = index.processed++;
      if (last < 4) {
        continue;
      }
      const window = index.bars.slice(last - 4, last + 1);
      const event = ptsPivots(window, window[4]!.closeTime).events[0];
      if (!event) {
        continue;
      }
      let next: PtsPivotEvent;
      if (!event.pivot) {
        next = event;
      } else {
        const pivot = event.pivot;
        const previous = index.pivots.at(-1) ?? null;
        if (previous?.kind === pivot.kind) {
          const replaces =
            pivot.kind === "high"
              ? units(pivot.price) > units(previous.price)
              : units(pivot.price) < units(previous.price);
          if (replaces) {
            index.pivots[index.pivots.length - 1] = pivot;
          }
          next = { ...event, kind: replaces ? "replaced" : "ignored", previous };
        } else {
          index.pivots.push(pivot);
          next = { ...event, previous };
        }
      }
      index.events.push(next);
      index.states.push({
        at: next.at,
        pivots: [...index.pivots],
        eventCount: index.events.length,
      });
    }
    const state = index.states[upperBound(index.states, at, (item) => item.at) - 1];
    return {
      pivots: state ? [...state.pivots] : [],
      events: state ? index.events.slice(0, state.eventCount) : [],
    };
  }

  resolvePivots = (bars: readonly PtsBar[], at: number) => {
    const period = this.roles.get(bars as PtsBar[]);
    return period ? this.pivots(period, at) : ptsPivots(bars, at);
  };

  closedFiveMinuteTimes(at: number) {
    const index = this.native.get("5m")!;
    return index.raw
      .filter((bar) => bar.openTime + 300000 <= at)
      .map((bar) => bar.openTime + 300000);
  }
}
