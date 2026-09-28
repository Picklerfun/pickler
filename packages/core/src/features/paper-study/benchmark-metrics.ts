import type { BenchmarkCase, BenchmarkReview, BenchmarkVariant } from "./benchmark.js";
import type { QuantReview } from "./quant.js";

export function uncertainReview(result?: QuantReview): boolean {
  if (result?.status !== "completed" || !result.answers || typeof result.answers !== "object") {
    return false;
  }
  return Object.values(result.answers).some(
    (a: { choice?: string; confidence?: number; probabilities?: Record<string, number> }) =>
      !a.choice ||
      ["UNKNOWN", "NOT_STATED"].includes(a.choice) ||
      (a.confidence ?? 0) < 0.9 ||
      (a.probabilities?.[a.choice] ?? 0) < 0.9,
  );
}
export function reviewMetrics(reviews: BenchmarkReview[], labels: Map<string, boolean>) {
  const completed = reviews.filter((r) => r.result?.status === "completed");
  const bad = completed.filter((r) => labels.get(r.caseId) === true);
  const good = completed.filter((r) => labels.get(r.caseId) === false);
  const detected = bad.filter((r) => r.result!.veto).length;
  const falseVetos = good.filter((r) => r.result!.veto).length;
  return {
    reservedCalls: reviews.length,
    startedCalls: reviews.filter((r) => r.startedAt !== null).length,
    valid: completed.length,
    technicalFailures: reviews.filter((r) => r.result?.status === "failed").length,
    incomplete: reviews.filter(
      (r) =>
        r.startedAt !== null && r.result?.status !== "completed" && r.result?.status !== "failed",
    ).length,
    materialCases: bad.length,
    coherentCases: good.length,
    detected,
    missed: bad.length - detected,
    falseVetos,
    sensitivity: bad.length ? detected / bad.length : null,
    falseVetoRate: good.length ? falseVetos / good.length : null,
    uncertain: completed.filter((r) => uncertainReview(r.result)).length,
    vetos: completed.filter((r) => r.result!.veto).length,
    meanLatencyMs: completed.length
      ? completed.reduce((s, r) => s + (r.result!.durationMs ?? 0), 0) / completed.length
      : null,
    inputTokens: reviews.reduce((s, r) => s + (r.result?.inputTokens ?? 0), 0),
    outputTokens: reviews.reduce((s, r) => s + (r.result?.outputTokens ?? 0), 0),
    unknownUsage: reviews.filter(
      (r) =>
        r.startedAt !== null && (r.result?.inputTokens == null || r.result?.outputTokens == null),
    ).length,
    validation:
      bad.length >= 12 &&
      good.length >= 12 &&
      detected === bad.length &&
      falseVetos === 0 &&
      completed.length === reviews.length
        ? "passed-synthetic-cases-only"
        : "not-validated",
  };
}
export function variantMetrics(rows: BenchmarkCase[], variant: BenchmarkVariant) {
  const ds = rows.flatMap((r) => r.variants.filter((d) => d.variant === variant));
  const filled = ds.filter((d) => d.fill);
  const settled = filled.filter((d) => d.settlement);
  const cost = filled.reduce((s, d) => s + Number(d.fill!.totalCost), 0);
  const settledCost = settled.reduce((s, d) => s + Number(d.fill!.totalCost), 0);
  const pnl = settled.reduce((s, d) => s + Number(d.settlement!.realizedPnl), 0);
  let running = 0,
    peak = 0,
    drawdown = 0;
  // Aggregate simultaneous settlements: arbitrary tie order must not inflate drawdown.
  const byTime = new Map<number, number>();
  for (const d of settled) {
    byTime.set(
      d.settlement!.settledAt,
      (byTime.get(d.settlement!.settledAt) ?? 0) + Number(d.settlement!.realizedPnl),
    );
  }
  const curve = [...byTime]
    .sort(([a], [b]) => a - b)
    .map(([at, value]) => {
      running += value;
      peak = Math.max(peak, running);
      drawdown = Math.max(drawdown, peak - running);
      return { at, realizedPnl: running };
    });
  return {
    variant,
    markets: ds.length,
    proposals: ds.filter((d) => d.proposal).length,
    purchases: filled.length,
    settled: settled.length,
    pendingPositions: filled.length - settled.length,
    abstentions: ds.filter((d) => d.status === "abstained").length,
    blocked: ds.filter((d) => d.status === "blocked").length,
    failed: ds.filter((d) => d.status === "failed").length,
    pendingDecisions: ds.filter((d) => d.status === "pending").length,
    invested: cost,
    fees: filled.reduce((s, d) => s + Number(d.fill!.fees), 0),
    settledCost,
    openCost: cost - settledCost,
    payout: settled.reduce((s, d) => s + Number(d.settlement!.payout), 0),
    realizedPnl: pnl,
    returnOnSettledCost: settledCost > 0 ? pnl / settledCost : null,
    maxRealizedDrawdown: drawdown,
    curve,
  };
}
export function forecastMetrics(rows: BenchmarkCase[]) {
  return (["btc-5m", "btc-15m"] as const).map((kind) => {
    const withForecast = rows.filter((r) => r.kind === kind && r.forecast);
    const scored = withForecast.flatMap((r) => {
      const up = r.forecast!.probabilities.find((p) => p.label === "Up")!;
      const resolution = r.resolutions.find((p) => p.outcomeId === up.outcomeId);
      if (
        !resolution ||
        (resolution.numerator !== "0" && resolution.numerator !== resolution.denominator)
      ) {
        return [];
      }
      const actual = resolution.numerator === "0" ? 0 : 1;
      const book = r.input?.books.find((b) => b.outcomeId === up.outcomeId);
      const ask = Math.min(...(book?.asks.map((a) => Number(a.price)) ?? []));
      const bid = Math.max(...(book?.bids.map((a) => Number(a.price)) ?? []));
      const midpoint = (ask + bid) / 2;
      const validQuote =
        Number.isFinite(midpoint) &&
        bid <= ask &&
        bid >= 0 &&
        ask <= 1 &&
        !!book &&
        Date.parse(book.observedAt) <= r.forecast!.observedAt;
      return [
        {
          probability: up.estimate,
          actual,
          brier: (up.estimate - actual) ** 2,
          quoteBrier: validQuote ? (midpoint - actual) ** 2 : null,
        },
      ];
    });
    const quotes = scored.filter((s) => s.quoteBrier !== null);
    return {
      kind,
      forecasts: withForecast.length,
      resolvedBinary: scored.length,
      unscored: withForecast.length - scored.length,
      brier: scored.length ? scored.reduce((s, r) => s + r.brier, 0) / scored.length : null,
      baseline50: scored.length ? 0.25 : null,
      matchedQuotes: quotes.length,
      quoteBrier: quotes.length
        ? quotes.reduce((s, r) => s + r.quoteBrier!, 0) / quotes.length
        : null,
      modelBrierMatched: quotes.length
        ? quotes.reduce((s, r) => s + r.brier, 0) / quotes.length
        : null,
      calibration: Array.from({ length: 10 }, (_, bin) => {
        const items = scored.filter((r) => Math.min(9, Math.floor(r.probability * 10)) === bin);
        return {
          lower: bin / 10,
          upper: (bin + 1) / 10,
          n: items.length,
          predicted: items.length
            ? items.reduce((s, r) => s + r.probability, 0) / items.length
            : null,
          observed: items.length ? items.reduce((s, r) => s + r.actual, 0) / items.length : null,
        };
      }),
    };
  });
}
export interface PairedObservation {
  market: string;
  at: number;
  left: number;
  right: number;
  traded: boolean;
}
export function pairedObservations(
  rows: BenchmarkCase[],
  left: BenchmarkVariant,
  right: BenchmarkVariant,
): PairedObservation[] {
  return rows.flatMap((r) => {
    if (r.status !== "completed") {
      return [];
    }
    const l = r.variants.find((d) => d.variant === left),
      q = r.variants.find((d) => d.variant === right);
    const value = (d: typeof l) =>
      d?.settlement ? Number(d.settlement.realizedPnl) : d?.status === "abstained" ? 0 : null;
    const a = value(l),
      b = value(q);
    return a !== null && b !== null
      ? [{ market: r.marketId, at: r.startedAt, left: a, right: b, traded: !!(l?.fill || q?.fill) }]
      : [];
  });
}
export function pairedBootstrap(observations: PairedObservation[], frozenConfigurations = 1) {
  const groups = new Map<number, PairedObservation[]>();
  const unique = new Set<string>();
  for (const o of observations) {
    if (unique.has(o.market)) {
      throw new Error("DUPLICATE_PAIRED_MARKET");
    }
    unique.add(o.market);
    const hour = Math.floor(o.at / 3600000);
    groups.set(hour, [...(groups.get(hour) ?? []), o]);
  }
  const blocks = [...groups.values()];
  let seed = 20260928;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const bootstrap = Array.from({ length: blocks.length ? 2000 : 0 }, () => {
    let sum = 0,
      count = 0;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[Math.floor(random() * blocks.length)]!;
      sum += block.reduce((s, o) => s + o.left - o.right, 0);
      count += block.length;
    }
    return sum / count;
  }).sort((a, b) => a - b);
  const interval = bootstrap.length ? [bootstrap[49]!, bootstrap[1949]!] : null;
  const days = new Set(observations.map((o) => new Date(o.at).toISOString().slice(0, 10))).size;
  const traded = observations.filter((o) => o.traded).length;
  const pnl = observations.reduce((s, o) => s + o.left, 0);
  const eligible = days >= 3 && blocks.length >= 20 && traded >= 30 && frozenConfigurations === 1;
  return {
    comparableMarkets: observations.length,
    days,
    hourBlocks: blocks.length,
    unionTradedMarkets: traded,
    frozenConfigurations,
    meanDifference: observations.length
      ? observations.reduce((s, o) => s + o.left - o.right, 0) / observations.length
      : null,
    interval95: interval,
    seed: 20260928,
    resamples: 2000,
    unit: "virtual P&L difference per comparable market",
    classification:
      interval && blocks.length > 1 && interval[0]! > 0
        ? "favorable-exploratory"
        : interval && blocks.length > 1 && interval[1]! < 0
          ? "adverse-exploratory"
          : "inconclusive",
    minimumSampleMet: eligible,
    supportedEconomicImprovement: eligible && pnl > 0 && !!interval && interval[0]! > 0,
    notice:
      "Paired UTC-hour blocks; overlapping windows remain dependent. Minimum counts do not guarantee profitability. Only frozen prospective observations qualify; no automatic strategy promotion.",
  };
}
