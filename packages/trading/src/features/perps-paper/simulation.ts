import { isPtsAccount, ptsQuantityAtBlock, updatePtsStop } from "../pts/account.js";
import { PilotError } from "@pickler/core";
import type { PerpSnapshot, PerpOrderBook, PerpFundingHistory, PerpSymbol } from "@pickler/core";
import type {
  PerpsPaperAccount,
  PerpsPaperIntent,
  PerpsPaperFill,
  PerpsPaperMovement,
  PerpsPaperPosition,
} from "./types.js";
import {
  PAPER_SCALE as S,
  paperUnits as u,
  paperDecimal as d,
  paperCash,
  paperProduct,
} from "./decimal.js";
import { paperRisk } from "./policy.js";
import { COMPONENT_PAPER_POLICY, type PerpsPaperDataPolicy } from "./types.js";
export interface PerpsPaperFrame {
  snapshot: PerpSnapshot;
  book: PerpOrderBook;
  hash: string;
  /** Copied stream continuity, independent of original price/book timestamps. */
  streamEvidence?: {
    policy: typeof COMPONENT_PAPER_POLICY;
    generation: number;
    copiedAt: number;
    heartbeatSequence: number;
    headBlock: number;
    heartbeatReceivedAt: number;
  };
}
export interface PerpsPaperObservation {
  marksOnly?: boolean;
  /** Infrastructure product path only: advance confirmed funding coverage in bounded windows. */
  incrementalFunding?: boolean;
  frames: PerpsPaperFrame[];
  funding: PerpFundingHistory[];
}
export type PerpsFrameValidationReason =
  | "invalid-native-date-or-block"
  | "native-freshness-or-identity"
  | "missing-stream-proof"
  | "invalid-stream-proof"
  | "heartbeat-after-buffer-copy"
  | "buffer-copy-ahead-of-receipt-clock"
  | "heartbeat-expired-at-receipt-clock"
  | "mixed-stream-generation-or-reference";
export class PerpsFrameValidationFailure extends PilotError {
  readonly details: {
    version: 1;
    reason: PerpsFrameValidationReason;
    symbol: PerpSymbol;
    frameHash: string | null;
    financialAt: number | null;
    receiptAt: number | null;
    tickerAt: number | null;
    bookAt: number | null;
    generation: number | null;
    copiedAt: number | null;
    heartbeatReceivedAt: number | null;
  };
  constructor(
    code: string,
    reason: PerpsFrameValidationReason,
    frame: PerpsPaperFrame,
    symbol: PerpSymbol,
    financialAt: number,
    receiptAt: number,
  ) {
    super(code, `Perpetual component validation failed: ${reason}`);
    const safe = (value: unknown) =>
      typeof value === "number" && Number.isSafeInteger(value) ? value : null;
    this.details = {
      version: 1,
      reason,
      symbol,
      frameHash: /^[a-f0-9]{64}$/.test(frame.hash) ? frame.hash : null,
      financialAt: safe(financialAt),
      receiptAt: safe(receiptAt),
      tickerAt: safe(frame.snapshot.ticker.provenance.providerTimestamp),
      bookAt: safe(frame.book.provenance.providerTimestamp),
      generation: safe(frame.streamEvidence?.generation),
      copiedAt: safe(frame.streamEvidence?.copiedAt),
      heartbeatReceivedAt: safe(frame.streamEvidence?.heartbeatReceivedAt),
    };
  }
}
/** Only demonstrated aging can be a recoverable observation after confirmed rollback. */
export function isComponentFrameExpiry(error: unknown): error is PerpsFrameValidationFailure {
  if (!(error instanceof PerpsFrameValidationFailure) || error.code !== "STALE_MARKET_DATA") {
    return false;
  }
  const d = error.details;
  if (d.reason === "heartbeat-expired-at-receipt-clock") {
    return (
      d.receiptAt !== null &&
      d.heartbeatReceivedAt !== null &&
      d.receiptAt - d.heartbeatReceivedAt > 5000
    );
  }
  return (
    d.reason === "native-freshness-or-identity" &&
    d.financialAt !== null &&
    d.tickerAt !== null &&
    d.bookAt !== null &&
    d.tickerAt <= d.financialAt + 5000 &&
    d.bookAt <= d.financialAt + 5000 &&
    (d.financialAt - d.tickerAt > 30000 || d.financialAt - d.bookAt > 30000)
  );
}
const failure = (code: string): never => {
  throw new PilotError(code, "Perpetual paper data is not admissible");
};
function validateFrameIdentityAndDates(
  frame: PerpsPaperFrame,
  network: string,
  symbol: PerpSymbol,
  now: number,
  reducing = false,
) {
  const { snapshot: s, book: b } = frame;
  if (
    !/^[a-f0-9]{64}$/.test(frame.hash) ||
    s.market.symbol !== symbol ||
    b.market.symbol !== symbol ||
    s.market.marketId !== b.market.marketId ||
    s.market.perpetualId !== b.market.perpetualId ||
    s.market.instanceId !== b.market.instanceId ||
    s.market.exchangeAddress !== b.market.exchangeAddress ||
    s.market.collateral.address !== b.market.collateral.address ||
    s.market.collateral.decimals !== b.market.collateral.decimals ||
    s.market.configVersion !== b.market.configVersion ||
    s.market.priceDecimals !== b.market.priceDecimals ||
    s.market.sizeDecimals !== b.market.sizeDecimals ||
    s.market.provenance.network !== network ||
    b.provenance.network !== network ||
    (!reducing && (!s.market.open || !b.market.open))
  ) {
    failure("INVALID_MARKET_DATA");
  }
  const ticker = s.ticker.provenance,
    book = b.provenance;
  for (const p of [ticker, book]) {
    if (
      p.providerTimestamp === null ||
      p.block === null ||
      now - p.providerTimestamp > 30000 ||
      p.providerTimestamp > now + 5000
    ) {
      failure("STALE_MARKET_DATA");
    }
  }
}
/** Shared component checks; this alone never authorizes a financial fill. */
export function validatePaperFrameComponents(
  frame: PerpsPaperFrame,
  network: string,
  symbol: PerpSymbol,
  now: number,
  reducing = false,
) {
  validateFrameIdentityAndDates(frame, network, symbol, now, reducing);
  if (u(frame.snapshot.ticker.mark) <= 0n) {
    failure("INCONSISTENT_MARKET_DATA");
  }
}
export function validatePaperFrame(
  frame: PerpsPaperFrame,
  network: string,
  symbol: PerpSymbol,
  now: number,
  policy?: PerpsPaperDataPolicy | boolean,
  receiptNow = now,
  reducing = false,
) {
  if (typeof policy === "boolean") {
    reducing = policy;
    policy = undefined;
  }
  if (policy !== undefined) {
    if (policy !== COMPONENT_PAPER_POLICY) {
      failure("INVALID_INPUT");
    }
    const rejected = (code: string, reason: PerpsFrameValidationReason): never => {
      throw new PerpsFrameValidationFailure(code, reason, frame, symbol, now, receiptNow);
    };
    for (const provenance of [frame.snapshot.ticker.provenance, frame.book.provenance]) {
      if (
        ![provenance.providerTimestamp, provenance.block].every(
          (value) => value !== null && Number.isSafeInteger(value) && value >= 0,
        )
      ) {
        rejected("INVALID_MARKET_DATA", "invalid-native-date-or-block");
      }
    }
    try {
      validatePaperFrameComponents(frame, network, symbol, now, reducing);
    } catch (error) {
      if (error instanceof PilotError) {
        rejected(error.code, "native-freshness-or-identity");
      }
      throw error;
    }
    const stream = frame.streamEvidence ?? rejected("INVALID_MARKET_DATA", "missing-stream-proof");
    if (
      stream.policy !== policy ||
      ![
        stream.generation,
        stream.copiedAt,
        stream.heartbeatSequence,
        stream.headBlock,
        stream.heartbeatReceivedAt,
        now,
        receiptNow,
      ].every((value) => Number.isSafeInteger(value) && value >= 0) ||
      stream.generation < 1
    ) {
      rejected("INVALID_MARKET_DATA", "invalid-stream-proof");
    }
    if (stream.heartbeatReceivedAt > stream.copiedAt) {
      rejected("INVALID_MARKET_DATA", "heartbeat-after-buffer-copy");
    }
    if (stream.copiedAt > receiptNow) {
      rejected("INVALID_MARKET_DATA", "buffer-copy-ahead-of-receipt-clock");
    }
    if (receiptNow - stream.heartbeatReceivedAt > 5000) {
      rejected("STALE_MARKET_DATA", "heartbeat-expired-at-receipt-clock");
    }
    return;
  }
  validateFrameIdentityAndDates(frame, network, symbol, now, reducing);
  if (
    Math.abs(
      frame.snapshot.ticker.provenance.providerTimestamp! -
        frame.book.provenance.providerTimestamp!,
    ) > 5000 ||
    u(frame.snapshot.ticker.mark) <= 0n
  ) {
    failure("INCONSISTENT_MARKET_DATA");
  }
}
/** A final set must come from one copied connection generation and a common clock. */
export function validatePaperFrameSet(
  frames: readonly PerpsPaperFrame[],
  network: string,
  now: number,
  policy?: PerpsPaperDataPolicy,
  receiptNow = now,
) {
  for (const frame of frames) {
    validatePaperFrame(frame, network, frame.snapshot.market.symbol, now, policy, receiptNow);
  }
  if (policy === COMPONENT_PAPER_POLICY && frames.length) {
    const first = frames[0]!.streamEvidence!;
    if (
      frames.some((frame) =>
        Object.keys(first).some(
          (key) =>
            frame.streamEvidence![key as keyof typeof first] !== first[key as keyof typeof first],
        ),
      )
    ) {
      const divergent = frames.find((frame) =>
        Object.keys(first).some(
          (key) =>
            frame.streamEvidence![key as keyof typeof first] !== first[key as keyof typeof first],
        ),
      )!;
      throw new PerpsFrameValidationFailure(
        "INVALID_MARKET_DATA",
        "mixed-stream-generation-or-reference",
        divergent,
        divergent.snapshot.market.symbol,
        now,
        receiptNow,
      );
    }
  }
}
export function simulatePerpsFill(
  account: PerpsPaperAccount,
  intent: PerpsPaperIntent,
  frame: PerpsPaperFrame,
  now: number,
  receiptNow = now,
): PerpsPaperFill {
  if (account.scope.sessionId === "product" && account.marketDataPolicy !== undefined) {
    failure("INVALID_INPUT");
  }
  validatePaperFrame(
    frame,
    account.scope.network,
    intent.symbol,
    now,
    account.marketDataPolicy,
    receiptNow,
    intent.kind === "close",
  );
  const held = account.positions.find(
    (position) => position.symbol === intent.symbol && position.closedAt === null,
  );
  if (
    held?.market &&
    (held.market.marketId !== frame.snapshot.market.marketId ||
      held.market.perpetualId !== frame.snapshot.market.perpetualId ||
      held.market.instanceId !== frame.snapshot.market.instanceId ||
      held.market.exchangeAddress !== frame.snapshot.market.exchangeAddress ||
      held.market.collateral.address !== frame.snapshot.market.collateral.address)
  ) {
    failure("PERPL_MARKET_IDENTITY");
  }
  const buying = (intent.kind === "open") === (intent.side === "long");
  const levels = buying ? frame.book.asks : frame.book.bids;
  if (!levels[0]) {
    failure("INSUFFICIENT_DEPTH");
  }
  const best = u(levels[0]!.price);
  const worst = buying ? (best * 10050n) / 10000n : (best * 9950n) / 10000n;
  const step = 10n ** BigInt(18 - frame.book.market.sizeDecimals);
  let quantity: bigint;
  if (intent.kind === "open") {
    // Upper price bound keeps the fill within the intent's notional for either side.
    if (intent.pts?.quantity !== undefined && !isPtsAccount(account)) {
      failure("INVALID_INPUT");
    }
    quantity =
      isPtsAccount(account) && intent.pts?.quantity !== undefined
        ? u(intent.pts.quantity)
        : ((u(intent.notional) * S) / ((best * 10050n) / 10000n) / step) * step;
    if (quantity % step !== 0n) {
      failure("INVALID_INPUT");
    }
  } else {
    const position = account.positions.find(
      (p) => p.closedAt === null && p.symbol === intent.symbol && p.side === intent.side,
    );
    if (!position) {
      failure("NO_POSITION");
    }
    if (intent.pts?.quantity !== undefined && !isPtsAccount(account)) {
      failure("INVALID_INPUT");
    }
    quantity = u(
      isPtsAccount(account) ? (intent.pts?.quantity ?? position!.quantity) : position!.quantity,
    );
    if (quantity > u(position!.quantity) || quantity % step !== 0n) {
      failure("INVALID_INPUT");
    }
  }
  if (quantity <= 0n) {
    failure("QUANTITY_TOO_SMALL");
  }
  let remaining = quantity,
    notional = 0n;
  const consumed: { price: string; quantity: string }[] = [];
  for (const level of levels) {
    const price = u(level.price);
    if ((buying && price > worst) || (!buying && price < worst)) {
      break;
    }
    const available = (u(level.size) / step) * step;
    const take = available < remaining ? available : remaining;
    if (take <= 0n) {
      continue;
    }
    notional += (take * price) / S;
    remaining -= take;
    consumed.push({ price: level.price, quantity: d(take) });
    if (remaining === 0n) {
      break;
    }
  }
  if (remaining !== 0n) {
    failure("INSUFFICIENT_DEPTH");
  }
  const feeRate = frame.book.market.fees.taker;
  if (u(feeRate) < 0n) {
    failure("UNSUPPORTED_FEE");
  }
  const fee = d(-u(paperCash(d((-notional * u(feeRate)) / S))));
  const average = (notional * S) / quantity;
  return {
    ...(account.scope.sessionId === "product" || isPtsAccount(account)
      ? { market: structuredClone(frame.snapshot.market) }
      : {}),
    quantity: d(quantity),
    price: d(average),
    notional: d(notional),
    fee,
    block: frame.book.provenance.block!,
    timestamp: frame.book.provenance.providerTimestamp!,
    mark: {
      price: frame.snapshot.ticker.mark,
      timestamp: frame.snapshot.ticker.provenance.providerTimestamp!,
    },
    evidence: {
      model: "l2-full-fill-v1",
      frame,
      consumed,
      bestPrice: d(best),
      slippageQuote: d((buying ? 1n : -1n) * (notional - (quantity * best) / S)),
      spread:
        frame.book.asks[0] && frame.book.bids[0]
          ? d(u(frame.book.asks[0].price) - u(frame.book.bids[0].price))
          : null,
    },
  };
}
export function applyPaperObservation(
  account: PerpsPaperAccount,
  previous: PerpsPaperMovement[],
  observation: PerpsPaperObservation,
  key: string,
  now: number,
  receiptNow = now,
) {
  const a = applyPaperMarks(account, observation.frames, now, receiptNow);
  const movements: PerpsPaperMovement[] = [];
  let pending = observation.marksOnly ? a.fundingPending : (a.fundingDisputed ?? false);
  for (const p of observation.marksOnly ? [] : a.positions) {
    const result = applyPaperPositionFunding(
      a,
      p,
      previous,
      observation.funding.find((h) => h.market.symbol === p.symbol),
      now,
      observation.incrementalFunding === true,
    );
    pending ||= result.pending;
    if (result.disputed) {
      a.fundingDisputed = true;
    }
    movements.push(...result.movements);
  }
  if (a.fundingDisputed) {
    for (const p of a.positions) {
      const original = account.positions.find((item) => item.id === p.id)?.fundingCoveredThrough;
      if (original === undefined) {
        delete p.fundingCoveredThrough;
      } else {
        p.fundingCoveredThrough = original;
      }
    }
  }
  return finalizePaperObservation(a, movements, pending, observation.marksOnly === true, key, now);
}

/** Validate and mark only; cash/day/peak finalization is intentionally separate. */
export function applyPaperMarks(
  account: PerpsPaperAccount,
  frames: readonly PerpsPaperFrame[],
  now: number,
  receiptNow = now,
) {
  const a = structuredClone(account);
  if (a.scope.sessionId === "product" && a.marketDataPolicy !== undefined) {
    failure("INVALID_INPUT");
  }
  if (a.marketDataPolicy) {
    validatePaperFrameSet([...frames], a.scope.network, now, a.marketDataPolicy, receiptNow);
  }
  for (const frame of frames) {
    validatePaperFrame(
      frame,
      a.scope.network,
      frame.snapshot.market.symbol,
      now,
      a.marketDataPolicy,
      receiptNow,
      a.positions.some((p) => p.symbol === frame.snapshot.market.symbol),
    );
    for (const p of a.positions.filter(
      (p) => p.closedAt === null && p.symbol === frame.snapshot.market.symbol,
    )) {
      if (
        p.market &&
        (p.market.marketId !== frame.snapshot.market.marketId ||
          p.market.perpetualId !== frame.snapshot.market.perpetualId ||
          p.market.collateral.address !== frame.snapshot.market.collateral.address)
      ) {
        failure("PERPL_MARKET_IDENTITY");
      }
      if (p.markAt !== null && p.markAt > frame.snapshot.ticker.provenance.providerTimestamp!) {
        failure("OUT_OF_ORDER_MARK");
      }
      p.mark = frame.snapshot.ticker.mark;
      p.markAt = frame.snapshot.ticker.provenance.providerTimestamp;
      if (isPtsAccount(a)) {
        updatePtsStop(p, frame, now);
      }
    }
  }
  return a;
}

/** Native held-interval kernel, including closed positions and late/revised histories. */
export function applyPaperPositionFunding(
  account: PerpsPaperAccount,
  position: PerpsPaperPosition,
  previous: readonly PerpsPaperMovement[],
  history: PerpFundingHistory | undefined,
  now: number,
  incrementalFunding = false,
): { movements: PerpsPaperMovement[]; pending: boolean; disputed: boolean } {
  const a = account;
  const p = position;
  const movements: PerpsPaperMovement[] = [];
  let pending = false;
  let disputed = false;
  const incremental = incrementalFunding && a.scope.sessionId === "product";
  const coverageFrom = incremental
    ? Math.max(p.openedAt, (p.fundingCoveredThrough ?? p.openedAt) - 30000)
    : p.openedAt;
  if (
    !history ||
    (p.market !== undefined &&
      (p.market.marketId !== history.market.marketId ||
        p.market.perpetualId !== history.market.perpetualId ||
        p.market.collateral.address !== history.market.collateral.address)) ||
    history.market.provenance.network !== a.scope.network ||
    !history.complete ||
    history.from > coverageFrom ||
    (incremental ? history.to < coverageFrom : history.to < (p.closedAt ?? now) - 30000)
  ) {
    pending = true;
    return { movements, pending, disputed };
  }
  for (const event of history.events) {
    if (
      event.eventBlock <= p.entryBlock ||
      (p.exitBlock !== null && event.eventBlock > p.exitBlock)
    ) {
      continue;
    }
    if (event.estimated || event.appliesAt === null || event.appliesAt > now) {
      pending = true;
      continue;
    }
    const movementKey = `funding:${p.id}:${event.eventBlock}`;
    const evidence = {
      model: isPtsAccount(a) ? "quantity-timeline-index-rate-v2" : "quantity-index-rate-v1",
      ...(isPtsAccount(a) ? { quantity: ptsQuantityAtBlock(p, event.eventBlock) } : {}),
      symbol: p.symbol,
      positionId: p.id,
      eventBlock: event.eventBlock,
      appliesAt: event.appliesAt,
      rate: event.rate,
      index: event.index,
    };
    const existing = previous.find((m) => m.key === movementKey);
    if (existing) {
      const old = existing.evidence as typeof evidence;
      if (
        old.rate !== evidence.rate ||
        old.index !== evidence.index ||
        old.appliesAt !== evidence.appliesAt ||
        (isPtsAccount(a) && old.quantity !== evidence.quantity)
      ) {
        disputed = true;
        pending = true;
      }
      continue;
    }
    const delta = paperCash(
      d(
        ((u(
          paperProduct(
            isPtsAccount(a) ? ptsQuantityAtBlock(p, event.eventBlock) : p.quantity,
            event.index,
          ),
        ) *
          u(event.rate)) /
          S) *
          (p.side === "long" ? -1n : 1n),
      ),
    );
    movements.push({ key: movementKey, kind: "funding", delta, at: now, evidence });
  }
  if (incremental && !pending && !disputed && !a.fundingDisputed) {
    p.fundingCoveredThrough = Math.max(
      p.fundingCoveredThrough ?? p.openedAt,
      Math.min(history.to, p.closedAt ?? now, now),
    );
    if (p.fundingCoveredThrough < (p.closedAt ?? now) - 30000) {
      pending = true;
    }
  }
  return { movements, pending, disputed };
}

/** Finalize once after all native position kernels; never reset a day/peak per position. */
export function finalizePaperObservation(
  account: PerpsPaperAccount,
  originalMovements: readonly PerpsPaperMovement[],
  pending: boolean,
  marksOnly: boolean,
  key: string,
  now: number,
) {
  const a = structuredClone(account);
  const movements = [...originalMovements];
  if (a.fundingDisputed) {
    movements.length = 0;
  }
  const delta = d(movements.reduce((sum, m) => sum + u(m.delta), 0n));
  const result = finalizePaperObservationDelta(a, delta, pending, marksOnly, key, now);
  return { account: result.account, movements, key: result.key };
}

/** Bounded-history adapters sum exact native postings, then finalize the account once. */
export function finalizePaperObservationDelta(
  account: PerpsPaperAccount,
  nativeCashDelta: string,
  pending: boolean,
  marksOnly: boolean,
  key: string,
  now: number,
) {
  const a = structuredClone(account);
  if (a.fundingDisputed && u(nativeCashDelta) !== 0n) {
    failure("FUNDING_DISPUTED");
  }
  a.cash = d(u(a.cash) + u(nativeCashDelta));
  a.fundingPending = pending;
  if (a.scope.sessionId === "product" && !marksOnly && !pending) {
    a.lastFundingAt = now;
  }
  const risk = paperRisk(a, [], now);
  const day = new Date(now).toISOString().slice(0, 10);
  if (day !== a.day) {
    const midnight = Date.parse(`${day}T00:00:00Z`);
    a.day = day;
    a.dailyBlocked = false;
    // The first observed equity is admissible only across continuous minute sampling.
    a.dayEquity =
      risk.equity !== null &&
      now - midnight <= 90000 &&
      a.lastValuationAt !== undefined &&
      a.lastValuationAt >= midnight - 90000
        ? risk.equity
        : null;
  }
  if (risk.equity !== null) {
    if (a.dayEquity !== null && u(risk.equity) * 100n <= u(a.dayEquity) * 97n) {
      a.dailyBlocked = true;
    }
    if (u(risk.equity) * 100n <= u(a.peakEquity) * 95n || u(risk.equity) <= 0n) {
      a.blocked = true;
    }
    if (u(risk.equity) > u(a.peakEquity)) {
      a.peakEquity = risk.equity;
    }
    a.lastValuationAt = now;
  }
  return { account: a, key };
}

/** The provider's complete=true is the canonical contiguous-window coverage assertion. A missing
 * interval cannot jump this cursor; overlap revalidates event identities before new postings. */
export function paperFundingRange(
  positions: import("./types.js").PerpsPaperPosition[],
  symbol: PerpSymbol,
  now: number,
) {
  const from = Math.min(
    ...positions
      .filter((p) => p.symbol === symbol)
      .map((p) => Math.max(p.openedAt, (p.fundingCoveredThrough ?? p.openedAt) - 30000)),
  );
  const padding = Math.max(
    0,
    ...positions
      .filter((p) => p.symbol === symbol)
      .map((p) => (p.market?.fundingIntervalSeconds ?? 0) * 1000),
  );
  return { from: Math.max(0, from - padding), to: Math.min(now, from + 3600000) };
}
