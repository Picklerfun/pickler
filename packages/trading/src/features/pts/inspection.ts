import { PilotError } from "@pickler/core";
import { analyzePts } from "./signals.js";
import { closedSeries, aggregateDays, ptsCoverage } from "./calendar.js";
import type { PtsAnalysis, PtsBar, PtsHistory } from "./types.js";

/** Evidence inspection only. Invalid original bars never become executable strategy inputs. */
export function inspectPtsHistory(history: PtsHistory, at: number) {
  try {
    return { ...analyzePts(history, at), validationStatus: "VALID" as const };
  } catch (error) {
    if (
      !(error instanceof PilotError) ||
      !["INVALID_MARKET_DATA", "PERPL_MARKET_IDENTITY"].includes(error.code)
    ) {
      throw error;
    }
    const native = new Map<number, PtsBar[]>();
    const issues: { resolution: number; index: number; openTime: number; code: string }[] = [];
    for (const resolution of [86400, 14400, 3600]) {
      const matches = history.series.filter((s) => s.resolution === resolution);
      const valid: PtsBar[] = [];
      for (const series of matches) {
        for (const [index, candle] of series.candles.entries()) {
          if (!candle.closed || candle.openTime + resolution * 1000 > at) {
            continue;
          }
          try {
            const one = closedSeries({ ...series, candles: [candle] }, at)[0]!;
            if (one.openTime <= (valid.at(-1)?.openTime ?? -1)) {
              throw new PilotError("INVALID_MARKET_DATA", "Duplicate or unordered recorded candle");
            }
            valid.push(one);
          } catch (failure) {
            if (!(failure instanceof PilotError)) {
              throw failure;
            }
            issues.push({ resolution, index, openTime: candle.openTime, code: failure.code });
          }
        }
      }
      native.set(
        resolution,
        error.code === "PERPL_MARKET_IDENTITY" || matches.length > 1 ? [] : valid,
      );
    }
    const days = native.get(86400)!;
    const coverage = ptsCoverage(
      {
        "1d": days,
        "4h": native.get(14400)!,
        "1h": native.get(3600)!,
        "1M": aggregateDays(days, "1M", at),
        "1w": aggregateDays(days, "1w", at),
      },
      at,
    );
    const analysis: PtsAnalysis = {
      version: "0.2.0",
      at,
      symbol: history.market.symbol,
      action: "hold",
      reason: "NOT_VERIFIABLE",
      setup: null,
      coverage,
      checks: [
        {
          code: "RECORDED_HISTORY_INVALID",
          passed: null,
          values: {
            code: error.code,
            invalidBars: issues.length,
            retainedIssues: issues.slice(0, 32),
            issuesTruncated: issues.length > 32,
            interpretation:
              "Counts inspect valid original bars only; invalid bars are retained in the source, never repaired or admitted. This is not a valid strategy abstention.",
          },
        },
      ],
    };
    return { ...analysis, validationStatus: "NOT_VERIFIABLE" as const };
  }
}
