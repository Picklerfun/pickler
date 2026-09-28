import { PilotError, type AgentRecord } from "../research/types.js";
import { pluginEnabled } from "../research/plugins.js";
import {
  PAPER_SCALE,
  paperUnits as u,
  paperDecimal as d,
  paperProduct,
  paperCash,
} from "./decimal.js";
import type {
  PerpsPaperAccount,
  PerpsPaperAttempt,
  PerpsPaperIntent,
  PerpsPaperRisk,
  PerpsPaperScope,
  PerpsPaperFill,
  PerpsPaperMovement,
} from "./types.js";
export function assertPerpsPaperAgent(agent: AgentRecord, scope: PerpsPaperScope, version: number) {
  if (agent.id !== scope.agentId || agent.tenantId !== scope.tenantId) {
    throw new PilotError("FORBIDDEN", "Agent scope does not match");
  }
  if (agent.version !== version) {
    throw new PilotError("CONFIG_CHANGED", "Agent configuration changed");
  }
  if (!pluginEnabled(agent.config, "perps-paper") || !pluginEnabled(agent.config, "perpl")) {
    throw new PilotError("PLUGIN_DISABLED", "Perpl and perps-paper must be enabled");
  }
  if (
    agent.config.perpsPaper?.version !== 1 ||
    agent.config.perpsPaper.policy !== "conservative-1x-v1" ||
    agent.config.perpl?.network !== scope.network
  ) {
    throw new PilotError("PLUGIN_NOT_CONFIGURED", "Configure paper policy and Perpl network");
  }
}
export function assertPaperIntent(intent: PerpsPaperIntent) {
  if (
    !["open", "close"].includes(intent.kind) ||
    !["BTC", "ETH"].includes(intent.symbol) ||
    !["long", "short"].includes(intent.side) ||
    u(intent.notional) < 0n ||
    u(intent.feeReserve) < 0n ||
    u(intent.feeReserve) > u("10")
  ) {
    throw new PilotError("INVALID_INPUT", "Invalid paper intent");
  }
}
export function paperRisk(
  account: PerpsPaperAccount,
  attempts: PerpsPaperAttempt[],
  now: number,
  intent?: PerpsPaperIntent,
): PerpsPaperRisk {
  if (intent) {
    assertPaperIntent(intent);
  }
  const open = account.positions.filter((p) => p.closedAt === null);
  const unknown = open.some(
    (p) => p.mark === null || p.markAt === null || now - p.markAt > 30_000 || p.markAt > now + 5000,
  );
  const unrealized = unknown
    ? null
    : open.reduce(
        (sum, p) =>
          sum +
          (((u(p.mark!) - u(p.entryPrice)) * u(p.quantity)) / PAPER_SCALE) *
            (p.side === "long" ? 1n : -1n),
        0n,
      );
  const equity = unrealized === null ? null : u(account.cash) + unrealized;
  const exposure = unknown
    ? null
    : open.reduce((sum, p) => sum + u(paperProduct(p.quantity, p.mark!)), 0n);
  const margin = open.reduce((sum, p) => sum + u(p.entryNotional), 0n);
  const reserved = attempts
    .filter((a) => a.status === "pending")
    .reduce((sum, a) => sum + u(a.reserved), 0n);
  const available =
    equity === null
      ? null
      : (equity < u(account.cash) ? equity : u(account.cash)) - margin - reserved;
  const reasons: string[] = [];
  const closeSymbols = new Set<"BTC" | "ETH">();
  if (equity === null) {
    reasons.push("UNKNOWN_MARKS");
  }
  if (account.fundingPending) {
    reasons.push("FUNDING_PENDING");
  }
  if (account.day !== new Date(now).toISOString().slice(0, 10) || account.dayEquity === null) {
    reasons.push("DAY_BASELINE_PENDING");
  }
  const daily =
    account.dailyBlocked ||
    (equity !== null && account.dayEquity !== null && equity * 100n <= u(account.dayEquity) * 97n);
  const drawdown = equity !== null && equity * 100n <= u(account.peakEquity) * 95n;
  if (daily) {
    reasons.push("DAILY_LOSS");
  }
  if (drawdown || account.blocked) {
    reasons.push("SESSION_DRAWDOWN");
  }
  if (equity !== null && equity <= 0n) {
    reasons.push("INSOLVENT");
  }
  if (exposure !== null && equity !== null && exposure * 2n > equity) {
    reasons.push("EXPOSURE_LIMIT");
  }
  for (const p of open) {
    const stop =
      p.mark !== null &&
      p.markAt !== null &&
      now - p.markAt <= 30000 &&
      p.markAt <= now + 5000 &&
      (p.side === "long"
        ? u(p.mark) * 100n <= u(p.entryPrice) * 98n
        : u(p.mark) * 100n >= u(p.entryPrice) * 102n);
    if (
      stop ||
      now - p.openedAt >= 4 * 3600000 ||
      daily ||
      drawdown ||
      account.blocked ||
      (equity !== null && (equity <= 0n || (exposure !== null && exposure * 2n > equity)))
    ) {
      closeSymbols.add(p.symbol);
    }
  }
  if (intent?.kind === "close") {
    const p = open.find((p) => p.symbol === intent.symbol && p.side === intent.side);
    return {
      allowed: !!p && !attempts.some((a) => a.status === "pending"),
      reasons: p
        ? attempts.some((a) => a.status === "pending")
          ? ["ATTEMPT_PENDING"]
          : []
        : ["NO_POSITION"],
      closeSymbols: [...closeSymbols],
      cash: account.cash,
      equity: equity === null ? null : d(equity),
      unrealized: unrealized === null ? null : d(unrealized),
      margin: d(margin),
      reserved: d(reserved),
      available: available === null ? null : d(available),
      exposure: exposure === null ? null : d(exposure),
    };
  }
  if (intent) {
    if (u(intent.notional) <= 0n || u(intent.notional) > u("100")) {
      reasons.push("OPEN_NOTIONAL_LIMIT");
    }
    if (open.some((p) => p.symbol === intent.symbol)) {
      reasons.push("POSITION_EXISTS");
    }
    if (attempts.some((a) => a.status === "pending")) {
      reasons.push("ATTEMPT_PENDING");
    }
    if (available !== null && u(intent.notional) + u(intent.feeReserve) > available) {
      reasons.push("INSUFFICIENT_AVAILABLE");
    }
    if (exposure !== null && equity !== null && (exposure + u(intent.notional)) * 2n > equity) {
      reasons.push("EXPOSURE_LIMIT");
    }
  }
  return {
    allowed: reasons.length === 0,
    reasons: [...new Set(reasons)],
    closeSymbols: [...closeSymbols],
    cash: account.cash,
    equity: equity === null ? null : d(equity),
    unrealized: unrealized === null ? null : d(unrealized),
    margin: d(margin),
    reserved: d(reserved),
    available: available === null ? null : d(available),
    exposure: exposure === null ? null : d(exposure),
  };
}
export function initialPaperAccount(
  scope: PerpsPaperScope,
  agentVersion: number,
  now: number,
): PerpsPaperAccount {
  return {
    scope,
    agentVersion,
    policy: "conservative-1x-v1",
    createdAt: now,
    cash: "1000",
    peakEquity: "1000",
    day: new Date(now).toISOString().slice(0, 10),
    dayEquity: "1000",
    dailyBlocked: false,
    blocked: false,
    fundingPending: false,
    positions: [],
  };
}
/** Trusted simulator finalization only; the store repeats admission under the same account lock. */
export function applyPaperFill(
  account: PerpsPaperAccount,
  attempt: PerpsPaperAttempt,
  fill: PerpsPaperFill,
  now: number,
): { account: PerpsPaperAccount; movements: PerpsPaperMovement[] } {
  const a = structuredClone(account);
  if (
    attempt.status !== "pending" ||
    u(fill.quantity) <= 0n ||
    u(fill.price) <= 0n ||
    u(fill.notional) - u(paperProduct(fill.quantity, fill.price)) < 0n ||
    u(fill.notional) - u(paperProduct(fill.quantity, fill.price)) > 1000000n ||
    !Number.isSafeInteger(fill.block) ||
    fill.block < 0 ||
    !Number.isSafeInteger(fill.timestamp) ||
    now - fill.timestamp > 30000 ||
    fill.timestamp > now + 5000
  ) {
    throw new PilotError("INVALID_FILL", "Invalid or stale paper fill");
  }
  if (
    fill.mark &&
    (u(fill.mark.price) <= 0n ||
      now - fill.mark.timestamp > 30000 ||
      fill.mark.timestamp > now + 5000)
  ) {
    throw new PilotError("INVALID_FILL", "Invalid fill mark");
  }
  const fee = paperCash(d(-u(fill.fee)));
  if (
    (attempt.intent.kind === "open" && u(fill.fee) > u(attempt.intent.feeReserve)) ||
    u(fill.fee) < 0n
  ) {
    throw new PilotError("INVALID_FILL", "Fee exceeds reservation");
  }
  const movements: PerpsPaperMovement[] = [
    { key: `${attempt.key}:fee`, kind: "fee", delta: fee, at: now, evidence: fill.evidence },
  ];
  if (attempt.intent.kind === "open") {
    if (
      u(fill.notional) > u(attempt.intent.notional) ||
      a.positions.some((p) => p.closedAt === null && p.symbol === attempt.intent.symbol)
    ) {
      throw new PilotError("INVALID_FILL", "Opening exceeds intent");
    }
    a.positions.push({
      id: attempt.key,
      symbol: attempt.intent.symbol,
      side: attempt.intent.side,
      quantity: fill.quantity,
      entryPrice: fill.price,
      entryNotional: fill.notional,
      openedAt: now,
      entryBlock: fill.block,
      mark: fill.mark?.price ?? null,
      markAt: fill.mark?.timestamp ?? null,
      closedAt: null,
      exitPrice: null,
      exitBlock: null,
    });
  } else {
    const p = a.positions.find(
      (p) =>
        p.symbol === attempt.intent.symbol && p.closedAt === null && p.side === attempt.intent.side,
    );
    if (!p || u(p.quantity) !== u(fill.quantity) || fill.block < p.entryBlock) {
      throw new PilotError("INVALID_FILL", "Close must match the full position");
    }
    const pnl = paperCash(
      d((u(fill.notional) - u(p.entryNotional)) * (p.side === "long" ? 1n : -1n)),
    );
    movements.push({
      key: `${attempt.key}:pnl`,
      kind: "realized-pnl",
      delta: pnl,
      at: now,
      evidence: fill.evidence,
    });
    p.closedAt = now;
    p.exitPrice = fill.price;
    p.exitBlock = fill.block;
  }
  a.cash = d(u(a.cash) + movements.reduce((sum, m) => sum + u(m.delta), 0n));
  if (u(a.cash) <= 0n) {
    a.blocked = true;
  }
  return { account: a, movements };
}
