import { createHash } from "node:crypto";
import {
  PilotError,
  effectiveEntry,
  effectiveRisk,
  requireTool,
  type AgentConfig,
  type AgentRecord,
  type PerpCandles,
  type PerpNetwork,
  type PerpSymbol,
  type Scope,
  type Source,
} from "@pickler/core";
import {
  CHECK_INSTRUMENTS,
  PERPS_CHECK_DECISION_VERSION,
  PRODUCT_PAPER_SESSION,
  createPerpsPaperService,
  dayLossReached,
  decideOutcome,
  entryTrace,
  exitLevels,
  exitsMet,
  parseCheckDecision,
  productFreeEquity,
  realizedSince,
  utcDayStart,
  type AdviceSource,
  type PerpsCheck,
  type PerpsCheckDecision,
  type PerpsCheckInputs,
  type PerpsCheckLease,
  type PerpsCheckOutcome,
  type PerpsCheckResult,
  type PerpsPaperFrame,
  type PerpsPaperMark,
  type PerpsPaperPosition,
  type PerpsPaperScope,
  type PerpsPaperView,
  type PerpsProductPaperRepository,
  type PerpsRuntimeRepository,
} from "@pickler/trading/perps";
import type { PerpsCheckModel } from "./perps-check-model.js";

/** The least a wallet must hold for the first check to open its paper account (R9). */
export const PERPS_WALLET_MINIMUM_AUSD = 10;
/** Closed hourly candles the model sees per instrument (R5). */
export const PERPS_CHECK_CANDLES = 48;
/** Web results the model sees at most (R5). */
export const PERPS_CHECK_WEB_RESULTS = 3;
/** Characters of each web result the model sees. */
const WEB_CONTENT_LIMIT = 1500;

/** One instrument's evidence, read through `readPerplInstrument`. */
export interface PerpsInstrumentRead {
  frame: PerpsPaperFrame;
  candles: PerpCandles;
  sources: AdviceSource[];
}

/** One bounded Perpl session for one check (24 requests, R5 and §6). */
export interface PerpsCheckSession {
  read(symbol: PerpSymbol): Promise<PerpsInstrumentRead>;
  /** A fresh book and snapshot to fill a paper order at. */
  frame(symbol: PerpSymbol): Promise<PerpsPaperFrame>;
}

export interface PerpsCheckMarket {
  open(scope: Scope, signal: AbortSignal): Promise<PerpsCheckSession>;
}

/** Marks from the shared market board; empty when the board cannot answer freshly. */
export type PerpsMarks = (network: PerpNetwork, signal: AbortSignal) => Promise<PerpsPaperMark[]>;

export interface PerpsCheckWeb {
  /** Site-scoped search under the agent's rules; cost in micro-USD, null when unknown. */
  search(
    web: NonNullable<NonNullable<AgentConfig["sources"]>["web"]>,
    query: string,
    signal: AbortSignal,
  ): Promise<{ sources: Source[]; costMicros: string | null }>;
}

export interface PerpsCheckDependencies {
  store: PerpsRuntimeRepository;
  paper: PerpsProductPaperRepository;
  agents: { agent(scope: Scope): Promise<AgentRecord> };
  wallets: { findAgentWallet(productAgentId: string): Promise<{ address: string } | null> };
  balances: { read(address: string): Promise<number> };
  market: PerpsCheckMarket;
  marks: PerpsMarks;
  web: PerpsCheckWeb;
  model: PerpsCheckModel;
  clock?: () => number;
}

/** The running check's lease; the heartbeat and the paper fence both replace it when renewed. */
export interface PerpsLeaseHolder {
  lease: PerpsCheckLease;
}

const UNFUNDED_TEXT = "FUND ITS WALLET";
const DAY_LOSS_TEXT = "Paused itself · day-loss stop";

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function ausd(value: number) {
  return `${value.toFixed(2)} AUSD`;
}

function signedAusd(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)} AUSD`;
}

/** An AUSD amount as the paper store's decimal string. */
function decimal(value: number) {
  return value.toFixed(6);
}

function line(text: string) {
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

function safeCode(error: unknown, fallback: string) {
  return error instanceof PilotError && /^[A-Z_]{1,80}$/.test(error.code) ? error.code : fallback;
}

/** Board marks for the network, with this check's own (fresher) Perpl marks over them. */
function markMap(board: PerpsPaperMark[], network: PerpNetwork, reads: PerpsInstrumentRead[]) {
  const marks: Partial<Record<PerpSymbol, string>> = {};
  for (const mark of board) {
    if (mark.network === network) {
      marks[mark.symbol] = mark.mark;
    }
  }
  for (const read of reads) {
    marks[read.frame.snapshot.market.symbol] = read.frame.snapshot.ticker.mark;
  }
  return marks;
}

/** The model's input (R5): the brief as numbered lines, the markets, its positions, the web. */
export function perpsCheckState(input: {
  now: number;
  network: PerpNetwork;
  brief: NonNullable<AgentConfig["brief"]>;
  reads: PerpsInstrumentRead[];
  positions: PerpsPaperPosition[];
  web: Source[];
}) {
  const numbered = (lines: string[]) => lines.map((text, i) => ({ index: i + 1, text }));
  const iso = (at: number | null | undefined) =>
    at === null || at === undefined ? null : new Date(at).toISOString();
  return {
    protocol: PERPS_CHECK_DECISION_VERSION,
    now: iso(input.now),
    network: input.network,
    brief: {
      thesis: input.brief.thesis,
      entersWhen: numbered(input.brief.entersWhen),
      exitsWhen: numbered(input.brief.exitsWhen),
      never: numbered(input.brief.never),
    },
    markets: input.reads.map(({ frame, candles }) => ({
      instrument: frame.snapshot.market.symbol,
      mark: frame.snapshot.ticker.mark,
      index: frame.snapshot.ticker.index,
      openInterestBase: frame.snapshot.ticker.openInterestBase,
      funding: frame.snapshot.funding?.rate ?? null,
      dataAsOf: iso(frame.snapshot.ticker.provenance.providerTimestamp),
      book: {
        bids: frame.book.bids.map((level) => [level.price, level.size]),
        asks: frame.book.asks.map((level) => [level.price, level.size]),
      },
      hourlyCandles: candles.candles.map((c) => [
        iso(c.openTime),
        c.open,
        c.high,
        c.low,
        c.close,
        c.volumeCollateral,
      ]),
    })),
    positions: input.positions.map((p) => ({
      instrument: p.symbol,
      side: p.side,
      entryPrice: p.entryPrice,
      leverage: p.leverage ?? 1,
      openedAt: iso(p.openedAt),
      stopPrice: p.stopPrice ?? null,
      takeProfitPrice: p.takeProfitPrice ?? null,
      exitDueAt: iso(p.exitDueAt),
    })),
    web: input.web.map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
      retrievedAt: source.retrievedAt,
      content: source.content.slice(0, WEB_CONTENT_LIMIT),
    })),
    sources: [
      ...input.reads.flatMap((read) => read.sources.map((s) => ({ id: s.id, name: s.name }))),
      ...input.web.map((s) => ({ id: s.id, name: (s.title || "Web source").slice(0, 300) })),
    ],
  };
}

/**
 * One Perpl check, claimed (perpl-paper-runtime-v1 R1–R11): read the brief, make sure the paper
 * account exists (the wallet's AUSD, ≥ 10), read Perpl (and the web), ask the model once, validate,
 * let `decideOutcome` decide, act on paper and finish with timed steps and the known cost.
 *
 * Two contracts from the review of the rules: an opposite call is two phases (the close is its own
 * `exited` row, then the figures are read again and `decideOutcome` runs with no position), and
 * every paper action renews the check's lease right before it (`CHECK_INTERRUPTED` otherwise), so
 * a stalled check can never act after its lease was recovered. Free equity counts open P&L at the
 * board's marks and this check's own; without a mark it does not open, and an open needs its margin
 * plus its fee reserve (notional × taker fee × 1.5) free. Brief exit lines close every held position
 * the model reported a met line for; an instrument outside its markets holds.
 */
export async function runPerpsCheck(
  deps: PerpsCheckDependencies,
  check: PerpsCheck,
  holder: PerpsLeaseHolder,
  signal: AbortSignal,
): Promise<PerpsCheck> {
  const now = deps.clock ?? Date.now;
  const { store, paper } = deps;
  const agentScope: Scope = { tenantId: check.tenantId, agentId: check.agentId };
  let cost: bigint | null = null;
  let decision: PerpsCheckDecision | null = null;
  let inputs: PerpsCheckInputs | null = null;

  const addCost = (micros: string | null) => {
    if (micros !== null) {
      cost = (cost ?? 0n) + BigInt(micros);
    }
  };
  const step = (text: string, ms: number | null = null) =>
    store.appendStep(holder.lease, { text: line(text), ms });
  const timed = async <T>(work: () => Promise<T>): Promise<[T, number]> => {
    const started = now();
    const value = await work();
    return [value, Math.max(0, Math.round(now() - started))];
  };
  const fence = async () => {
    signal.throwIfAborted();
    try {
      holder.lease = await store.renewAgent(holder.lease);
    } catch {
      throw new PilotError("CHECK_INTERRUPTED", "The check lost its lease");
    }
  };

  const agent = await deps.agents.agent(agentScope);
  const finish = (outcome: PerpsCheckOutcome, outcomeText: string, error: string | null = null) =>
    store.finishCheck(holder.lease, {
      outcome,
      outcomeText: line(outcomeText),
      decision,
      inputs,
      configVersion: agent.version,
      costMicros: cost === null ? null : String(cost),
      error,
    });

  const config = agent.config;
  const perpl = config.perpl;
  const brief = config.brief;
  const spend = config.spend;
  if (!perpl || !brief || !spend) {
    await step("It has no Perpl brief and caps to check");
    return finish("failed", "NOT CONFIGURED", "PLUGIN_NOT_CONFIGURED");
  }
  const instruments = CHECK_INSTRUMENTS.filter((symbol) => perpl.markets.includes(symbol));
  if (!instruments.length) {
    await step("It reads no Perpl market the runtime checks");
    return finish("failed", "NO MARKETS", "MARKET_NOT_ALLOWED");
  }
  const counts = {
    entries: brief.entersWhen.length,
    exits: brief.exitsWhen.length,
    never: brief.never.length,
  };
  await step(
    `Read the brief · ${plural(counts.entries, "entry", "entries")}, ${plural(counts.exits, "exit", "exits")}, ${counts.never} never`,
  );

  // The product paper account (R9): opened at the first check with the wallet's AUSD.
  const scope: PerpsPaperScope = {
    ...agentScope,
    sessionId: PRODUCT_PAPER_SESSION,
    network: perpl.network,
  };
  try {
    await paper.view(scope);
  } catch (error) {
    if (!(error instanceof PilotError) || error.code !== "NOT_FOUND") {
      throw error;
    }
    const wallet = await deps.wallets.findAgentWallet(check.productAgentId);
    const balance = wallet ? await deps.balances.read(wallet.address) : 0;
    if (!(balance >= PERPS_WALLET_MINIMUM_AUSD)) {
      await step(wallet ? `Its wallet holds ${ausd(balance)}` : "It has no wallet");
      return finish("blocked", UNFUNDED_TEXT, "WALLET_UNFUNDED");
    }
    await paper.initialize(scope, agent.version, decimal(balance));
    await step(`Opened its paper account · ${ausd(balance)}`);
  }

  // R5: Perpl for each instrument, then the web when its source is on.
  const session = await deps.market.open(agentScope, signal);
  const [reads, readMs] = await timed(async () => {
    const all: PerpsInstrumentRead[] = [];
    for (const symbol of instruments) {
      all.push(await session.read(symbol));
    }
    return all;
  });
  await step(`Read Perpl ${instruments.join(", ")} · ${seconds(readMs)}`, readMs);

  let web: Source[] = [];
  const sites = config.sources?.web ?? null;
  let webUsed = false;
  if (sites) {
    requireTool(config, "searchWeb");
    try {
      const [found, webMs] = await timed(() =>
        deps.web.search(
          sites,
          `${instruments.join(" ")} perpetual market news and risks in the last 24 hours`,
          signal,
        ),
      );
      addCost(found.costMicros);
      web = found.sources.slice(0, PERPS_CHECK_WEB_RESULTS);
      webUsed = true;
      await step(
        `Read the web · ${plural(web.length, "source", "sources")} · ${seconds(webMs)}`,
        webMs,
      );
    } catch (error) {
      // No search key on this host: the check goes on with Perpl alone and says so.
      if (!(error instanceof PilotError) || error.code !== "WEB_UNAVAILABLE") {
        throw error;
      }
      await step("Skipped the web · search is not set up here");
    }
  }
  inputs = { instruments, web: webUsed };

  // One model call (R4, R5).
  const before = await paper.view(scope);
  const state = perpsCheckState({
    now: now(),
    network: perpl.network,
    brief,
    reads,
    positions: before.account.positions.filter((p) => p.closedAt === null),
    web,
  });
  let answer;
  let modelMs;
  try {
    [answer, modelMs] = await timed(() => deps.model.decide(state, signal));
  } catch (error) {
    if (!(error instanceof PilotError) || signal.aborted) {
      throw error;
    }
    await step("Asked the model · it did not answer");
    return finish("failed", "MODEL FAILED", safeCode(error, "MODEL_FAILED"));
  }
  addCost(answer.costMicros);
  await step(`Asked the model · ${seconds(modelMs)}`, modelMs);

  // An instrument outside its markets is a valid answer: `decideOutcome` holds ("NOT ITS MARKET").
  const parsed = parseCheckDecision(answer.content ?? undefined);
  if (!parsed.ok) {
    await step("Its answer was not a valid perps-check-v1 decision");
    return finish("failed", "MODEL INVALID", "MODEL_INVALID");
  }
  // Only ids of sources it was given are kept: the feed never shows an invented citation.
  const given = new Set(state.sources.map((source) => source.id));
  decision = {
    ...parsed.decision,
    sources: parsed.decision.sources.filter((id) => given.has(id)),
  };
  const called = decision;
  await step(entryTrace(called, counts.entries));

  const figures = async () => {
    const view = await paper.view(scope);
    const at = now();
    const dayStart = utcDayStart(at);
    const board = await deps.marks(perpl.network, signal).catch(() => []);
    const free = productFreeEquity(
      view.account,
      view.attempts,
      markMap(board, perpl.network, reads),
    );
    return {
      view,
      open: view.account.positions.filter((p) => p.closedAt === null),
      freeEquity: free === null ? null : Number(free),
      newMarginToday: Number(await paper.newMarginSince(scope, dayStart)),
      realizedToday: realizedSince(view.movements, dayStart),
    };
  };
  type Figures = Awaited<ReturnType<typeof figures>>;
  // The fee reserve scales with the open's notional at the venue's taker fee (the service's too).
  const read = reads.find((r) => r.frame.snapshot.market.symbol === called.instrument);
  const takerFee = Number(read?.frame.book.market.fees.taker ?? 0);
  const decide = (figs: Figures, position: PerpsPaperPosition | null): PerpsCheckResult => {
    const result = decideOutcome({
      decision: called,
      brief: counts,
      paused: agent.paused,
      markets: instruments,
      takerFee: Number.isFinite(takerFee) ? takerFee : 0,
      position: position
        ? { id: position.id, side: position.side, margin: Number(position.margin ?? 0) }
        : null,
      openCount: figs.open.length,
      risk: effectiveRisk(config),
      spend,
      maxLeverage: config.maxLeverage,
      entry: effectiveEntry(config),
      newMarginToday: figs.newMarginToday,
      realizedToday: figs.realizedToday,
      freeEquity: figs.freeEquity ?? 0,
    });
    if (result.code === "NO_FREE_AUSD" && figs.freeEquity === null) {
      return { ...result, text: `NO MARK · ${called.instrument}` };
    }
    return result;
  };
  const held = (figs: Figures) => figs.open.find((p) => p.symbol === called.instrument) ?? null;

  /** Closes one position; `closed: false` when its exit (or the owner) closed it first. */
  const close = async (position: PerpsPaperPosition) => {
    await fence();
    const frame = await session.frame(position.symbol);
    await fence();
    const result = await paper.closePosition(scope, position.id, "brief", frame);
    const label = `${position.side.toUpperCase()} ${position.symbol}`;
    if (!result.closed) {
      return { closed: false, text: `${label} was already closed (by its exit)` };
    }
    const pnl = result.view.movements
      .filter((m) => m.key.startsWith(`close:${position.id}:`))
      .reduce((sum, m) => sum + Number(m.delta), 0);
    return {
      closed: true,
      text: `Closed ${label} at ${result.position.exitPrice} · ${signedAusd(pnl)}`,
    };
  };

  let figs = await figures();
  let closed = false;

  // Brief exit lines are hard lines for every position the model reported on, not only the
  // decision's instrument: each other held position with a met line closes as its own row.
  for (const position of figs.open) {
    const met =
      position.symbol === called.instrument ? [] : exitsMet(called, counts.exits, position.symbol);
    if (!met.length) {
      continue;
    }
    const { closed: done, text } = await close(position);
    await step(text);
    if (!done) {
      continue;
    }
    closed = true;
    await store.recordCheck({
      productAgentId: check.productAgentId,
      trigger: "system",
      outcome: "exited",
      outcomeText: line(
        `EXIT ${met.join(", ")} MET · ${position.side.toUpperCase()} ${position.symbol}`,
      ),
      decision: called,
      inputs,
      configVersion: agent.version,
      steps: [{ text: line(text) }],
    });
  }
  if (closed) {
    figs = await figures();
  }
  let result = decide(figs, held(figs));

  // An opposite call (R7) in two phases: the close is its own `exited` row, then decide again.
  if (result.close && result.outcome !== "exited") {
    const position = held(figs)!;
    const { closed: done, text } = await close(position);
    await step(text);
    if (done) {
      closed = true;
      await store.recordCheck({
        productAgentId: check.productAgentId,
        trigger: "system",
        outcome: "exited",
        outcomeText: line(`CLOSED ${position.side.toUpperCase()} ${position.symbol} · REVERSING`),
        decision: called,
        inputs,
        configVersion: agent.version,
        steps: [{ text: line(text) }],
      });
    }
    figs = await figures();
    result = decide(figs, null);
  }

  if (result.outcome === "exited" && result.close) {
    const { closed: done, text } = await close(held(figs)!);
    await step(text);
    if (!done) {
      // Its exit closed it first: this check made no close of its own.
      await step("Nothing left to close");
      return finish("held", `ALREADY CLOSED · ${called.instrument}`);
    }
    closed = true;
  }

  if (result.outcome === "entered" && result.side && result.margin && result.leverage) {
    const side = result.side;
    const key = `check:${check.id}:open`;
    await fence();
    const frame = await session.frame(called.instrument);
    await fence();
    const service = createPerpsPaperService(
      paper,
      {
        observation: async () => {
          throw new PilotError("INVALID_INPUT", "Checks observe nothing");
        },
        frame: async () => frame,
      },
      now,
    );
    const view: PerpsPaperView = await service.trade(
      scope,
      key,
      "open",
      called.instrument,
      side,
      signal,
      frame,
      {
        notional: decimal(result.notional!),
        leverage: result.leverage,
        checkId: check.id,
        exits: (fill) =>
          exitLevels({
            side,
            entryPrice: fill.price,
            stopLossBps: called.stopLossBps,
            takeProfitBps: called.takeProfitBps,
            horizonHours: called.horizonHours,
            openedAt: now(),
            // The stop's loss stays within 90% of margin at this leverage (inside liquidation).
            leverage: result.leverage,
          }),
      },
    );
    const opened = view.account.positions.find((p) => p.id === key);
    if (!opened) {
      const reason = view.attempts.find((a) => a.key === key)?.reason ?? "REJECTED";
      await step(`The paper account refused · ${reason}`);
      return finish("blocked", `BLOCKED · ${reason.split(",")[0]}`, "PAPER_REJECTED");
    }
    await step(
      `Opened ${side.toUpperCase()} ${called.instrument} at ${opened.entryPrice} · ${ausd(Number(opened.margin))} × ${opened.leverage}`,
    );
    for (const proposal of result.proposals ?? []) {
      await store.createProposal(holder.lease, {
        instrument: proposal.instrument,
        side: proposal.side,
        margin: decimal(proposal.margin),
        leverage: proposal.leverage,
        kind: proposal.kind,
        positionId: opened.id,
      });
      await step(`Proposed a size-up of ${ausd(proposal.margin)} · waits 15 min`);
    }
  }

  if (result.outcome === "proposed") {
    for (const proposal of result.proposals ?? []) {
      await store.createProposal(holder.lease, {
        instrument: proposal.instrument,
        side: proposal.side,
        margin: decimal(proposal.margin),
        leverage: proposal.leverage,
        kind: proposal.kind,
      });
      await step(
        `Proposed ${proposal.side.toUpperCase()} ${proposal.instrument} · ${ausd(proposal.margin)} × ${proposal.leverage} · waits 15 min`,
      );
    }
  }

  // R11: a close that crosses the day-loss stop pauses the agent.
  if (closed && !agent.paused) {
    const after = await figures();
    if (dayLossReached(after.realizedToday, effectiveRisk(config))) {
      // Idempotent: an exit that paused it first leaves one pause and one row.
      if (await store.pauseAgent(check.productAgentId, DAY_LOSS_TEXT)) {
        await step(DAY_LOSS_TEXT);
      }
    }
  }

  await step(result.text);
  return finish(result.outcome, result.text);
}

/** Frame of a book and a snapshot read in that order (the ticker last), hashed like advice's. */
export function perpsFrame(snapshot: PerpsPaperFrame["snapshot"], book: PerpsPaperFrame["book"]) {
  return {
    snapshot,
    book,
    hash: createHash("sha256").update(JSON.stringify({ snapshot, book })).digest("hex"),
  };
}
