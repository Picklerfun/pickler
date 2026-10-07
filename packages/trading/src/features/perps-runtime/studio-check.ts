import {
  PilotError,
  assertConfig,
  effectiveEntry,
  effectiveRisk,
  effectiveStudioStrategy,
  requireTool,
  type AgentRecord,
  type PerpCandles,
  type PerpFundingHistory,
  type PerpSymbol,
  type Scope,
  type Source,
} from "@pickler/core";
import {
  executeStudioPerpsStrategy,
  type StudioPerpsContext,
  type StudioPerpsModels,
  type StudioPerpsProposal,
} from "../perps-strategies/studio.js";
import type { PerpsCallLane, PerpsModelHooks } from "../perps-strategies/types.js";
import type { PerpsCheck, PerpsCheckLease, PerpsRuntimeRepository } from "../perps-paper/checks.js";
import {
  PRODUCT_PAPER_SESSION,
  type PerpsProductPaperRepository,
  type PerpsPaperScope,
  type PerpsPaperView,
} from "../perps-paper/types.js";
import { validatePaperFrame, type PerpsPaperFrame } from "../perps-paper/simulation.js";
import { createPerpsPaperService } from "../perps-paper/service.js";
import { marginOpenedSince, productFreeEquity } from "../perps-paper/policy.js";
import { paperDecimal as d, paperUnits as u } from "../perps-paper/decimal.js";
import { exitLevels, exitDue, utcDayStart } from "./exits.js";
import { planStudioExecution, type StudioExecutionPlan } from "./studio-execution.js";
import type {
  StudioCallPlan,
  StudioCostPolicy,
  StudioCostRepository,
  StudioCostScope,
} from "./studio-costs.js";

export interface StudioInstrumentRead {
  frame: PerpsPaperFrame;
  candles: PerpCandles;
  sources: { id: string; name: string; url: string; observedAt: string }[];
}
export interface StudioPerpsDataSession {
  read(symbol: PerpSymbol): Promise<StudioInstrumentRead>;
  frame(symbol: PerpSymbol): Promise<PerpsPaperFrame>;
  funding(symbol: PerpSymbol, from: number, to: number): Promise<PerpFundingHistory>;
  remainingRequests?(): number;
}
export interface StudioPerpsCheckDependencies {
  store: PerpsRuntimeRepository;
  agents: { agent(scope: Scope): Promise<AgentRecord> };
  paper(
    scope: PerpsPaperScope,
    version: number,
    holder: { lease: PerpsCheckLease },
    signal: AbortSignal,
  ): PerpsProductPaperRepository;
  data(
    scope: Scope,
    signal: AbortSignal,
    positions?: readonly import("../perps-paper/types.js").PerpsPaperPosition[],
  ): Promise<StudioPerpsDataSession>;
  initialCash(productAgentId: string, signal: AbortSignal): Promise<string>;
  models: StudioPerpsModels;
  costs: StudioCostRepository;
  policy: StudioCostPolicy;
  callPlans: readonly StudioCallPlan[] | ((agent: AgentRecord) => readonly StudioCallPlan[]);
  requestLimit?: number;
  web(
    web: NonNullable<NonNullable<AgentRecord["config"]["sources"]>["web"]>,
    signal: AbortSignal,
    hooks: {
      before(key: string, request: { sha256: string; bytes: number }): Promise<void>;
      usage(key: string, costMicros: string | null): Promise<void>;
    },
    markets?: readonly PerpSymbol[],
  ): Promise<Source[]>;
  hash(document: unknown): string;
  now(): number;
}
export interface StudioCheckMarketResult {
  proposal: StudioPerpsProposal;
  execution: StudioExecutionPlan;
  positionId: string | null;
}
export interface StudioCheckDecision {
  protocol: "studio-perps-check-v2";
  strategy: { id: string; version: string };
  generatedAt: number;
  actions: StudioCheckMarketResult[];
  fundingPending: boolean;
  incomplete: boolean;
  mandatoryExits: { symbol: PerpSymbol; positionId: string; reason: string }[];
}
function validateRead(read: StudioInstrumentRead, scope: PerpsPaperScope, now: number) {
  const symbol = read.frame.snapshot.market.symbol;
  validatePaperFrame(read.frame, scope.network, symbol, now);
  const last = Math.floor(now / 3600000) * 3600000 - 3600000;
  if (
    read.candles.market.symbol !== symbol ||
    read.candles.market.marketId !== read.frame.snapshot.market.marketId ||
    read.candles.market.perpetualId !== read.frame.snapshot.market.perpetualId ||
    read.candles.market.instanceId !== read.frame.snapshot.market.instanceId ||
    read.candles.market.exchangeAddress !== read.frame.snapshot.market.exchangeAddress ||
    read.candles.market.priceDecimals !== read.frame.snapshot.market.priceDecimals ||
    read.candles.market.sizeDecimals !== read.frame.snapshot.market.sizeDecimals ||
    read.candles.market.collateral.address !== read.frame.snapshot.market.collateral.address ||
    read.candles.market.collateral.decimals !== read.frame.snapshot.market.collateral.decimals ||
    read.candles.market.provenance.network !== scope.network ||
    read.candles.resolution !== 3600 ||
    read.candles.missingOpenTimes.length ||
    read.candles.candles.length !== 60 ||
    read.candles.candles.some(
      (c, index) => !c.closed || c.openTime !== last - (59 - index) * 3600000,
    )
  ) {
    throw new PilotError(
      "DATA_UNAVAILABLE",
      "Studio needs sixty consecutive closed hourly candles",
    );
  }
}
/** Version 2.1 bounds projected web text in bytes, within the existing 4,000-character limit. */
function sourceText(text: string, version: string): string {
  const limited = text.slice(0, 4000);
  if (version !== "2.1.0") {
    return limited;
  }
  const encoder = new TextEncoder();
  let result = "";
  let bytes = 0;
  for (const character of limited) {
    bytes += encoder.encode(JSON.stringify(character)).length - 2;
    if (bytes > 4000) {
      break;
    }
    result += character;
  }
  return result;
}
/** Host-independent product coordination; strategy proposals never receive these dependencies. */
export async function runStudioPerpsCheck(
  deps: StudioPerpsCheckDependencies,
  check: PerpsCheck,
  holder: { lease: PerpsCheckLease },
  signal: AbortSignal,
): Promise<PerpsCheck> {
  const agentScope = { tenantId: check.tenantId, agentId: check.agentId };
  const agent = await deps.agents.agent(agentScope);
  assertConfig(agent.config);
  if (check.configVersion !== null && check.configVersion !== agent.version) {
    throw new PilotError("CONFIG_CHANGED", "Queued configuration is stale");
  }
  const config = agent.config;
  if (!config.perpl || !config.spend || !config.brief || !config.perpl.markets.length) {
    throw new PilotError("PLUGIN_NOT_CONFIGURED", "Perpl brief and creator caps are required");
  }
  const strategy = effectiveStudioStrategy(config);
  const scope: PerpsPaperScope = {
    ...agentScope,
    sessionId: PRODUCT_PAPER_SESSION,
    network: config.perpl.network,
  };
  const costScope = (): StudioCostScope => ({
    ...agentScope,
    checkId: check.id,
    configVersion: agent.version,
    lease: holder.lease,
  });
  const guard = async () => {
    signal.throwIfAborted();
    const current = await deps.agents.agent(agentScope);
    if (
      current.version !== agent.version ||
      JSON.stringify(current.config) !== JSON.stringify(config)
    ) {
      throw new PilotError("CONFIG_CHANGED", "Studio configuration changed during execution");
    }
    // Paused accounts still allow reducing actions; opening admission rechecks this later.
    holder.lease = await deps.store.renewAgent(holder.lease);
    signal.throwIfAborted();
    return current;
  };
  const required =
    strategy.id === "rules"
      ? []
      : strategy.id === "deepseek"
        ? ["direct"]
        : strategy.id === "jev"
          ? ["jev"]
          : ["fallback", "review"];
  const searchEnabled =
    strategy.id !== "rules" && config.sources?.web !== null && config.sources?.web !== undefined;
  const keys = [
    ...required,
    ...(searchEnabled
      ? ["search-1", ...(config.sources!.web!.mode === "prefer" ? ["search-2"] : [])]
      : []),
  ];
  const availablePlans =
    typeof deps.callPlans === "function" ? deps.callPlans(agent) : deps.callPlans;
  const plans = keys.map((key) => {
    const plan = availablePlans.find((p) => p.key === key);
    if (!plan) {
      throw new PilotError("COST_POLICY_INVALID", "Required reviewed call plan is missing");
    }
    return plan;
  });
  await guard();
  await deps.costs.reserve(costScope(), strategy, deps.policy, plans);
  const paper = deps.paper(scope, agent.version, holder, signal);
  const actions: StudioCheckMarketResult[] = [];
  const mandatoryExits: StudioCheckDecision["mandatoryExits"] = [];
  const netToday = (current: PerpsPaperView) =>
    current.movements
      .filter((movement) => movement.at >= utcDayStart(deps.now()) && movement.kind !== "initial")
      .reduce((sum, movement) => sum + u(movement.delta), 0n);
  let view: PerpsPaperView | null = null;
  let decision: StudioCheckDecision | null = null;
  let error: string | null = null;
  const step = (text: string) => deps.store.appendStep(holder.lease, { text });
  const record = (key: string, document: unknown) =>
    deps.costs.evidence(costScope(), key, deps.hash(document), document);
  let validatePaidEvidence = () => {};
  const calls = {
    async run<T>(
      lane: PerpsCallLane,
      operation: (hooks: PerpsModelHooks) => Promise<T>,
    ): Promise<T> {
      await guard();
      validatePaidEvidence();
      try {
        return await operation({
          before: async (request) => {
            await guard();
            validatePaidEvidence();
            await deps.costs.start(costScope(), lane, request);
            signal.throwIfAborted();
          },
          usage: async (input, output) => {
            await deps.costs.complete(costScope(), lane, { input, output });
          },
          diagnostic: async (value) => {
            await record(`diagnostic:${lane}`, value);
          },
        });
      } catch (failure) {
        await deps.costs.unknown(costScope(), lane);
        throw failure;
      }
    },
  };
  try {
    await step(`Strategy ${strategy.id}@${strategy.version}`);
    try {
      view = await paper.view(scope);
    } catch (failure) {
      if (!(failure instanceof PilotError) || failure.code !== "NOT_FOUND") {
        throw failure;
      }
      const cash = await deps.initialCash(check.productAgentId, signal);
      await guard();
      view = await paper.initialize(scope, agent.version, cash);
    }
    const heldSymbols = [...new Set(view.account.positions.map((p) => p.symbol))];
    const supervisedSymbols = [...new Set([...config.perpl.markets, ...heldSymbols])];
    if (
      deps.requestLimit !== undefined &&
      1 +
        5 * config.perpl.markets.length +
        2 * heldSymbols.length +
        4 *
          supervisedSymbols.filter(
            (symbol) => !config.perpl!.markets.some((market) => market === symbol),
          ).length >
        deps.requestLimit
    ) {
      throw new PilotError(
        "DATA_UNAVAILABLE",
        "The complete market set exceeds the existing public transport limit. Select fewer markets.",
      );
    }
    const session = await deps.data(agentScope, signal, view.account.positions);
    const reads: StudioInstrumentRead[] = [];
    for (const symbol of config.perpl.markets) {
      await guard();
      reads.push(await session.read(symbol));
    }
    for (const read of reads) {
      validateRead(read, scope, deps.now());
    }
    if (strategy.version === "2.1.0") {
      validatePaidEvidence = () => {
        for (const read of reads) {
          validateRead(read, scope, deps.now());
        }
      };
    }
    const heldFrames: PerpsPaperFrame[] = [];
    for (const symbol of heldSymbols.filter(
      (symbol) => !config.perpl!.markets.some((market) => market === symbol),
    )) {
      await guard();
      const frame = await session.frame(symbol);
      validatePaperFrame(frame, scope.network, symbol, deps.now(), true);
      heldFrames.push(frame);
    }
    const fundingRange = (current: PerpsPaperView, symbol: PerpSymbol, deadline = false) => {
      const positions = current.account.positions.filter((position) => position.symbol === symbol);
      const from = Math.min(...positions.map((position) => position.openedAt));
      // Historical Studio keeps its original ranges. Dynamic positions cease accruing at exit.
      const end =
        strategy.version === "2.1.0" && positions.every((position) => position.closedAt !== null)
          ? Math.max(...positions.map((position) => position.closedAt!))
          : deps.now() + (deadline ? 180000 : 0);
      return { from, end };
    };
    const reconcileFunding = async (current: PerpsPaperView) => {
      const funding: PerpFundingHistory[] = [];
      for (const symbol of new Set(current.account.positions.map((p) => p.symbol))) {
        await guard();
        const { from, end } = fundingRange(current, symbol);
        funding.push(await session.funding(symbol, from, end));
      }
      return funding;
    };
    const funding = await reconcileFunding(view);
    await guard();
    view = await paper.observe(scope, `check:${check.id}:funding`, {
      frames: [...reads.map((r) => r.frame), ...heldFrames],
      funding,
    });
    const enforceExits = async (frames: PerpsPaperFrame[]) => {
      const dayLoss = netToday(view!) <= -u(String(effectiveRisk(config).dayLossStopAusd));
      for (const position of view!.account.positions.filter((p) => p.closedAt === null)) {
        const frame = frames.find((frame) => frame.snapshot.market.symbol === position.symbol);
        if (!frame) {
          continue;
        }
        const reason = dayLoss
          ? "day_loss"
          : exitDue(
              {
                side: position.side,
                stopPrice: position.stopPrice ?? null,
                takeProfitPrice: position.takeProfitPrice ?? null,
                exitDueAt: position.exitDueAt ?? null,
                entryPrice: position.entryPrice,
                leverage: position.leverage,
              },
              frame.snapshot.ticker.mark,
              deps.now(),
            );
        if (reason) {
          await guard();
          validatePaperFrame(frame, scope.network, position.symbol, deps.now(), true);
          const closed = await paper.closePosition(scope, position.id, reason, frame);
          view = closed.view;
          if (closed.closed) {
            mandatoryExits.push({ symbol: position.symbol, positionId: position.id, reason });
          }
        }
      }
      if (dayLoss) {
        await deps.store.pauseAgent(check.productAgentId, "Paused itself · day-loss stop");
      }
    };
    await enforceExits([...reads.map((read) => read.frame), ...heldFrames]);
    const makeContext = (documents: Source[]): StudioPerpsContext => ({
      protocol: "studio-perps-strategy-v2",
      strategyVersion: strategy.version,
      markets: [...config.perpl!.markets],
      evidence: {
        observedAt: deps.now(),
        frames: reads.map((r) => r.frame),
        candles: reads.map((r) => r.candles),
        sourceIds: [
          ...reads.flatMap((r) => [
            ...r.sources.map((s) => s.id),
            `${r.frame.snapshot.market.symbol}:candles`,
          ]),
          ...documents.map((s) => s.id),
        ],
      },
      account: view!.account,
      brief: config.brief!,
      sources: config.sources ?? { web: null, books: [] },
      documents: documents.map((source) => ({
        id: source.id,
        text: sourceText(source.content, strategy.version),
      })),
    });
    if (strategy.version === "2.1.0" && session.remainingRequests) {
      const finalFundingPages = heldSymbols.reduce((sum, symbol) => {
        const market = [...reads.map((read) => read.frame), ...heldFrames].find(
          (frame) => frame.snapshot.market.symbol === symbol,
        )!.snapshot.market;
        const { from, end } = fundingRange(view!, symbol, true);
        const span = market.fundingIntervalSeconds * 1000 * 1023;
        // Reserve the existing three-minute execution deadline, including boundary crossings.
        return sum + Math.max(1, Math.ceil((end - from) / span));
      }, 0);
      const finalRequests = 2 * supervisedSymbols.length + finalFundingPages + 2;
      if (finalRequests > session.remainingRequests()) {
        throw new PilotError(
          "DATA_UNAVAILABLE",
          "Complete execution and funding would exceed the existing public transport limit",
        );
      }
    }
    if (strategy.version === "2.1.0" && strategy.id !== "rules") {
      const capabilities =
        strategy.id === "jev"
          ? ["decide" as const]
          : strategy.id === "deepseek"
            ? ["direct" as const]
            : ["direct" as const, "review" as const];
      // The adapter accepts at most ten sources; v2.1 projections are bounded to 4,000 UTF-8 bytes each.
      const maximumSources: Source[] = searchEnabled
        ? Array.from({ length: 10 }, (_, index) => ({
            id: `reserved-web-reference-${index}`,
            url: "https://example.com",
            title: "",
            content: "x".repeat(4000),
            truncated: true,
            retrievedAt: new Date(deps.now()).toISOString(),
            publishedAt: null,
            provider: "exa",
          }))
        : [];
      deps.models.preflight?.(makeContext(maximumSources), capabilities);
    }
    let documents: Source[] = [];
    if (searchEnabled) {
      requireTool(config, "searchWeb");
      documents = await deps.web(
        config.sources!.web!,
        signal,
        {
          before: async (key, request) => {
            await guard();
            validatePaidEvidence();
            await deps.costs.start(costScope(), key, request);
            signal.throwIfAborted();
          },
          usage: async (key, costMicros) => {
            if (costMicros === null) {
              await deps.costs.unknown(costScope(), key);
              throw new PilotError("COST_UNKNOWN", "Search cost is unknown");
            }
            await deps.costs.complete(costScope(), key, { costMicros });
          },
        },
        strategy.version === "2.1.0" ? config.perpl.markets : undefined,
      );
    }
    for (const read of reads) {
      validateRead(read, scope, deps.now());
    }
    const context = makeContext(documents);
    await record("decision-input", context);
    const proposals = await executeStudioPerpsStrategy(strategy, context, {
      models: deps.models,
      calls,
      signal,
    });
    await record("proposals", proposals);
    await guard();
    // Validate the complete refreshed package before the first strategy action.
    const executionFrames: PerpsPaperFrame[] = [];
    for (const symbol of supervisedSymbols) {
      executionFrames.push(await session.frame(symbol));
    }
    for (const frame of executionFrames) {
      validatePaperFrame(
        frame,
        scope.network,
        frame.snapshot.market.symbol,
        deps.now(),
        !config.perpl.markets.some((market) => market === frame.snapshot.market.symbol),
      );
    }
    await record("execution-input", executionFrames);
    await guard();
    const finalFunding = await reconcileFunding(await paper.view(scope));
    await guard();
    for (const frame of executionFrames) {
      validatePaperFrame(
        frame,
        scope.network,
        frame.snapshot.market.symbol,
        deps.now(),
        !config.perpl.markets.some((market) => market === frame.snapshot.market.symbol),
      );
    }
    view = await paper.observe(scope, `check:${check.id}:final-funding`, {
      frames: executionFrames,
      funding: finalFunding,
    });
    await enforceExits(executionFrames);
    if (mandatoryExits.length) {
      await record("mandatory-exits", mandatoryExits);
    }
    for (const proposal of proposals) {
      const current = await guard();
      view = await paper.view(scope);
      const frame = executionFrames.find(
        (value) => value.snapshot.market.symbol === proposal.symbol,
      )!;
      validatePaperFrame(frame, scope.network, proposal.symbol, deps.now());
      const open = view.account.positions.filter((p) => p.closedAt === null);
      const position = open.find((p) => p.symbol === proposal.symbol) ?? null;
      const realized = view.movements
        .filter((m) => m.at >= utcDayStart(deps.now()) && m.kind !== "initial")
        .reduce((sum, m) => sum + u(m.delta), 0n);
      const planned = planStudioExecution(proposal, {
        paused: current.paused,
        fundingPending: view.account.fundingPending,
        freeEquity: productFreeEquity(
          view.account,
          view.attempts,
          Object.fromEntries(
            executionFrames.map((f) => [f.snapshot.market.symbol, f.snapshot.ticker.mark]),
          ),
        ),
        openedMarginToday: marginOpenedSince(view.account.positions, utcDayStart(deps.now())),
        realizedToday: d(realized),
        openCount: open.length,
        position,
        takerFee: frame.book.market.fees.taker,
        spend: config.spend,
        risk: effectiveRisk(config),
        entry: effectiveEntry(config),
        leverage: config.maxLeverage ?? 1,
      });
      const execution: StudioExecutionPlan = mandatoryExits.some(
        (exit) => exit.symbol === proposal.symbol,
      )
        ? { kind: "hold", reason: "CLOSED_EARLIER_IN_CHECK" }
        : planned;
      const action: StudioCheckMarketResult = {
        proposal,
        execution,
        positionId: position?.id ?? null,
      };
      actions.push(action);
      if (execution.kind === "close") {
        await paper.closePosition(scope, execution.positionId, "brief", frame);
      } else if (execution.kind === "propose") {
        await deps.store.createProposal(holder.lease, {
          instrument: proposal.symbol,
          side: execution.side,
          margin: execution.margin,
          leverage: execution.leverage,
          kind: "enter",
        });
      } else if (execution.kind === "open") {
        const service = createPerpsPaperService(
          paper,
          {
            frame: async () => frame,
            observation: async () => {
              throw new PilotError("INVALID_INPUT", "Use explicit observations");
            },
          },
          deps.now,
        );
        const filled = await service.trade(
          scope,
          `check:${check.id}:open:${proposal.symbol}`,
          "open",
          proposal.symbol,
          execution.side,
          signal,
          frame,
          {
            notional: execution.notional,
            leverage: execution.leverage,
            checkId: check.id,
            exits: (fill) =>
              exitLevels({
                side: execution.side,
                entryPrice: fill.price,
                openedAt: deps.now(),
                horizonHours: 24,
                stopLossBps: 300,
                takeProfitBps: 600,
                leverage: execution.leverage,
              }),
          },
        );
        action.positionId =
          filled.account.positions.find((p) => p.symbol === proposal.symbol && p.closedAt === null)
            ?.id ?? null;
        if (!action.positionId) {
          throw new PilotError("EXECUTION_REJECTED", "No position was opened by the simulator");
        }
        if (execution.sizeUpMargin !== null) {
          const opened = filled.account.positions.find((p) => p.id === action.positionId)!;
          execution.sizeUpMargin = d(
            u(String(config.spend.perCallAusd)) - u(opened.margin ?? execution.margin),
          );
          await deps.store.createProposal(holder.lease, {
            instrument: proposal.symbol,
            side: execution.side,
            margin: execution.sizeUpMargin,
            leverage: execution.leverage,
            kind: "size_up",
            positionId: action.positionId,
          });
        }
      }
      await record(`execution:${proposal.symbol}`, action);
    }
    decision = {
      protocol: "studio-perps-check-v2",
      strategy,
      generatedAt: deps.now(),
      actions,
      fundingPending: view.account.fundingPending,
      incomplete: false,
      mandatoryExits,
    };
  } catch (failure) {
    if (
      signal.aborted ||
      (failure instanceof PilotError && ["LEASE_LOST", "CONFIG_CHANGED"].includes(failure.code))
    ) {
      throw failure;
    }
    error = failure instanceof PilotError ? failure.code : "CHECK_FAILED";
    decision = {
      protocol: "studio-perps-check-v2",
      strategy,
      generatedAt: deps.now(),
      actions,
      fundingPending: view?.account.fundingPending ?? true,
      incomplete: true,
      mandatoryExits,
    };
  }
  const cost = await deps.costs.finish(costScope());
  const outcome = error
    ? "failed"
    : actions.some((a) => a.execution.kind === "open")
      ? "entered"
      : mandatoryExits.length > 0 || actions.some((a) => a.execution.kind === "close")
        ? "exited"
        : actions.some((a) => a.execution.kind === "propose")
          ? "proposed"
          : actions.some(
                (a) =>
                  a.execution.kind === "hold" &&
                  [
                    "CAP_OPEN",
                    "CAP_DAY",
                    "DAY_LOSS",
                    "PAUSED",
                    "NO_FREE_AUSD",
                    "FUNDING_PENDING",
                    "UNKNOWN_MARKS",
                  ].includes(a.execution.reason),
              )
            ? "blocked"
            : "held";
  return deps.store.finishCheck(holder.lease, {
    outcome,
    outcomeText:
      error ??
      actions
        .map(
          (a) =>
            `${a.proposal.symbol}: ${a.execution.kind === "hold" || a.execution.kind === "close" ? a.execution.reason : a.execution.kind}`,
        )
        .join(" · "),
    decision,
    inputs: { instruments: [...config.perpl.markets], web: searchEnabled },
    configVersion: agent.version,
    costMicros: cost.costMicros,
    error,
  });
}
