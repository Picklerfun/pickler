import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { normalCdf } from "@pickler/trading/strategies";
import type { QuantData } from "@pickler/infrastructure";
import { atomicWrite } from "./files.js";
/** Explicit offline proxy evaluation: never used as runtime provider fallback. */
export async function historicalQuant(data: QuantData, directory: string) {
  const end = Math.floor(Date.now() / 86400000) * 86400000,
    start = end - 7 * 86400000,
    split = start + 5 * 86400000;
  const candles = new Map<number, number>();
  for (let t = start - 61 * 60000; t < end; t += 250 * 60000) {
    for (const c of await data.candles(
      t,
      Math.min(t + 250 * 60000, end),
      AbortSignal.timeout(30000),
    )) {
      candles.set(c.time, c.close);
    }
    await setTimeout(500);
  }
  const rows: {
    window: number;
    minutes: number;
    partition: string;
    up: number;
    proxyOutcome: number;
    brier: number;
    baselineBrier: number;
  }[] = [];
  for (const minutes of [5, 15]) {
    for (let window = start; window + minutes * 60000 <= end; window += minutes * 60000) {
      const closes = Array.from({ length: 61 }, (_, i) => candles.get(window - (60 - i) * 60000));
      const opening = candles.get(window - 60000),
        spot = candles.get(window),
        ending = candles.get(window + (minutes - 1) * 60000);
      if (!opening || !spot || !ending || closes.some((c) => !c)) {
        continue;
      }
      const returns = closes.slice(1).map((v, i) => Math.log(v! / closes[i]!));
      const mean = returns.reduce((a, b) => a + b, 0) / 60,
        variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / 59;
      if (variance <= 1e-24) {
        continue;
      }
      const sigma = Math.sqrt(variance / 60),
        horizon = (minutes - 1) * 60;
      const p = normalCdf((spot - opening) / (spot * sigma * Math.sqrt(horizon - 40)));
      const y = ending >= opening ? 1 : 0;
      rows.push({
        window,
        minutes,
        partition: window < split ? "development" : "evaluation",
        up: p,
        proxyOutcome: y,
        brier: (p - y) ** 2,
        baselineBrier: 0.25,
      });
    }
  }
  await atomicWrite(
    join(directory, "history-candles.json"),
    JSON.stringify({ start, end, candles: [...candles] }, null, 2),
  );
  await atomicWrite(
    join(directory, "history-proxy.json"),
    JSON.stringify(
      {
        protocol: "btc-quant-jev-v1",
        start,
        split,
        end,
        assumptions:
          "Coinbase last-minute close proxies a final60s average; previous close proxies opening. These are NOT official TWAP outcomes, Polymarket backtests, prices or P&L. No tuning or future input; 5 development days / 2 evaluation days.",
        rows,
        summaries: [5, 15].flatMap((minutes) =>
          ["development", "evaluation"].map((partition) => {
            const group = rows.filter((r) => r.minutes === minutes && r.partition === partition);
            return {
              minutes,
              partition,
              count: group.length,
              brier: group.length ? group.reduce((a, r) => a + r.brier, 0) / group.length : null,
              baselineBrier: 0.25,
            };
          }),
        ),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ historicalProxyCases: rows.length, start, split, end }));
}
