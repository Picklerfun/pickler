import * as dto from "@pickler/api-schema";
import {
  PERPS_MANUAL_CHECKS_PER_DAY,
  perpsCheckDetailSchema,
  perpsChecksResponseSchema,
  perpsPositionsResponseSchema,
  perpsProposalsResponseSchema,
  perpsRecordSchema,
  type PerpsCheckSummaryDto,
} from "@pickler/api-schema";
import {
  PilotError,
  type createStudioAccess,
  type AgentRecord,
  type PerpNetwork,
  type Principal,
  type ResearchRepository,
  type Scope,
  type StudioAccess,
  type StudioDirectory,
} from "@pickler/core";
import {
  CHECK_OUTCOMES,
  PRODUCT_PAPER_SESSION,
  liquidationPrice,
  notionalFor,
  paperDecimal,
  paperUnits,
  PAPER_SCALE,
  parseCheckDecision,
  proposalExpired,
  recordStats,
  realizedSince,
  utcDayStart,
  type PerpsCheck,
  type PerpsCheckOutcome,
  type PerpsPaperMark,
  type PerpsPaperPosition,
  type PerpsPaperScope,
  type PerpsPaperView,
  type PerpsProductPaperRepository,
  type PerpsProposal,
  type PerpsRuntimeRepository,
} from "@pickler/trading/perps";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { operation as describeOperation } from "../openapi/operation";

/** The Queue messages the API sends the research worker (perpl-paper-runtime-v1 §4, R8, R12). */
export type PerpsQueueMessage =
  | { kind: "perps-check"; checkId: string }
  | { kind: "perps-proposal"; proposalId: string; decision: "approve" }
  | {
      kind: "perps-close";
      positionId: string | null;
      productAgentId: string;
      reason: "owner" | "stop_all";
    };

/**
 * The Perpl paper runtime as the studio reads and drives it. Actions that need a Perpl frame or
 * touch paper positions (approve, close, stop) run in the research worker; these routes check
 * ownership and state, then queue them.
 */
export interface StudioPerpsServices {
  /** `PERPL_RUNTIME_ENABLED` on the API is "true". */
  enabled: boolean;
  store: Pick<
    PerpsRuntimeRepository,
    | "startCheck"
    | "getCheck"
    | "listChecks"
    | "getProposal"
    | "listProposals"
    | "decideProposal"
    | "recordCheck"
    | "checksToday"
    | "manualChecksToday"
    | "costToday"
  >;
  owner: {
    findPosition(
      positionId: string,
    ): Promise<{ productAgentId: string; scope: PerpsPaperScope } | null>;
    counts(productAgentId: string): Promise<{ checks: number; entries: number }>;
  };
  paper: Pick<PerpsProductPaperRepository, "view" | "newMarginSince">;
  /** Fresh BTC/ETH marks from the market board; empty when it cannot answer freshly. */
  marks(network: PerpNetwork): Promise<PerpsPaperMark[]>;
  send(message: PerpsQueueMessage): Promise<void>;
  clock?: () => number;
}

interface Context {
  perps: () => StudioPerpsServices;
  access: Pick<ReturnType<typeof createStudioAccess>, "authorize">;
  directory: Pick<StudioDirectory, "agentScope">;
  repository: Pick<ResearchRepository, "agent" | "pause">;
}

const iso = (at: number) => new Date(at).toISOString();
const isoOrNull = (at: number | null | undefined) =>
  at === null || at === undefined ? null : iso(at);

const routeDescription =
  "User JWT required. Reads are open to the workspace's members; writes are the owner's. Another workspace's agent, check, position or proposal is 404 NOT_FOUND.";
const errors = {
  security: "user" as const,
  errors: dto.studioErrorSchema,
  errorStatuses: [400, 401, 403, 404, 409, 429, 500, 503],
};

function summary(check: PerpsCheck): PerpsCheckSummaryDto {
  const parsed = check.decision ? parseCheckDecision(check.decision) : null;
  const decision = parsed?.ok ? parsed.decision : null;
  return {
    id: check.id,
    at: iso(check.createdAt),
    trigger: check.trigger,
    status: check.status,
    outcome: check.outcome,
    outcomeText: check.outcomeText,
    instrument: decision?.instrument ?? null,
    action: decision?.action ?? null,
    probability: decision?.probability ?? null,
    horizonHours: decision?.horizonHours ?? null,
    entries: decision?.entries ?? [],
    exits: decision?.exits ?? [],
    never: decision?.never ?? [],
    rationale: decision?.rationale ?? null,
    inputs: check.inputs,
    configVersion: check.configVersion,
    costMicros: check.costMicros,
    error: check.error,
  };
}

function marksFor(marks: PerpsPaperMark[], network: PerpNetwork) {
  const map: Partial<Record<string, string>> = {};
  for (const mark of marks) {
    if (mark.network === network) {
      map[mark.symbol] = mark.mark;
    }
  }
  return map;
}

function marginOf(p: PerpsPaperPosition) {
  return p.margin ?? p.entryNotional;
}

/** Signed open P&L in paper units at `mark`. */
function unrealizedUnits(p: PerpsPaperPosition, mark: string) {
  const sign = p.side === "long" ? 1n : -1n;
  return (
    (((paperUnits(mark) - paperUnits(p.entryPrice)) * paperUnits(p.quantity)) / PAPER_SCALE) * sign
  );
}

/** Trading's liquidation estimate (loss equals margin: entry × (1 ∓ 1 / leverage)). */
function liquidationEstimate(p: PerpsPaperPosition) {
  const price = liquidationPrice(p.side, p.entryPrice, p.leverage ?? 1);
  return paperUnits(price) > 0n ? price : null;
}

function closedPnl(view: PerpsPaperView, positionId: string) {
  let total = 0n;
  for (const movement of view.movements) {
    if (movement.key.startsWith(`close:${positionId}:`)) {
      total += paperUnits(movement.delta);
    }
  }
  return total;
}

function proposalDto(p: PerpsProposal) {
  return {
    id: p.id,
    checkId: p.checkId,
    kind: p.kind,
    instrument: p.instrument,
    side: p.side,
    margin: p.margin,
    leverage: p.leverage,
    notional: String(notionalFor(Number(p.margin), p.leverage)),
    createdAt: iso(p.createdAt),
    expiresAt: iso(p.expiresAt),
    positionId: p.positionId,
  };
}

/** `/v1/studio` routes of the Perpl paper runtime (docs/specs/perpl-paper-runtime-v1.md §4). */
export function studioPerpsRoutes(context: Context) {
  const api = new Hono<AppEnv>();
  const { access, directory, repository } = context;

  const authorize = (c: { get(key: "principal"): Principal }, manage = false) =>
    access.authorize(c.get("principal"), manage);

  /** The agent's runtime record, refused unless it trades on Perpl. */
  async function perplAgent(scope: Scope): Promise<AgentRecord & { network: PerpNetwork }> {
    const record = await repository.agent(scope);
    const network = record.config.perpl?.network;
    if (!network) {
      throw new PilotError("NOT_A_PERPL_AGENT", "This agent does not trade on Perpl");
    }
    return { ...record, network };
  }

  const paperScope = (scope: Scope, network: PerpNetwork): PerpsPaperScope => ({
    ...scope,
    sessionId: PRODUCT_PAPER_SESSION,
    network,
  });

  /** The agent's paper account, or null before its first check opened one. */
  async function paperView(services: StudioPerpsServices, scope: PerpsPaperScope) {
    try {
      return await services.paper.view(scope);
    } catch (error) {
      if (error instanceof PilotError && error.code === "NOT_FOUND") {
        return null;
      }
      throw error;
    }
  }

  // "Run it on paper": a manual check, queued for the research worker (R2, at most 6 a day).
  api.post(
    "/agents/:id/perps/checks",
    describeOperation("studioPerpsCheckCreate", {
      ...errors,
      description: `${routeDescription} Queues a manual check (202 { checkId }); poll GET /perps/checks/{id}. 409 NOT_A_PERPL_AGENT, RUNTIME_DISABLED (PERPL_RUNTIME_ENABLED is off), CHECK_RUNNING; 429 MANUAL_LIMIT after ${PERPS_MANUAL_CHECKS_PER_DAY} manual checks a UTC day.`,
      response: dto.perpsCheckStartedSchema,
      status: 202,
      idempotent: true,
    }),
    async (c) => {
      const services = context.perps();
      const current = await authorize(c, true);
      const productId = c.req.param("id");
      const scope = await directory.agentScope(current, productId);
      await perplAgent(scope);
      if (!services.enabled) {
        throw new PilotError("RUNTIME_DISABLED", "The Perpl runtime is not open yet");
      }
      const requestKey = dto.idempotencyKeySchema.parse(c.req.header("Idempotency-Key"));
      if ((await services.store.manualChecksToday(productId)) >= PERPS_MANUAL_CHECKS_PER_DAY) {
        throw new PilotError(
          "MANUAL_LIMIT",
          `At most ${PERPS_MANUAL_CHECKS_PER_DAY} manual checks a day`,
        );
      }
      const check = await services.store.startCheck({
        productAgentId: productId,
        trigger: "manual",
        requestKey,
      });
      if (check.status === "queued") {
        try {
          await services.send({ kind: "perps-check", checkId: check.id });
        } catch {
          console.error("Perpl check notification failed; the queued check expires");
        }
      }
      return c.json({ checkId: check.id }, 202);
    },
  );

  api.get(
    "/agents/:id/perps/checks",
    describeOperation("studioPerpsChecks", {
      ...errors,
      description: `${routeDescription} The Decisions feed, newest first, 50 a page; \`before\` is the previous page's nextCursor, \`kind\` a comma-separated list of outcomes.`,
      response: perpsChecksResponseSchema,
      query: {
        before: { description: "nextCursor of the previous page" },
        kind: { description: `Outcomes, comma-separated: ${CHECK_OUTCOMES.join(", ")}` },
      },
    }),
    async (c) => {
      const services = context.perps();
      const current = await authorize(c);
      const productId = c.req.param("id");
      await directory.agentScope(current, productId);
      const kind = c.req.query("kind");
      const outcomes = kind
        ? z.array(z.enum(CHECK_OUTCOMES)).parse(kind.split(",").map((value) => value.trim()))
        : undefined;
      const page = await services.store.listChecks(productId, {
        before: c.req.query("before") ?? null,
        ...(outcomes ? { outcomes: outcomes as PerpsCheckOutcome[] } : {}),
      });
      return c.json(
        perpsChecksResponseSchema.parse({
          checks: page.items.map(summary),
          nextCursor: page.nextCursor,
        }),
      );
    },
  );

  api.get(
    "/perps/checks/:id",
    describeOperation("studioPerpsCheck", {
      ...errors,
      description: `${routeDescription} One check with its timed steps, for "What it did" while it runs.`,
      response: perpsCheckDetailSchema,
    }),
    async (c) => {
      const services = context.perps();
      const current = await authorize(c);
      const check = await services.store.getCheck(c.req.param("id"));
      if (!check) {
        throw new PilotError("NOT_FOUND", "Check not found");
      }
      await directory.agentScope(current, check.productAgentId);
      return c.json(
        perpsCheckDetailSchema.parse({
          ...summary(check),
          startedAt: isoOrNull(check.startedAt),
          finishedAt: isoOrNull(check.finishedAt),
          steps: check.steps.map((step) => ({ at: iso(step.at), text: step.text, ms: step.ms })),
        }),
      );
    },
  );

  api.get(
    "/agents/:id/perps/positions",
    describeOperation("studioPerpsPositions", {
      ...errors,
      description: `${routeDescription} Open paper positions marked to the market board (mark and P&L null while unknown) with stop, target, time stop and a liquidation estimate; closed ones newest first, at most 50.`,
      response: perpsPositionsResponseSchema,
    }),
    async (c) => {
      const services = context.perps();
      const current = await authorize(c);
      const scope = await directory.agentScope(current, c.req.param("id"));
      const agent = await perplAgent(scope);
      const view = await paperView(services, paperScope(scope, agent.network));
      const positions = view?.account.positions ?? [];
      const open = positions.filter((p) => p.closedAt === null);
      const marks = open.length
        ? marksFor(await services.marks(agent.network).catch(() => []), agent.network)
        : {};
      return c.json(
        perpsPositionsResponseSchema.parse({
          network: agent.network,
          account: view !== null,
          open: open.map((p) => {
            const mark = marks[p.symbol] ?? null;
            return {
              id: p.id,
              instrument: p.symbol,
              side: p.side,
              quantity: p.quantity,
              entryPrice: p.entryPrice,
              notional: p.entryNotional,
              margin: marginOf(p),
              leverage: p.leverage ?? 1,
              openedAt: iso(p.openedAt),
              mark,
              unrealizedPnl: mark === null ? null : paperDecimal(unrealizedUnits(p, mark)),
              stopPrice: p.stopPrice ?? null,
              takeProfitPrice: p.takeProfitPrice ?? null,
              exitDueAt: isoOrNull(p.exitDueAt),
              liquidationEstimate: liquidationEstimate(p),
              checkId: p.checkId ?? null,
              configVersion: p.configVersion ?? null,
            };
          }),
          closed: positions
            .filter((p) => p.closedAt !== null)
            .sort((a, b) => b.closedAt! - a.closedAt! || b.id.localeCompare(a.id))
            .slice(0, 50)
            .map((p) => ({
              id: p.id,
              instrument: p.symbol,
              side: p.side,
              entryPrice: p.entryPrice,
              exitPrice: p.exitPrice,
              margin: marginOf(p),
              leverage: p.leverage ?? 1,
              openedAt: iso(p.openedAt),
              closedAt: iso(p.closedAt!),
              closeReason: p.closeReason ?? null,
              realizedPnl: paperDecimal(closedPnl(view!, p.id)),
            })),
        }),
      );
    },
  );

  // "Close now" (R12): one paper position, closed by the research worker at a fresh frame.
  api.post(
    "/perps/positions/:id/close",
    describeOperation("studioPerpsPositionClose", {
      ...errors,
      description: `${routeDescription} Queues the close of one open paper position (202 { queued: true }); the Decisions feed and positions show it. 409 POSITION_CLOSED.`,
      response: dto.perpsQueuedSchema,
      status: 202,
    }),
    async (c) => {
      const services = context.perps();
      const current = await authorize(c, true);
      const positionId = c.req.param("id");
      const found = await services.owner.findPosition(positionId);
      if (!found) {
        throw new PilotError("NOT_FOUND", "Position not found");
      }
      const scope = await directory.agentScope(current, found.productAgentId);
      if (scope.tenantId !== found.scope.tenantId || scope.agentId !== found.scope.agentId) {
        throw new PilotError("NOT_FOUND", "Position not found");
      }
      const view = await services.paper.view(found.scope);
      const position = view.account.positions.find((p) => p.id === positionId);
      if (!position || position.closedAt !== null) {
        throw new PilotError("POSITION_CLOSED", "The position is already closed");
      }
      await services.send({
        kind: "perps-close",
        positionId,
        productAgentId: found.productAgentId,
        reason: "owner",
      });
      return c.json({ queued: true as const }, 202);
    },
  );

  // "Stop · close all" (R12): pauses the agent now, then the worker closes every paper position.
  api.post(
    "/agents/:id/perps/stop",
    describeOperation("studioPerpsStop", {
      ...errors,
      description: `${routeDescription} Pauses the agent at once and queues the close of every open paper position (202 { queued: true }).`,
      response: dto.perpsQueuedSchema,
      status: 202,
    }),
    async (c) => {
      const services = context.perps();
      const current = await authorize(c, true);
      const productId = c.req.param("id");
      const scope = await directory.agentScope(current, productId);
      await perplAgent(scope);
      await repository.pause(scope, true);
      await services.send({
        kind: "perps-close",
        positionId: null,
        productAgentId: productId,
        reason: "stop_all",
      });
      return c.json({ queued: true as const }, 202);
    },
  );

  api.get(
    "/agents/:id/perps/proposals",
    describeOperation("studioPerpsProposals", {
      ...errors,
      description: `${routeDescription} Pending approve-mode proposals ("Waiting on you"), each expiring 15 minutes after it was made.`,
      response: perpsProposalsResponseSchema,
    }),
    async (c) => {
      const services = context.perps();
      const current = await authorize(c);
      const productId = c.req.param("id");
      await directory.agentScope(current, productId);
      const proposals = await services.store.listProposals(productId);
      return c.json(perpsProposalsResponseSchema.parse({ proposals: proposals.map(proposalDto) }));
    },
  );

  /** A pending proposal of the caller's workspace; 409 when decided or past its 15 minutes. */
  async function pendingProposal(services: StudioPerpsServices, current: StudioAccess, id: string) {
    const proposal = await services.store.getProposal(id);
    if (!proposal) {
      throw new PilotError("NOT_FOUND", "Proposal not found");
    }
    await directory.agentScope(current, proposal.productAgentId);
    if (proposal.status !== "pending") {
      throw new PilotError("PROPOSAL_DECIDED", "This proposal was already decided");
    }
    if (proposalExpired(proposal, (services.clock ?? Date.now)())) {
      throw new PilotError("PROPOSAL_EXPIRED", "This proposal expired");
    }
    return proposal;
  }

  // Enter (R8): the worker opens at a fresh frame, re-checked against the caps; the web polls.
  api.post(
    "/perps/proposals/:id/approve",
    describeOperation("studioPerpsProposalApprove", {
      ...errors,
      description: `${routeDescription} Queues the approval (202 { queued: true }); the research worker opens or sizes up at a fresh frame re-checked against the caps, and the feed says entered or blocked with the cap. 409 PROPOSAL_DECIDED, PROPOSAL_EXPIRED, RUNTIME_DISABLED.`,
      response: dto.perpsQueuedSchema,
      status: 202,
    }),
    async (c) => {
      const services = context.perps();
      const current = await authorize(c, true);
      const proposal = await pendingProposal(services, current, c.req.param("id"));
      if (!services.enabled) {
        throw new PilotError("RUNTIME_DISABLED", "The Perpl runtime is not open yet");
      }
      await services.send({ kind: "perps-proposal", proposalId: proposal.id, decision: "approve" });
      return c.json({ queued: true as const }, 202);
    },
  );

  api.post(
    "/perps/proposals/:id/skip",
    describeOperation("studioPerpsProposalSkip", {
      ...errors,
      description: `${routeDescription} Skips the proposal now and logs it as skipped. 409 PROPOSAL_DECIDED, PROPOSAL_EXPIRED.`,
      response: dto.perpsProposalDecidedSchema,
    }),
    async (c) => {
      const services = context.perps();
      const current = await authorize(c, true);
      const proposal = await pendingProposal(services, current, c.req.param("id"));
      const decided = await services.store.decideProposal(proposal.id, "skipped");
      const kind = proposal.kind === "size_up" ? "SIZE-UP" : "ENTRY";
      await services.store.recordCheck({
        productAgentId: proposal.productAgentId,
        trigger: "owner",
        outcome: "skipped",
        outcomeText: `SKIPPED · ${kind} ${proposal.side.toUpperCase()} ${proposal.instrument}`,
        steps: [{ text: "You skipped it" }],
      });
      return c.json(
        dto.perpsProposalDecidedSchema.parse({ id: decided.id, status: decided.status }),
      );
    },
  );

  api.get(
    "/agents/:id/perps/record",
    describeOperation("studioPerpsRecord", {
      ...errors,
      description: `${routeDescription} The paper record (R13: realized and open P&L, hit rate, fees and funding, max drawdown, an equity series) and today's figures for the meters and Health, with runtimeEnabled.`,
      response: perpsRecordSchema,
    }),
    async (c) => {
      const services = context.perps();
      const current = await authorize(c);
      const productId = c.req.param("id");
      const scope = await directory.agentScope(current, productId);
      const agent = await perplAgent(scope);
      const now = (services.clock ?? Date.now)();
      const dayStart = utcDayStart(now);
      const pScope = paperScope(scope, agent.network);
      const view = await paperView(services, pScope);
      const positions = view?.account.positions ?? [];
      const open = positions.filter((p) => p.closedAt === null);
      const marks = open.length
        ? marksFor(await services.marks(agent.network).catch(() => []), agent.network)
        : {};
      let openPnl: bigint | null = 0n;
      for (const p of open) {
        const mark = marks[p.symbol];
        openPnl =
          mark === undefined || openPnl === null ? null : openPnl + unrealizedUnits(p, mark);
      }
      const [counts, checksToday, manualToday, costToday, newMargin] = await Promise.all([
        services.owner.counts(productId),
        services.store.checksToday(productId),
        services.store.manualChecksToday(productId),
        services.store.costToday(productId),
        view ? services.paper.newMarginSince(pScope, dayStart) : Promise.resolve("0"),
      ]);
      const stats = recordStats({
        movements: view?.movements ?? [],
        closed: view
          ? positions
              .filter((p) => p.closedAt !== null)
              .map((p) => ({
                closedAt: p.closedAt!,
                pnl: Number(paperDecimal(closedPnl(view, p.id))),
              }))
          : [],
        openPnl: openPnl === null ? null : Number(paperDecimal(openPnl)),
        checks: counts.checks,
        entries: counts.entries,
        now,
      });
      return c.json(
        perpsRecordSchema.parse({
          runtimeEnabled: services.enabled,
          network: agent.network,
          account: view !== null,
          realizedAusd: stats.realizedAusd,
          openPnlAusd: stats.openPnlAusd,
          feesAndFundingAusd: stats.feesAndFundingAusd,
          cashAusd: stats.cashAusd,
          equityAusd: stats.equityAusd,
          closedCount: stats.closedCount,
          wins: stats.wins,
          hitRate: stats.hitRate,
          maxDrawdownAusd: stats.maxDrawdownAusd,
          maxDrawdownPct: stats.maxDrawdownPct,
          checks: stats.checks,
          entries: stats.entries,
          series: stats.series.map((point) => ({ at: iso(point.at), equity: point.equity })),
          today: {
            newMarginAusd: Number(newMargin),
            realizedAusd: realizedSince(view?.movements ?? [], dayStart),
            openCount: open.length,
            leverageInUse: open.reduce((max, p) => Math.max(max, p.leverage ?? 1), 0),
            checks: checksToday,
            manualChecks: manualToday,
            manualLimit: PERPS_MANUAL_CHECKS_PER_DAY,
            costMicros: costToday,
          },
        }),
      );
    },
  );

  return api;
}
