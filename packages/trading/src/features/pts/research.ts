import { PilotError } from "@pickler/core";
import { ptsCoverage } from "./calendar.js";
import { inspectPtsHistory } from "./inspection.js";
import { units as u, decimal as d, abs, max, tick, recoveryRatioCompare } from "./math.js";
import { ptsChannel, ptsTrend, channelDistance } from "./pivots.js";
import { ptsAtr } from "./signals.js";
import { analyzePtsKernel } from "./research-signal-kernel.js";
import { PtsResearchHistoryIndex } from "./research-history.js";
import { PTS_RESEARCH_CANDIDATES } from "./research-policy.js";
import {
  boundResearchSetups,
  researchReadinessOrder,
  type RetainedResearchSetup,
} from "./research-selection.js";
import { PTS_INTRADAY_RESPONSIVE_VERSION } from "./types.js";
import type {
  PtsAnalysis,
  PtsBar,
  PtsDirection,
  PtsHistory,
  PtsPeriod,
  PtsPivot,
} from "./types.js";
import type {
  PtsResearchArm,
  PtsResearchCandidateId,
  PtsResearchGate,
  PtsResearchGeometry,
  PtsResearchInspection,
  PtsResearchOptions,
  PtsResearchOutcome,
  PtsResearchReplay,
  PtsResearchReplayInput,
  PtsResearchSignal,
  PtsResearchTiming,
} from "./research-types.js";

const FIVE_MINUTES = 300000;
const CORRECTION_MS = 86400000;
const FORMATION_MS = 259200000;
type Trend = PtsDirection | "neutral" | "unknown";

/** Exact native hourly ER20. The threshold uses cross-products, never rounded decimals. */
export function ptsResearchEr20(bars: readonly PtsBar[]) {
  const closes = bars.slice(-21);
  if (
    closes.length < 21 ||
    closes.some((bar, i) => i > 0 && bar.openTime !== closes[i - 1]!.closeTime)
  ) {
    return { trend: "unknown" as Trend, numerator: null, denominator: null, marginNumerator: null };
  }
  const net = u(closes[20]!.close) - u(closes[0]!.close);
  const variation = closes
    .slice(1)
    .reduce((sum, bar, i) => sum + abs(u(bar.close) - u(closes[i]!.close)), 0n);
  const margin = abs(net) * 100n - variation * 30n;
  let trend: Trend = "neutral";
  if (variation > 0n && margin >= 0n && net !== 0n) {
    trend = net > 0n ? "long" : "short";
  }
  return {
    trend,
    numerator: abs(net).toString(),
    denominator: variation.toString(),
    netNumerator: net.toString(),
    thresholdInclusive: "0.30",
    marginNumerator: margin.toString(),
    marginDenominator: (variation * 100n).toString(),
    from: closes[0]!.closeTime,
    to: closes[20]!.closeTime,
  };
}

interface Context {
  at: number;
  history: PtsHistory;
  index: PtsResearchHistoryIndex;
  series: Record<PtsPeriod, PtsBar[]>;
  primary: Trend;
  alignment: Trend;
  er: ReturnType<typeof ptsResearchEr20>;
  primaryReadyAt: number | null;
  alignmentReadyAt: number | null;
  erReadyAt: number | null;
}

function identity(marketId: number, direction: PtsDirection, pivots: readonly PtsPivot[]) {
  return [marketId, direction, ...pivots.flatMap((pivot) => [pivot.openTime, pivot.price])].join(
    ":",
  );
}

function latestImpulse(pivots: readonly PtsPivot[], direction: PtsDirection) {
  let impulse: [PtsPivot, PtsPivot] | null = null;
  for (let i = 1; i < pivots.length; i++) {
    const a = pivots[i - 1]!;
    const b = pivots[i]!;
    if (
      a.kind === (direction === "long" ? "low" : "high") &&
      b.kind !== a.kind &&
      (u(b.price) - u(a.price)) * (direction === "long" ? 1n : -1n) > 0n
    ) {
      impulse = [a, b];
    }
  }
  return impulse;
}

class Gates {
  readonly rows: PtsResearchGate[] = [];
  add(code: string, passed: boolean | null, values: unknown, dependsOn: string[] = []) {
    const evaluable = dependsOn.every(
      (dependency) => this.rows.find((gate) => gate.code === dependency)?.status === "PASS",
    );
    const status = !evaluable
      ? "NOT_EVALUABLE_DEPENDENCY"
      : passed === null
        ? "UNKNOWN"
        : passed
          ? "PASS"
          : "FAIL";
    this.rows.push({ code, status, dependsOn, values });
    return status === "PASS";
  }
  passed(code: string) {
    return this.rows.find((gate) => gate.code === code)?.status === "PASS";
  }
}

function blankTiming(): PtsResearchTiming {
  return {
    aConfirmedAt: null,
    bConfirmedAt: null,
    cConfirmedAt: null,
    channelConfirmedAt: null,
    primaryReadyAt: null,
    alignmentReadyAt: null,
    prerequisitesReadyAt: null,
    admittedAt: null,
    triggerAt: null,
    expiresAt: null,
  };
}

interface Evaluation {
  outcome: PtsResearchOutcome;
  geometry: PtsResearchGeometry | null;
  prerequisiteCodes: string[];
  prerequisitesPassed: boolean;
  cross: PtsBar | null;
}

interface EntryOverride {
  trigger: PtsBar | null;
  kind: "cross" | "ready-band";
  readyAt: number | null;
}

function latestCross(
  bars: readonly PtsBar[],
  geometry: PtsResearchGeometry,
  after = geometry.knownAt,
) {
  let trigger: PtsBar | null = null;
  // Only bars after this immutable geometry was knowable can contain a relevant crossing.
  let low = 1;
  let high = bars.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (bars[middle]!.closeTime <= after) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  for (let i = low; i < bars.length; i++) {
    const current = bars[i]!;
    const previous = bars[i - 1]!;
    if (
      current.openTime === previous.closeTime &&
      recoveryRatioCompare(current.close, geometry.c.price, geometry.b.price, "0.38") > 0 &&
      recoveryRatioCompare(previous.close, geometry.c.price, geometry.b.price, "0.38") <= 0
    ) {
      trigger = current;
    }
  }
  return trigger;
}

function inBand(price: string, geometry: PtsResearchGeometry) {
  return (
    recoveryRatioCompare(price, geometry.c.price, geometry.b.price, "0.38") > 0 &&
    recoveryRatioCompare(price, geometry.c.price, geometry.b.price, "0.495") < 0
  );
}

function signalFor(
  arm: PtsResearchArm,
  geometry: PtsResearchGeometry,
  trigger: PtsBar,
  kind: "cross" | "ready-band",
) {
  const comparisonId = `${geometry.abcId}:trigger:${trigger.closeTime}`;
  return {
    id: `${arm}@${arm === "reference" ? "0.2.0-fast.2" : "0.1.0"}:${comparisonId}`,
    comparisonId,
    episodeId: geometry.abcId,
    candidate: arm,
    direction: geometry.direction,
    abId: geometry.abId,
    abcId: geometry.abcId,
    triggerAt: trigger.closeTime,
    expiresAt: Math.min(trigger.closeTime + FIVE_MINUTES, geometry.c.confirmedAt + CORRECTION_MS),
    entryKind: kind,
    observedClose: trigger.close,
    geometry,
  } satisfies PtsResearchSignal;
}

function evaluate(
  ctx: Context,
  arm: PtsResearchArm,
  frozen?: PtsResearchGeometry,
  entry?: EntryOverride,
): Evaluation {
  const gates = new Gates();
  const coverage = ptsCoverage(ctx.series, ctx.at, PTS_INTRADAY_RESPONSIVE_VERSION);
  const covered = coverage.every((item) => item.eligible);
  gates.add("HISTORY_COVERAGE", covered ? true : null, coverage);
  const primary = arm === "primary-er20" ? ctx.er.trend : ctx.primary;
  gates.add(
    "PRIMARY_TREND",
    primary === "unknown" ? null : primary !== "neutral",
    arm === "primary-er20" ? ctx.er : { trend: primary },
  );
  const direction = primary === "long" || primary === "short" ? primary : null;
  gates.add(
    "FIFTEEN_MINUTE_ALIGNMENT",
    ctx.alignment === "unknown" ? null : ctx.alignment === direction,
    { trend: ctx.alignment, primary },
    ["PRIMARY_TREND"],
  );
  const impulse = frozen
    ? ([frozen.a, frozen.b] as [PtsPivot, PtsPivot])
    : direction
      ? latestImpulse(ctx.index.pivots("15m", ctx.at).pivots, direction)
      : null;
  gates.add("FIFTEEN_MINUTE_IMPULSE", !!impulse, impulse, ["PRIMARY_TREND"]);
  const a = impulse?.[0];
  const b = impulse?.[1];
  const c =
    frozen?.c ??
    (a && b
      ? ctx.index
          .pivots("5m", ctx.at)
          .pivots.filter((pivot) => pivot.kind === a.kind && pivot.openTime >= b.closeTime)
          .at(-1)
      : undefined);
  gates.add("CONFIRMED_CORRECTION", !!c, c ?? null, ["FIFTEEN_MINUTE_IMPULSE"]);
  gates.add(
    "FORMATION_WINDOW",
    c && b ? c.confirmedAt <= b.closeTime + FORMATION_MS : null,
    { bAt: b?.closeTime ?? null, cKnownAt: c?.confirmedAt ?? null, maximumMs: FORMATION_MS },
    ["CONFIRMED_CORRECTION"],
  );
  const numerator =
    b && c && direction ? (u(b.price) - u(c.price)) * (direction === "long" ? 1n : -1n) : null;
  const span = a && b ? abs(u(b.price) - u(a.price)) : null;
  const lower = arm === "retracement-control" ? 40n : 61n;
  const upper = arm === "retracement-control" ? 57n : 78n;
  const retracementCode = arm === "retracement-control" ? "RETRACEMENT_40_57" : "RETRACEMENT_61_78";
  gates.add(
    retracementCode,
    numerator !== null && span !== null
      ? numerator * 100n >= span * lower && numerator * 100n <= span * upper
      : null,
    {
      numerator: numerator?.toString() ?? null,
      denominator: span?.toString() ?? null,
      lowerInclusive: `0.${lower}`,
      upperInclusive: `0.${upper}`,
      lowerMarginNumerator:
        numerator !== null && span !== null ? (numerator * 100n - span * lower).toString() : null,
      upperMarginNumerator:
        numerator !== null && span !== null ? (span * upper - numerator * 100n).toString() : null,
      marginDenominator: span !== null ? (span * 100n).toString() : null,
    },
    ["CONFIRMED_CORRECTION"],
  );
  const channelPivots = c ? ctx.index.pivots("15m", c.confirmedAt).pivots : [];
  const channel =
    frozen?.channel ??
    (direction && c ? ptsChannel(channelPivots, direction, c.confirmedAt) : null);
  gates.add(
    "FIFTEEN_MINUTE_CHANNEL",
    !!channel &&
      (frozen && arm === "persistent-setups" ? true : ptsTrend(channelPivots) === direction),
    { channel, contactsRequired: 3, trendAtCorrection: ptsTrend(channelPivots) },
    ["CONFIRMED_CORRECTION"],
  );
  const atr = frozen
    ? BigInt(frozen.atrNumerator)
    : c
      ? ptsAtr(ctx.series["15m"].filter((bar) => bar.closeTime <= c.confirmedAt))
      : null;
  gates.add(
    "ATR14",
    atr !== null ? atr > 0n : null,
    { numerator: atr?.toString() ?? null, denominator: "14" },
    ["CONFIRMED_CORRECTION"],
  );
  const nativeTick = tick(ctx.history.market.priceDecimals);
  const tolerance = atr !== null ? max(2n * nativeTick * 56n, atr) : null;
  const distance = channel && c ? channelDistance(channel, c.price, c.openTime) : null;
  gates.add(
    "CHANNEL_CONFLUENCE",
    distance && tolerance !== null
      ? distance.numerator * 56n <= tolerance * distance.denominator
      : null,
    {
      distanceNumerator: distance?.numerator.toString() ?? null,
      distanceDenominator: distance?.denominator.toString() ?? null,
      toleranceNumerator: tolerance?.toString() ?? null,
      toleranceDenominator: "56",
      marginNumerator:
        distance && tolerance !== null
          ? (tolerance * distance.denominator - distance.numerator * 56n).toString()
          : null,
    },
    ["FIFTEEN_MINUTE_CHANNEL", "ATR14"],
  );
  const margin = atr !== null ? max(nativeTick, (atr + 139n) / 140n) : null;
  const rounded = margin !== null ? ((margin + nativeTick - 1n) / nativeTick) * nativeTick : null;
  const stop =
    c && rounded !== null && direction
      ? u(c.price) - rounded * (direction === "long" ? 1n : -1n)
      : null;
  gates.add(
    "STRUCTURAL_STOP",
    stop !== null ? stop > 0n : null,
    { stop: stop !== null ? d(stop) : null, margin: rounded !== null ? d(rounded) : null },
    ["ATR14", "CONFIRMED_CORRECTION"],
  );

  let geometry: PtsResearchGeometry | null = null;
  if (
    direction &&
    a &&
    b &&
    c &&
    channel &&
    atr !== null &&
    tolerance !== null &&
    stop !== null &&
    u(b.price) !== u(c.price)
  ) {
    geometry = frozen ?? {
      abId: identity(ctx.history.market.marketId, direction, [a, b]),
      abcId: identity(ctx.history.market.marketId, direction, [a, b, c]),
      direction,
      a,
      b,
      c,
      knownAt: Math.max(
        a.confirmedAt,
        b.confirmedAt,
        c.confirmedAt,
        channel.first.confirmedAt,
        channel.second.confirmedAt,
        channel.opposite.confirmedAt,
      ),
      channel,
      atrNumerator: atr.toString(),
      atrDenominator: "14",
      toleranceNumerator: tolerance.toString(),
      toleranceDenominator: "56",
      structuralStop: d(stop),
    };
  }
  const prerequisiteCodes = gates.rows.map((gate) => gate.code);
  const prerequisitesPassed = prerequisiteCodes.every((code) => gates.passed(code));
  const cross = geometry ? latestCross(ctx.series["5m"], geometry) : null;
  const trigger = entry ? entry.trigger : cross;
  gates.add(
    "RECOVERY_CROSS_38",
    !!trigger,
    {
      triggerAt: trigger?.closeTime ?? null,
      setupKnownAt: geometry?.knownAt ?? null,
      cConfirmedAt: c?.confirmedAt ?? null,
      entryKind: entry?.kind ?? "cross",
      prerequisitesReadyAt: entry?.readyAt ?? null,
    },
    ["CONFIRMED_CORRECTION", "FIFTEEN_MINUTE_CHANNEL"],
  );
  const expiresAt =
    trigger && c ? Math.min(trigger.closeTime + FIVE_MINUTES, c.confirmedAt + CORRECTION_MS) : null;
  gates.add(
    "SIGNAL_WINDOW",
    expiresAt !== null ? ctx.at < expiresAt : null,
    {
      now: ctx.at,
      triggerAt: trigger?.closeTime ?? null,
      expiresAt,
      remainingMs: expiresAt !== null ? expiresAt - ctx.at : null,
    },
    ["RECOVERY_CROSS_38"],
  );
  const close = ctx.series["5m"].at(-1)?.close;
  const recoveryNumerator =
    geometry && close
      ? (u(close) - u(geometry.c.price)) * (geometry.direction === "long" ? 1n : -1n)
      : null;
  const recoveryDenominator = geometry ? abs(u(geometry.b.price) - u(geometry.c.price)) : null;
  gates.add(
    "ENTRY_BAND",
    geometry && close ? inBand(close, geometry) : null,
    {
      close: close ?? null,
      exclusive: ["0.38", "0.495"],
      diagnosticOnlyForReferenceCross: true,
      numerator: recoveryNumerator?.toString() ?? null,
      denominator: recoveryDenominator?.toString() ?? null,
      lowerMarginNumerator:
        recoveryNumerator !== null && recoveryDenominator !== null
          ? (recoveryNumerator * 1000n - recoveryDenominator * 380n).toString()
          : null,
      upperMarginNumerator:
        recoveryNumerator !== null && recoveryDenominator !== null
          ? (recoveryDenominator * 495n - recoveryNumerator * 1000n).toString()
          : null,
      marginDenominator:
        recoveryDenominator !== null ? (recoveryDenominator * 1000n).toString() : null,
    },
    ["CONFIRMED_CORRECTION"],
  );
  const order = [
    "HISTORY_COVERAGE",
    "PRIMARY_TREND",
    "FIFTEEN_MINUTE_ALIGNMENT",
    "FIFTEEN_MINUTE_IMPULSE",
    "CONFIRMED_CORRECTION",
    "FORMATION_WINDOW",
    retracementCode,
    "FIFTEEN_MINUTE_CHANNEL",
    "ATR14",
    "CHANNEL_CONFLUENCE",
    "RECOVERY_CROSS_38",
    "SIGNAL_WINDOW",
    "STRUCTURAL_STOP",
  ];
  const required = order.map((code) => gates.rows.find((gate) => gate.code === code)!);
  const blocker = required.find((gate) => gate.status !== "PASS")?.code ?? null;
  const signal =
    !blocker && geometry && trigger
      ? signalFor(arm, geometry, trigger, entry?.kind ?? "cross")
      : null;
  const timing = blankTiming();
  timing.aConfirmedAt = a?.confirmedAt ?? null;
  timing.bConfirmedAt = b?.confirmedAt ?? null;
  timing.cConfirmedAt = c?.confirmedAt ?? null;
  timing.channelConfirmedAt = channel
    ? Math.max(channel.first.confirmedAt, channel.second.confirmedAt, channel.opposite.confirmedAt)
    : null;
  timing.primaryReadyAt = arm === "primary-er20" ? ctx.erReadyAt : ctx.primaryReadyAt;
  timing.alignmentReadyAt = ctx.alignmentReadyAt;
  timing.prerequisitesReadyAt =
    entry?.readyAt ??
    (geometry && timing.primaryReadyAt !== null && timing.alignmentReadyAt !== null
      ? Math.max(geometry.knownAt, timing.primaryReadyAt, timing.alignmentReadyAt)
      : null);
  timing.triggerAt = trigger?.closeTime ?? null;
  timing.expiresAt = expiresAt;
  return {
    outcome: {
      candidate: arm,
      version: arm === "reference" ? "0.2.0-fast.2" : "0.1.0",
      action: signal ? (signal.direction === "long" ? "signal-long" : "signal-short") : "hold",
      reason: !covered
        ? "NOT_VERIFIABLE"
        : signal
          ? "PTS_RECOVERY_CONFIRMED"
          : (blocker ?? "NOT_VERIFIABLE"),
      firstBlocker: blocker,
      validationStatus: covered ? "VALID" : "NOT_VERIFIABLE",
      direction: primary,
      abId:
        geometry?.abId ??
        (a && b && direction ? identity(ctx.history.market.marketId, direction, [a, b]) : null),
      abcId:
        geometry?.abcId ??
        (a && b && c && direction
          ? identity(ctx.history.market.marketId, direction, [a, b, c])
          : null),
      episodeId:
        geometry?.abcId ??
        (a && b && c && direction
          ? identity(ctx.history.market.marketId, direction, [a, b, c])
          : null),
      signal,
      gates: gates.rows,
      timing,
      activeSetups: 0,
    },
    geometry,
    prerequisiteCodes,
    prerequisitesPassed,
    cross,
  };
}

function directionReadyAt(
  index: PtsResearchHistoryIndex,
  series: Record<PtsPeriod, PtsBar[]>,
  period: "1h" | "15m",
  trend: Trend,
  er = false,
) {
  if (trend !== "long" && trend !== "short") {
    return null;
  }
  const bars = series[period];
  let readyAt = bars.at(-1)?.closeTime ?? null;
  for (let i = bars.length - 1; i >= 0; i--) {
    const at = bars[i]!.closeTime;
    const prior = er
      ? ptsResearchEr20(bars.slice(0, i + 1)).trend
      : ptsTrend(index.pivots(period, at).pivots);
    if (prior !== trend) {
      break;
    }
    readyAt = at;
  }
  return readyAt;
}

function lifecycle(
  ctx: Context,
  geometry: PtsResearchGeometry,
  admittedAt: number,
): "VALID" | "NOT_VERIFIABLE" | "EXPIRED" | "PRIMARY_RETIRED" | "STOP_TOUCHED" {
  if (ctx.at >= geometry.c.confirmedAt + CORRECTION_MS) {
    return "EXPIRED";
  }
  const bars = ctx.series["5m"];
  if (!bars.length || bars[0]!.openTime > admittedAt) {
    return "NOT_VERIFIABLE";
  }
  const following = bars.filter((bar) => bar.closeTime > admittedAt);
  if (
    following.some(
      (bar, i) => bar.openTime !== (i === 0 ? admittedAt : following[i - 1]!.closeTime),
    ) ||
    (following.at(-1)?.closeTime ?? admittedAt) !== Math.floor(ctx.at / FIVE_MINUTES) * FIVE_MINUTES
  ) {
    return "NOT_VERIFIABLE";
  }
  if (
    following.some((bar) =>
      geometry.direction === "long"
        ? u(bar.low) <= u(geometry.structuralStop)
        : u(bar.high) >= u(geometry.structuralStop),
    )
  ) {
    return "STOP_TOUCHED";
  }
  const dates = [
    admittedAt,
    ...ctx.series["1h"].filter((bar) => bar.closeTime > admittedAt).map((bar) => bar.closeTime),
  ];
  for (const at of dates) {
    const hourly = ctx.series["1h"].filter((bar) => bar.closeTime <= at).slice(-24);
    if (
      hourly.length < 24 ||
      hourly.at(-1)!.closeTime !== Math.floor(at / 3600000) * 3600000 ||
      hourly.some((bar, i) => i > 0 && bar.openTime !== hourly[i - 1]!.closeTime)
    ) {
      return "NOT_VERIFIABLE";
    }
    const primary = ptsTrend(ctx.index.pivots("1h", at).pivots);
    if (primary === "unknown") {
      return "NOT_VERIFIABLE";
    }
    if (primary === "neutral" || primary !== geometry.direction) {
      return "PRIMARY_RETIRED";
    }
  }
  return "VALID";
}

function addLifecycle(
  evaluation: Evaluation,
  status: ReturnType<typeof lifecycle>,
  count: number,
  admittedAt: number | null,
) {
  const outcome = evaluation.outcome;
  outcome.activeSetups = count;
  outcome.timing.admittedAt = admittedAt;
  const dependsOn = ["PRIMARY_TREND", "CONFIRMED_CORRECTION"];
  const evaluable = dependsOn.every(
    (code) => outcome.gates.find((gate) => gate.code === code)?.status === "PASS",
  );
  outcome.gates.push({
    code: "SETUP_LIFECYCLE",
    status: !evaluable
      ? "NOT_EVALUABLE_DEPENDENCY"
      : status === "VALID"
        ? "PASS"
        : status === "NOT_VERIFIABLE"
          ? "UNKNOWN"
          : "FAIL",
    dependsOn,
    values: { status, admittedAt, activeSetups: count, maximumPerMarketDirection: 32 },
  });
  let blocker = outcome.firstBlocker;
  if (status !== "VALID") {
    blocker ??= "SETUP_LIFECYCLE";
  }
  if (blocker) {
    outcome.signal = null;
    outcome.action = "hold";
    outcome.firstBlocker = blocker;
    outcome.reason =
      status === "NOT_VERIFIABLE" || outcome.validationStatus === "NOT_VERIFIABLE"
        ? "NOT_VERIFIABLE"
        : blocker;
  }
  if (status === "NOT_VERIFIABLE") {
    outcome.validationStatus = "NOT_VERIFIABLE";
  }
  return outcome;
}

function invalidInspection(history: PtsHistory, at: number): PtsResearchInspection {
  const baseline = inspectPtsHistory(history, at, PTS_INTRADAY_RESPONSIVE_VERSION);
  const outcomes: PtsResearchOutcome[] = (
    ["reference", ...PTS_RESEARCH_CANDIDATES.map((policy) => policy.id)] as const
  ).map((candidate) => ({
    candidate,
    version: candidate === "reference" ? "0.2.0-fast.2" : "0.1.0",
    action: "hold",
    reason: "NOT_VERIFIABLE",
    firstBlocker: "RECORDED_HISTORY_INVALID",
    validationStatus: "NOT_VERIFIABLE",
    direction: "unknown",
    abId: null,
    abcId: null,
    episodeId: null,
    signal: null,
    gates: [
      {
        code: "RECORDED_HISTORY_INVALID",
        status: "UNKNOWN",
        dependsOn: [],
        values: baseline.checks,
      },
      ...[
        "HISTORY_COVERAGE",
        "PRIMARY_TREND",
        "FIFTEEN_MINUTE_ALIGNMENT",
        "FIFTEEN_MINUTE_IMPULSE",
        "CONFIRMED_CORRECTION",
        "FORMATION_WINDOW",
        "RETRACEMENT_61_78",
        "FIFTEEN_MINUTE_CHANNEL",
        "ATR14",
        "CHANNEL_CONFLUENCE",
        "RECOVERY_CROSS_38",
        "SIGNAL_WINDOW",
        "STRUCTURAL_STOP",
        "ENTRY_BAND",
      ].map((code) => ({
        code,
        status: "NOT_EVALUABLE_DEPENDENCY" as const,
        dependsOn: ["RECORDED_HISTORY_INVALID"],
        values: null,
      })),
    ],
    timing: blankTiming(),
    activeSetups: 0,
  }));
  return {
    format: "pts-causal-research-v1",
    at,
    marketId: history.market.marketId,
    symbol: history.market.symbol,
    baseline,
    outcomes,
    candidates: outcomes.slice(1),
  };
}

function isHistoryFailure(error: unknown) {
  return (
    error instanceof PilotError &&
    ["INVALID_MARKET_DATA", "PERPL_MARKET_IDENTITY"].includes(error.code)
  );
}

function freezeEvidence<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      freezeEvidence(child);
    }
    Object.freeze(value);
  }
  return value;
}

interface ReadyState {
  geometry: PtsResearchGeometry;
  readyAt: number;
  firstAttempted: boolean;
  bandTrigger: PtsBar | null;
}

/** An offline in-memory chronological reader; it has no provider, repository or execution port. */
export function createPtsResearchSession(input: PtsHistory, options: PtsResearchOptions = {}) {
  const history: PtsHistory = {
    ...input,
    market: {
      ...input.market,
      collateral: { ...input.market.collateral },
      provenance: { ...input.market.provenance },
    },
    series: input.series.map((series) => ({
      ...series,
      candles: series.candles.map((bar) => ({ ...bar })),
    })),
  };
  const confirmed = new Set(options.confirmedFixtureSignalIds ?? []);
  const retained = new Map<string, RetainedResearchSetup>();
  const retired = new Set<string>();
  const ready = new Map<string, ReadyState>();
  const readiness = new Map<string, number | null>();
  let index: PtsResearchHistoryIndex | null = null;
  let initializationFailure: unknown;
  try {
    index = new PtsResearchHistoryIndex(history);
  } catch (error) {
    if (!isHistoryFailure(error)) {
      throw error;
    }
    initializationFailure = error;
  }
  let processedAt = -1;
  let cached: PtsResearchInspection | null = null;

  const atTime = (at: number): PtsResearchInspection => {
    const series = index!.series(at);
    const primary = ptsTrend(index!.pivots("1h", at).pivots);
    const alignment = ptsTrend(index!.pivots("15m", at).pivots);
    const er = ptsResearchEr20(series["1h"]);
    const since = (period: "1h" | "15m", trend: Trend, efficiency = false) => {
      const latest = series[period].at(-1)?.closeTime ?? 0;
      const key = `${period}:${efficiency}:${latest}:${trend}`;
      if (!readiness.has(key)) {
        readiness.set(key, directionReadyAt(index!, series, period, trend, efficiency));
      }
      return readiness.get(key)!;
    };
    const ctx: Context = {
      at,
      history,
      index: index!,
      series,
      primary,
      alignment,
      er,
      primaryReadyAt: since("1h", primary),
      alignmentReadyAt: since("15m", alignment),
      erReadyAt: since("1h", er.trend, true),
    };
    const baseline: PtsAnalysis = analyzePtsKernel(
      history,
      at,
      PTS_INTRADAY_RESPONSIVE_VERSION,
      series,
      index!.resolvePivots,
    );
    const reference = evaluate(ctx, "reference");
    // The frozen executable reference is authoritative, including its historical short-circuit reason.
    reference.outcome.action =
      baseline.action === "open-long"
        ? "signal-long"
        : baseline.action === "open-short"
          ? "signal-short"
          : "hold";
    reference.outcome.reason = baseline.reason;
    reference.outcome.firstBlocker = baseline.action === "hold" ? baseline.reason : null;
    if (baseline.action === "hold") {
      reference.outcome.signal = null;
    }
    const efficient = evaluate(ctx, "primary-er20").outcome;
    const control = evaluate(ctx, "retracement-control").outcome;

    const readyBase = evaluate(ctx, "ready-band-entry");
    let readyEntry = readyBase;
    if (
      readyBase.geometry &&
      readyBase.prerequisitesPassed &&
      !ready.has(readyBase.geometry.abcId)
    ) {
      const geometry = readyBase.geometry;
      ready.set(geometry.abcId, {
        geometry,
        readyAt: Math.max(
          at,
          geometry.knownAt,
          ctx.primaryReadyAt ?? at,
          ctx.alignmentReadyAt ?? at,
        ),
        firstAttempted: false,
        bandTrigger: null,
      });
    }
    // A temporary failure cannot erase the one immutable first-candle attempt for an ABC.
    for (const state of ready.values()) {
      if (state.firstAttempted) {
        continue;
      }
      const first = series["5m"].find((bar) => bar.closeTime > state.readyAt);
      if (first) {
        state.firstAttempted = true;
        if (
          readyBase.prerequisitesPassed &&
          readyBase.geometry?.abcId === state.geometry.abcId &&
          inBand(first.close, state.geometry)
        ) {
          state.bandTrigger = first;
        }
      }
    }
    if (readyBase.geometry) {
      const geometry = readyBase.geometry;
      const state = ready.get(geometry.abcId);
      // The existing crossing and its TTL are unchanged. Readiness constrains only the extra band event.
      const cross = readyBase.cross;
      const band = state?.bandTrigger ?? null;
      const useCross = cross && (!band || cross.closeTime >= band.closeTime);
      readyEntry = evaluate(ctx, "ready-band-entry", geometry, {
        trigger: useCross ? cross : band,
        kind: useCross ? "cross" : "ready-band",
        readyAt: state?.readyAt ?? null,
      });
    }

    let missingLifecycle = false;
    for (const [id, state] of retained) {
      const status = lifecycle(ctx, state.geometry, state.admittedAt);
      if (status === "NOT_VERIFIABLE") {
        missingLifecycle = true;
      } else if (status !== "VALID") {
        retained.delete(id);
        retired.add(id);
      }
    }
    if (
      reference.geometry &&
      reference.prerequisitesPassed &&
      !retired.has(reference.geometry.abcId) &&
      !retained.has(reference.geometry.abcId)
    ) {
      const status = lifecycle(ctx, reference.geometry, at);
      if (status === "VALID") {
        retained.set(reference.geometry.abcId, { geometry: reference.geometry, admittedAt: at });
      } else if (status === "NOT_VERIFIABLE") {
        missingLifecycle = true;
      } else {
        retired.add(reference.geometry.abcId);
      }
    }
    for (const id of boundResearchSetups(retained)) {
      retired.add(id);
    }
    const choices = [...retained.values()]
      .filter((state) => state.geometry.direction === primary)
      .sort(researchReadinessOrder);
    let persistent: PtsResearchOutcome | null = null;
    for (const state of choices) {
      const geometry = state.geometry;
      const evaluated = evaluate(ctx, "persistent-setups", geometry);
      const status = lifecycle(ctx, geometry, state.admittedAt);
      const outcome = addLifecycle(evaluated, status, choices.length, state.admittedAt);
      persistent ??= outcome;
      if (outcome.signal) {
        persistent = outcome;
        if (confirmed.has(outcome.signal.id)) {
          retained.delete(geometry.abcId);
          retired.add(geometry.abcId);
        }
        break;
      }
    }
    if (!persistent) {
      persistent = addLifecycle(
        evaluate(ctx, "persistent-setups"),
        missingLifecycle ? "NOT_VERIFIABLE" : "VALID",
        choices.length,
        null,
      );
      // No retained geometry may masquerade as an admissible persistent signal.
      if (persistent.signal) {
        persistent.signal = null;
        persistent.action = "hold";
        persistent.reason = "NO_ACTIVE_RETAINED_SETUP";
        persistent.firstBlocker = "SETUP_LIFECYCLE";
        const gate = persistent.gates.find((item) => item.code === "SETUP_LIFECYCLE")!;
        gate.status = "FAIL";
        gate.values = {
          status: "NO_ACTIVE_RETAINED_SETUP",
          activeSetups: 0,
          maximumPerMarketDirection: 32,
        };
      }
    }
    const candidates = [efficient, persistent, readyEntry.outcome, control];
    return {
      format: "pts-causal-research-v1",
      at,
      marketId: history.market.marketId,
      symbol: history.market.symbol,
      baseline,
      candidates,
      outcomes: [reference.outcome, ...candidates],
    };
  };

  return {
    inspect(at: number): PtsResearchInspection {
      if (!Number.isSafeInteger(at) || at < 0) {
        throw new PilotError("INVALID_INPUT", "Invalid offline PTS research time");
      }
      if (cached?.at === at) {
        return freezeEvidence(cached);
      }
      if (at < Math.max(processedAt, cached?.at ?? -1)) {
        return createPtsResearchSession(history, options).inspect(at);
      }
      if (initializationFailure) {
        return freezeEvidence(invalidInspection(history, at));
      }
      try {
        for (const closeAt of index!.closedFiveMinuteTimes(at)) {
          if (closeAt <= processedAt) {
            continue;
          }
          cached = atTime(closeAt);
          processedAt = closeAt;
        }
        if (!cached || cached.at !== at) {
          cached = atTime(at);
        }
        return freezeEvidence(cached);
      } catch (error) {
        if (!isHistoryFailure(error)) {
          throw error;
        }
        return freezeEvidence(invalidInspection(history, at));
      }
    },
  };
}

export function inspectPtsResearch(
  history: PtsHistory,
  at: number,
  options: PtsResearchOptions = {},
) {
  return createPtsResearchSession(history, options).inspect(at);
}

/** Every actual closed native 5m window in the requested prefix, without invented financial fills. */
export function replayPtsResearch(
  history: PtsHistory,
  input: PtsResearchReplayInput,
): PtsResearchReplay {
  if (
    !Number.isSafeInteger(input.from) ||
    !Number.isSafeInteger(input.to) ||
    input.from < 0 ||
    input.to < input.from
  ) {
    throw new PilotError("INVALID_INPUT", "Invalid offline PTS research replay interval");
  }
  const session = createPtsResearchSession(history, input);
  const times = new Set(
    history.series
      .filter((series) => series.resolution === 300)
      .flatMap((series) =>
        series.candles.filter((bar) => bar.closed).map((bar) => bar.openTime + FIVE_MINUTES),
      )
      .filter((at) => at >= input.from && at <= input.to),
  );
  const rows = [...times]
    .sort((a, b) => a - b)
    .map((at) => ({ at, outcomes: session.inspect(at).outcomes }));
  const signals = new Map<string, PtsResearchSignal>();
  for (const row of rows) {
    for (const outcome of row.outcomes) {
      if (outcome.signal) {
        signals.set(outcome.signal.id, outcome.signal);
      }
    }
  }
  const reference = new Set(
    [...signals.values()]
      .filter((signal) => signal.candidate === "reference")
      .map((signal) => signal.comparisonId),
  );
  const comparisons = PTS_RESEARCH_CANDIDATES.map((policy) => {
    const own = [...signals.values()].filter((signal) => signal.candidate === policy.id);
    const ids = new Set(own.map((signal) => signal.comparisonId));
    return {
      candidate: policy.id as PtsResearchCandidateId,
      gained: [...ids].filter((id) => !reference.has(id)).sort(),
      lost: [...reference].filter((id) => !ids.has(id)).sort(),
      shared: [...ids].filter((id) => reference.has(id)).sort(),
      uniqueEpisodes: new Set(own.map((signal) => signal.episodeId)).size,
    };
  });
  return {
    format: "pts-causal-signal-replay-v1",
    marketId: history.market.marketId,
    symbol: history.market.symbol,
    from: input.from,
    to: input.to,
    windows: rows.length,
    rows,
    signals: [...signals.values()],
    comparisons,
    interpretation: "OFFLINE_SIGNALS_ONLY_NO_FINANCIAL_RESULTS",
  };
}
