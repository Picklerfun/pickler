import { PilotError } from "../research/types.js";
import type {
  PerpSnapshot,
  PerpOrderBook,
  PerpFundingHistory,
  PerpSymbol,
} from "../perps/types.js";
import type {
  PerpsPaperAccount,
  PerpsPaperIntent,
  PerpsPaperFill,
  PerpsPaperMovement,
} from "./types.js";
import {
  PAPER_SCALE as S,
  paperUnits as u,
  paperDecimal as d,
  paperCash,
  paperProduct,
} from "./decimal.js";
import { paperRisk } from "./policy.js";
export interface PerpsPaperFrame {
  snapshot: PerpSnapshot;
  book: PerpOrderBook;
  hash: string;
}
export interface PerpsPaperObservation {
  marksOnly?: boolean;
  frames: PerpsPaperFrame[];
  funding: PerpFundingHistory[];
}
const failure = (code: string): never => {
  throw new PilotError(code, "Perpetual paper data is not admissible");
};
export function validatePaperFrame(
  frame: PerpsPaperFrame,
  network: string,
  symbol: PerpSymbol,
  now: number,
) {
  const { snapshot: s, book: b } = frame;
  if (
    !/^[a-f0-9]{64}$/.test(frame.hash) ||
    s.market.symbol !== symbol ||
    b.market.symbol !== symbol ||
    s.market.marketId !== b.market.marketId ||
    s.market.configVersion !== b.market.configVersion ||
    s.market.priceDecimals !== b.market.priceDecimals ||
    s.market.sizeDecimals !== b.market.sizeDecimals ||
    s.market.provenance.network !== network ||
    b.provenance.network !== network ||
    !s.market.open ||
    !b.market.open
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
  if (
    Math.abs(ticker.providerTimestamp! - book.providerTimestamp!) > 5000 ||
    u(s.ticker.mark) <= 0n
  ) {
    failure("INCONSISTENT_MARKET_DATA");
  }
}
export function simulatePerpsFill(
  account: PerpsPaperAccount,
  intent: PerpsPaperIntent,
  frame: PerpsPaperFrame,
  now: number,
): PerpsPaperFill {
  validatePaperFrame(frame, account.scope.network, intent.symbol, now);
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
    // Upper price bound protects the 100-unit notional ceiling for either side.
    quantity = ((u(intent.notional) * S) / ((best * 10050n) / 10000n) / step) * step;
  } else {
    const position = account.positions.find(
      (p) => p.closedAt === null && p.symbol === intent.symbol && p.side === intent.side,
    );
    if (!position) {
      failure("NO_POSITION");
    }
    quantity = u(position!.quantity);
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
) {
  const a = structuredClone(account);
  const movements: PerpsPaperMovement[] = [];
  for (const frame of observation.frames) {
    validatePaperFrame(frame, a.scope.network, frame.snapshot.market.symbol, now);
    for (const p of a.positions.filter(
      (p) => p.closedAt === null && p.symbol === frame.snapshot.market.symbol,
    )) {
      if (p.markAt !== null && p.markAt > frame.snapshot.ticker.provenance.providerTimestamp!) {
        failure("OUT_OF_ORDER_MARK");
      }
      p.mark = frame.snapshot.ticker.mark;
      p.markAt = frame.snapshot.ticker.provenance.providerTimestamp;
    }
  }
  let pending = observation.marksOnly ? a.fundingPending : (a.fundingDisputed ?? false);
  for (const p of observation.marksOnly ? [] : a.positions) {
    const history = observation.funding.find((h) => h.market.symbol === p.symbol);
    if (
      !history ||
      history.market.provenance.network !== a.scope.network ||
      !history.complete ||
      history.from > p.openedAt ||
      history.to < (p.closedAt ?? now) - 30000
    ) {
      pending = true;
      continue;
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
        model: "quantity-index-rate-v1",
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
          old.appliesAt !== evidence.appliesAt
        ) {
          a.fundingDisputed = true;
          pending = true;
        }
        continue;
      }
      const delta = paperCash(
        d(
          ((u(paperProduct(p.quantity, event.index)) * u(event.rate)) / S) *
            (p.side === "long" ? -1n : 1n),
        ),
      );
      movements.push({ key: movementKey, kind: "funding", delta, at: now, evidence });
    }
  }
  if (a.fundingDisputed) {
    movements.length = 0;
  }
  a.cash = d(u(a.cash) + movements.reduce((sum, m) => sum + u(m.delta), 0n));
  a.fundingPending = pending;
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
  return { account: a, movements, key };
}
