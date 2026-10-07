import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  DEFAULT_BRIEF,
  DEFAULT_CONFIG,
  PilotError,
  STARTER_CAPS,
  buildUserPrincipal,
  prepareDraft,
  type AgentConfig,
  type AgentRecord,
  type ResearchRepository,
  type StudioDirectory,
} from "@pickler/core";
import {
  PERPS_CHECK_OUTCOMES,
  PERPS_CHECK_TRIGGERS,
  PERPS_CLOSE_REASONS,
  PERPS_OWNER_ACTION_KINDS,
  PERPS_OWNER_ACTION_STATUSES,
  perpsActionSchema,
  perpsCheckDetailSchema,
  perpsChecksResponseSchema,
  perpsPositionsResponseSchema,
  perpsProposalsResponseSchema,
  perpsRecordSchema,
} from "@pickler/api-schema";
import {
  CHECK_OUTCOMES,
  CLOSE_REASONS,
  PERPS_CHECK_TRIGGERS as TRADING_TRIGGERS,
  PERPS_OWNER_ACTION_KINDS as TRADING_ACTION_KINDS,
  PERPS_OWNER_ACTION_STATUSES as TRADING_ACTION_STATUSES,
} from "@pickler/trading/perps";
import type {
  PerpsCheck,
  PerpsCheckRecord,
  PerpsOwnerAction,
  PerpsPaperPosition,
  PerpsPaperView,
  PerpsProposal,
} from "@pickler/trading/perps";
import type { AppEnv } from "../src/env.js";
import { studioRoutes } from "../src/routes/studio.js";
import type { PerpsQueueMessage, StudioPerpsServices } from "../src/routes/studio-perps.js";

const PERPL = "33333333-3333-4333-8333-333333333333";
const LEGACY = "55555555-5555-4555-8555-555555555555";
/** Another workspace's agent: `agentScope` refuses it. */
const FOREIGN = "66666666-6666-4666-8666-666666666666";
const CHECK = "77777777-7777-4777-8777-777777777777";
const FOREIGN_CHECK = "88888888-8888-4888-8888-888888888888";
const PROPOSAL = "99999999-9999-4999-8999-999999999999";
const ACTION = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const FOREIGN_ACTION = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
const NOW = Date.UTC(2026, 9, 3, 12, 30);
const HOUR = 3_600_000;

const { config: perplConfig } = prepareDraft({
  markets: ["BTC", "ETH"],
  name: "Trader",
  handle: "trader",
  voice: "analyst",
  avatar: { accent: "lime", pattern: 0 },
  sources: { web: null },
  brief: DEFAULT_BRIEF,
  caps: STARTER_CAPS,
  walletId: "unused",
});

function check(overrides: Partial<PerpsCheck> = {}): PerpsCheck {
  return {
    id: CHECK,
    productAgentId: PERPL,
    tenantId: "trusted",
    agentId: "runtime-perpl",
    trigger: "manual",
    status: "finished",
    createdAt: NOW - 60_000,
    startedAt: NOW - 59_000,
    finishedAt: NOW - 58_000,
    configVersion: 3,
    inputs: { instruments: ["BTC", "ETH"], web: false },
    decision: {
      instrument: "BTC",
      action: "open-long",
      probability: 0.7,
      horizonHours: 24,
      entries: [{ index: 1, met: true, why: "Trend up" }],
      exits: [],
      never: [{ index: 1, broken: false }],
      rationale: "Momentum",
      sources: [],
    },
    outcome: "entered",
    outcomeText: "ENTERED LONG BTC",
    steps: [
      { at: NOW - 59_000, text: "Read the brief · 1 entry, 1 exit, 1 never", ms: null },
      { at: NOW - 58_500, text: "Asked the model · 1.2s", ms: 1200 },
    ],
    costMicros: "1500",
    error: null,
    ...overrides,
  };
}

function position(overrides: Partial<PerpsPaperPosition> = {}): PerpsPaperPosition {
  return {
    id: `check:${CHECK}:open`,
    symbol: "BTC",
    side: "long",
    quantity: "0.001",
    entryPrice: "60000",
    entryNotional: "60",
    openedAt: NOW - HOUR,
    entryBlock: 1,
    mark: null,
    markAt: null,
    closedAt: null,
    exitPrice: null,
    exitBlock: null,
    leverage: 3,
    margin: "20",
    checkId: CHECK,
    configVersion: 3,
    stopPrice: "58200",
    takeProfitPrice: "63600",
    exitDueAt: NOW + 23 * HOUR,
    closeReason: null,
    ...overrides,
  };
}

function view(positions: PerpsPaperPosition[], ethClosePnl = "-1.5"): PerpsPaperView {
  return {
    account: {
      scope: {
        tenantId: "trusted",
        agentId: "runtime-perpl",
        sessionId: "product",
        network: "testnet",
      },
      agentVersion: 1,
      policy: "conservative-1x-v1",
      createdAt: NOW - 2 * HOUR,
      cash: "198",
      peakEquity: "200",
      day: "2026-10-03",
      dayEquity: null,
      dailyBlocked: false,
      blocked: false,
      fundingPending: false,
      positions,
    },
    attempts: [
      {
        key: "check:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:size-up",
        intent: {
          kind: "open",
          symbol: "ETH",
          side: "short",
          notional: "15",
          feeReserve: "0.1",
          leverage: 3,
        },
        status: "filled",
        reserved: "0",
        createdAt: NOW - 90 * 60_000,
        finishedAt: NOW - 90 * 60_000,
        reason: "size_up",
        evidence: null,
      },
    ],
    movements: [
      { key: "initial", kind: "initial", delta: "200", at: NOW - 2 * HOUR, evidence: null },
      // The fees of eth-1's open and of its size-up, and of the BTC long still open.
      { key: "eth-1:fee", kind: "fee", delta: "-0.25", at: NOW - 2 * HOUR, evidence: null },
      {
        key: "check:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:size-up:fee",
        kind: "fee",
        delta: "-0.1",
        at: NOW - 90 * 60_000,
        evidence: null,
      },
      {
        key: `check:${CHECK}:open:fee`,
        kind: "fee",
        delta: "-0.2",
        at: NOW - HOUR,
        evidence: null,
      },
      {
        key: "close:eth-1:pnl",
        kind: "realized-pnl",
        delta: ethClosePnl,
        at: NOW - 30 * 60_000,
        evidence: null,
      },
      { key: "close:eth-1:fee", kind: "fee", delta: "-0.5", at: NOW - 30 * 60_000, evidence: null },
    ],
  };
}

function proposal(overrides: Partial<PerpsProposal> = {}): PerpsProposal {
  return {
    id: PROPOSAL,
    checkId: CHECK,
    productAgentId: PERPL,
    tenantId: "trusted",
    agentId: "runtime-perpl",
    instrument: "ETH",
    side: "short",
    margin: "10",
    leverage: 3,
    kind: "enter",
    status: "pending",
    createdAt: NOW - 60_000,
    expiresAt: NOW + 14 * 60_000,
    decidedAt: null,
    positionId: null,
    ...overrides,
  };
}

function app({
  enabled = true,
  readOnly = false,
  perps = true,
  manualToday = 0,
  startError = null as PilotError | null,
  account = true,
  proposals = [proposal()],
  actionError = null as PilotError | null,
  ethClosePnl = "-1.5",
}: {
  enabled?: boolean;
  readOnly?: boolean;
  perps?: boolean;
  manualToday?: number;
  startError?: PilotError | null;
  account?: boolean;
  proposals?: PerpsProposal[];
  actionError?: PilotError | null;
  /** The realized P&L movement of eth-1's close, before any fee. */
  ethClosePnl?: string;
} = {}) {
  const sent: PerpsQueueMessage[] = [];
  const actions: (Omit<PerpsOwnerAction, "id" | "createdAt" | "updatedAt"> & {
    requestKey: string;
  })[] = [];
  const stored = (id: string, productAgentId: string): PerpsOwnerAction => ({
    id,
    productAgentId,
    kind: "approve",
    positionId: null,
    proposalId: PROPOSAL,
    status: "done",
    attempts: 1,
    lastError: null,
    checkId: CHECK,
    createdAt: NOW - 5_000,
    updatedAt: NOW - 1_000,
  });
  const paused: { agentId: string; paused: boolean }[] = [];
  const started: unknown[] = [];
  const decided: { id: string; decision: string }[] = [];
  const recorded: PerpsCheckRecord[] = [];
  const configs = new Map<string, AgentConfig>([
    [PERPL, perplConfig],
    [LEGACY, DEFAULT_CONFIG],
  ]);
  const runtimeIds: Record<string, string> = {
    [PERPL]: "runtime-perpl",
    [LEGACY]: "runtime-legacy",
  };
  const record = (agentId: string): AgentRecord => {
    const id = Object.keys(runtimeIds).find((key) => runtimeIds[key] === agentId)!;
    return {
      id: agentId,
      tenantId: "trusted",
      version: 3,
      config: configs.get(id)!,
      paused: false,
      scheduleEnabled: false,
      nextDueAt: null,
    };
  };
  const positions = [
    position(),
    position({
      id: "check:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:open",
      symbol: "ETH",
      side: "short",
      entryPrice: "3000",
      quantity: "0.01",
      entryNotional: "30",
      margin: "10",
      openedAt: NOW - 2 * HOUR,
      closedAt: NOW - 30 * 60_000,
      exitPrice: "3150",
      closeReason: "stop",
    }),
  ];
  positions[1]!.id = "eth-1";
  const directory = {
    access: async () => ({
      workspaceId: "workspace",
      tenantId: "trusted",
      ownerUserId: readOnly ? "someone-else" : "user",
      role: readOnly ? "auditor" : "admin",
      enabled: true,
    }),
    agentScope: async (_access: unknown, id: string) => {
      if (!runtimeIds[id]) {
        throw new PilotError("NOT_FOUND", "Agent not found");
      }
      return { tenantId: "trusted", agentId: runtimeIds[id]! };
    },
  } as Partial<StudioDirectory> as StudioDirectory;
  const services: StudioPerpsServices = {
    enabled,
    clock: () => NOW,
    store: {
      startCheck: async (input) => {
        started.push(input);
        if (startError) {
          throw startError;
        }
        return check({ id: CHECK, status: "queued", outcome: null, outcomeText: null });
      },
      getCheck: async (id) =>
        id === CHECK ? check() : id === FOREIGN_CHECK ? check({ productAgentId: FOREIGN }) : null,
      listChecks: async (_id, options) => ({
        items: [check()].filter(
          (item) => !options?.outcomes || options.outcomes.includes(item.outcome!),
        ),
        nextCursor: null,
      }),
      getProposal: async (id) => proposals.find((p) => p.id === id) ?? null,
      listProposals: async () => proposals.filter((p) => p.status === "pending"),
      decideProposal: async (id, decision) => {
        decided.push({ id, decision });
        return { ...proposals.find((p) => p.id === id)!, status: decision };
      },
      recordCheck: async (input) => {
        recorded.push(input);
        return check();
      },
      checksToday: async () => 4,
      manualChecksToday: async () => manualToday,
      costToday: async () => "4500",
    },
    owner: {
      findPosition: async (id) =>
        positions.some((p) => p.id === id)
          ? {
              productAgentId: PERPL,
              scope: {
                tenantId: "trusted",
                agentId: "runtime-perpl",
                sessionId: "product",
                network: "testnet",
              },
            }
          : id === "foreign-position"
            ? {
                productAgentId: FOREIGN,
                scope: { tenantId: "x", agentId: "y", sessionId: "product", network: "testnet" },
              }
            : null,
      counts: async () => ({ checks: 9, entries: 2 }),
      createAction: async (input) => {
        if (actionError) {
          throw actionError;
        }
        actions.push({
          productAgentId: input.productAgentId,
          kind: input.kind,
          positionId: input.positionId ?? null,
          proposalId: input.proposalId ?? null,
          requestKey: input.requestKey,
          status: "pending",
          attempts: 0,
          lastError: null,
          checkId: null,
        });
        return { ...stored(ACTION, input.productAgentId), status: "pending", checkId: null };
      },
      getAction: async (id) =>
        id === ACTION
          ? stored(ACTION, PERPL)
          : id === FOREIGN_ACTION
            ? stored(FOREIGN_ACTION, FOREIGN)
            : null,
    },
    paper: {
      snapshot: async () => {
        if (!account) {
          throw new PilotError("NOT_FOUND", "Paper account not found");
        }
        return view(positions, ethClosePnl);
      },
    },
    marks: async () => [{ network: "testnet", symbol: "BTC", mark: "61000" }],
    send: async (message) => {
      sent.push(message);
    },
  };
  const studio = studioRoutes({
    directory,
    repository: {
      agent: async (scope: { agentId: string }) => record(scope.agentId),
      pause: async (scope: { agentId: string }, value: boolean) => {
        paused.push({ agentId: scope.agentId, paused: value });
      },
    } as unknown as ResearchRepository,
    notifyQueued: async () => {},
    wallets: { findAgentWallet: async () => null },
    balances: { read: async () => 0, forget: () => {} },
    ...(perps ? { perps: services } : {}),
    authenticate: async () => ({
      principal: buildUserPrincipal({
        user: { id: "user" },
        integrator: { id: "workspace" },
        memberRole: "admin",
      }),
      workspace: null,
    }),
  });
  const root = new Hono<AppEnv>();
  root.use("*", async (c, next) => {
    c.set("requestId", "request-1");
    await next();
  });
  root.route("/", studio);
  return { root, sent, paused, started, decided, recorded, actions };
}

const post = (headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { Authorization: "Bearer token", ...headers },
});
const get = () => ({ headers: { Authorization: "Bearer token" } });
const error = async (response: Response) => ((await response.json()) as { error: string }).error;

test("a manual check is queued with its idempotency key and sent to the research queue", async () => {
  const f = app();

  const response = await f.root.request(
    `/agents/${PERPL}/perps/checks`,
    post({ "Idempotency-Key": "run-1" }),
  );

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { checkId: CHECK });
  assert.deepEqual(f.started, [{ productAgentId: PERPL, trigger: "manual", requestKey: "run-1" }]);
  assert.deepEqual(f.sent, [{ kind: "perps-check", checkId: CHECK }]);
});

test("a manual check refuses each case with its code and queues nothing", async () => {
  const cases: [ReturnType<typeof app>, string, number, string][] = [
    [app(), LEGACY, 409, "NOT_A_PERPL_AGENT"],
    [app({ enabled: false }), PERPL, 409, "RUNTIME_DISABLED"],
    [
      app({ startError: new PilotError("CHECK_RUNNING", "A check is already running") }),
      PERPL,
      409,
      "CHECK_RUNNING",
    ],
    [app({ manualToday: 6 }), PERPL, 429, "MANUAL_LIMIT"],
    [app(), FOREIGN, 404, "NOT_FOUND"],
    [app({ perps: false }), PERPL, 503, "RUNTIME_UNAVAILABLE"],
  ];

  for (const [f, id, status, code] of cases) {
    const response = await f.root.request(
      `/agents/${id}/perps/checks`,
      post({ "Idempotency-Key": "run-1" }),
    );
    assert.equal(response.status, status, code);
    assert.equal(await error(response), code);
    assert.deepEqual(f.sent, []);
  }
});

test("writes are the owner's: a member is 403 on every action and nothing is queued", async () => {
  const f = app({ readOnly: true });
  const paths = [
    `/agents/${PERPL}/perps/checks`,
    `/perps/positions/check:${CHECK}:open/close`,
    `/agents/${PERPL}/perps/stop`,
    `/perps/proposals/${PROPOSAL}/approve`,
    `/perps/proposals/${PROPOSAL}/skip`,
  ];

  for (const path of paths) {
    const response = await f.root.request(path, post({ "Idempotency-Key": "k" }));
    assert.equal(response.status, 403, path);
  }
  assert.deepEqual(f.sent, []);
  assert.deepEqual(f.paused, []);
  assert.deepEqual(f.decided, []);
});

test("members read the feed, a check with its steps, positions, proposals and the record", async () => {
  const f = app({ readOnly: true });

  const feed = perpsChecksResponseSchema.parse(
    await (await f.root.request(`/agents/${PERPL}/perps/checks?kind=entered,held`, get())).json(),
  );
  const detail = perpsCheckDetailSchema.parse(
    await (await f.root.request(`/perps/checks/${CHECK}`, get())).json(),
  );

  assert.equal(feed.checks.length, 1);
  assert.deepEqual(
    {
      instrument: feed.checks[0]!.instrument,
      action: feed.checks[0]!.action,
      probability: feed.checks[0]!.probability,
      horizonHours: feed.checks[0]!.horizonHours,
      entries: feed.checks[0]!.entries,
      costMicros: feed.checks[0]!.costMicros,
      at: feed.checks[0]!.at,
    },
    {
      instrument: "BTC",
      action: "open-long",
      probability: 0.7,
      horizonHours: 24,
      entries: [{ index: 1, met: true, why: "Trend up" }],
      costMicros: "1500",
      at: new Date(NOW - 60_000).toISOString(),
    },
  );
  assert.deepEqual(
    detail.steps.map((s) => [s.text, s.ms]),
    [
      ["Read the brief · 1 entry, 1 exit, 1 never", null],
      ["Asked the model · 1.2s", 1200],
    ],
  );
  for (const path of [
    `/agents/${PERPL}/perps/positions`,
    `/agents/${PERPL}/perps/proposals`,
    `/agents/${PERPL}/perps/record`,
  ]) {
    assert.equal((await f.root.request(path, get())).status, 200, path);
  }
});

test("reads refuse another workspace's agent and check (404) and a bad outcome filter (400)", async () => {
  const f = app();

  const foreignFeed = await f.root.request(`/agents/${FOREIGN}/perps/checks`, get());
  const foreignCheck = await f.root.request(`/perps/checks/${FOREIGN_CHECK}`, get());
  const missing = await f.root.request("/perps/checks/00000000-0000-4000-8000-000000000000", get());
  const badKind = await f.root.request(`/agents/${PERPL}/perps/checks?kind=bought`, get());

  assert.equal(foreignFeed.status, 404);
  assert.equal(foreignCheck.status, 404);
  assert.equal(missing.status, 404);
  assert.equal(badKind.status, 400);
});

test("positions mark open ones to the board, with P&L, exits and a liquidation estimate", async () => {
  const f = app();

  const body = perpsPositionsResponseSchema.parse(
    await (await f.root.request(`/agents/${PERPL}/perps/positions`, get())).json(),
  );

  assert.equal(body.account, true);
  assert.equal(body.network, "testnet");
  assert.deepEqual(body.open[0], {
    id: `check:${CHECK}:open`,
    instrument: "BTC",
    side: "long",
    quantity: "0.001",
    entryPrice: "60000",
    notional: "60",
    margin: "20",
    leverage: 3,
    openedAt: new Date(NOW - HOUR).toISOString(),
    mark: "61000",
    unrealizedPnl: "1",
    stopPrice: "58200",
    takeProfitPrice: "63600",
    exitDueAt: new Date(NOW + 23 * HOUR).toISOString(),
    liquidationEstimate: "40000",
    checkId: CHECK,
    configVersion: 3,
  });
  assert.deepEqual(
    body.closed.map((p) => [p.id, p.closeReason, p.realizedPnl]),
    // Net of every fee it paid: the close (-1.5 - 0.5), its open (-0.25) and its size-up (-0.1).
    [["eth-1", "stop", "-2.35"]],
  );
});

test("positions before the first check say there is no account yet", async () => {
  const f = app({ account: false });

  const body = perpsPositionsResponseSchema.parse(
    await (await f.root.request(`/agents/${PERPL}/perps/positions`, get())).json(),
  );

  assert.deepEqual(body, { network: "testnet", account: false, open: [], closed: [] });
});

test("close now writes the owner close and wakes the worker; a closed or unknown position is refused", async () => {
  const f = app();

  const queued = await f.root.request(
    `/perps/positions/check:${CHECK}:open/close`,
    post({ "Idempotency-Key": "close-1" }),
  );
  const closed = await f.root.request("/perps/positions/eth-1/close", post());
  const unknown = await f.root.request("/perps/positions/nope/close", post());
  const foreign = await f.root.request("/perps/positions/foreign-position/close", post());

  assert.equal(queued.status, 202);
  assert.deepEqual(await queued.json(), { actionId: ACTION });
  assert.equal(closed.status, 409);
  assert.equal(await error(closed), "POSITION_CLOSED");
  assert.equal(unknown.status, 404);
  assert.equal(foreign.status, 404);
  assert.deepEqual(
    f.actions.map((a) => [a.kind, a.positionId, a.productAgentId, a.requestKey]),
    [["close", `check:${CHECK}:open`, PERPL, "close-1"]],
  );
  assert.deepEqual(f.sent, [{ kind: "perps-action", actionId: ACTION }]);
});

test("stop · close all pauses the agent at once and writes the close of everything", async () => {
  const f = app({ enabled: false });

  const response = await f.root.request(`/agents/${PERPL}/perps/stop`, post());
  const legacy = await f.root.request(`/agents/${LEGACY}/perps/stop`, post());

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { actionId: ACTION });
  assert.deepEqual(f.paused, [{ agentId: "runtime-perpl", paused: true }]);
  assert.equal(legacy.status, 409);
  assert.equal(f.actions.length, 1);
  assert.equal(f.actions[0]!.kind, "stop_all");
  // Without an Idempotency-Key, each request is its own action.
  assert.match(f.actions[0]!.requestKey, /^auto:[0-9a-f-]{36}$/);
  assert.deepEqual(f.sent, [{ kind: "perps-action", actionId: ACTION }]);
});

test("proposals list the pending ones with notional and ISO times", async () => {
  const f = app();

  const body = perpsProposalsResponseSchema.parse(
    await (await f.root.request(`/agents/${PERPL}/perps/proposals`, get())).json(),
  );

  assert.deepEqual(body.proposals[0], {
    id: PROPOSAL,
    checkId: CHECK,
    kind: "enter",
    instrument: "ETH",
    side: "short",
    margin: "10",
    leverage: 3,
    notional: "30",
    createdAt: new Date(NOW - 60_000).toISOString(),
    expiresAt: new Date(NOW + 14 * 60_000).toISOString(),
    positionId: null,
  });
});

test("approve writes the approval for the worker and decides nothing itself", async () => {
  const f = app();

  const response = await f.root.request(`/perps/proposals/${PROPOSAL}/approve`, post());

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { actionId: ACTION });
  assert.deepEqual(
    f.actions.map((a) => [a.kind, a.proposalId]),
    [["approve", PROPOSAL]],
  );
  assert.deepEqual(f.sent, [{ kind: "perps-action", actionId: ACTION }]);
  assert.deepEqual(f.decided, []);
});

test("approve refuses a killed agent (409 AGENT_KILLED) and wakes nothing", async () => {
  const f = app({ actionError: new PilotError("AGENT_KILLED", "This agent was killed") });

  const response = await f.root.request(`/perps/proposals/${PROPOSAL}/approve`, post());

  assert.equal(response.status, 409);
  assert.equal(await error(response), "AGENT_KILLED");
  assert.deepEqual(f.sent, []);
});

test("an action's status is read by members; another workspace's is 404", async () => {
  const f = app({ readOnly: true });

  const mine = await f.root.request(`/perps/actions/${ACTION}`, get());
  const foreign = await f.root.request(`/perps/actions/${FOREIGN_ACTION}`, get());
  const missing = await f.root.request(
    "/perps/actions/00000000-0000-4000-8000-000000000000",
    get(),
  );

  assert.equal(mine.status, 200);
  assert.deepEqual(perpsActionSchema.parse(await mine.json()), {
    id: ACTION,
    kind: "approve",
    status: "done",
    positionId: null,
    proposalId: PROPOSAL,
    attempts: 1,
    lastError: null,
    checkId: CHECK,
    createdAt: new Date(NOW - 5_000).toISOString(),
    updatedAt: new Date(NOW - 1_000).toISOString(),
  });
  assert.equal(foreign.status, 404);
  assert.equal(missing.status, 404);
});

test("approve and skip refuse expired, decided, foreign and (approve) disabled proposals", async () => {
  const cases: [ReturnType<typeof app>, string, number, string][] = [
    [app({ proposals: [proposal({ expiresAt: NOW })] }), "approve", 409, "PROPOSAL_EXPIRED"],
    [app({ proposals: [proposal({ expiresAt: NOW })] }), "skip", 409, "PROPOSAL_EXPIRED"],
    [app({ proposals: [proposal({ status: "approved" })] }), "approve", 409, "PROPOSAL_DECIDED"],
    [app({ proposals: [proposal({ status: "approving" })] }), "skip", 409, "PROPOSAL_DECIDED"],
    [app({ proposals: [proposal({ productAgentId: FOREIGN })] }), "approve", 404, "NOT_FOUND"],
    [app({ proposals: [] }), "skip", 404, "NOT_FOUND"],
    [app({ enabled: false }), "approve", 409, "RUNTIME_DISABLED"],
  ];

  for (const [f, action, status, code] of cases) {
    const response = await f.root.request(`/perps/proposals/${PROPOSAL}/${action}`, post());
    assert.equal(response.status, status, `${action} ${code}`);
    assert.equal(await error(response), code);
    assert.deepEqual(f.sent, []);
    assert.deepEqual(f.decided, []);
  }
});

test("skip decides the proposal now and logs a skipped owner row", async () => {
  const f = app();

  const response = await f.root.request(`/perps/proposals/${PROPOSAL}/skip`, post());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: PROPOSAL, status: "skipped" });
  assert.deepEqual(f.decided, [{ id: PROPOSAL, decision: "skipped" }]);
  assert.deepEqual(f.recorded, [
    {
      productAgentId: PERPL,
      trigger: "owner",
      outcome: "skipped",
      outcomeText: "SKIPPED · ENTRY SHORT ETH",
      steps: [{ text: "You skipped it" }],
    },
  ]);
  assert.deepEqual(f.sent, []);
});

test("the record carries the ledger's stats, today's figures and whether the runtime is on", async () => {
  const f = app({ enabled: false });

  const body = perpsRecordSchema.parse(
    await (await f.root.request(`/agents/${PERPL}/perps/record`, get())).json(),
  );

  assert.equal(body.runtimeEnabled, false);
  assert.equal(body.account, true);
  assert.equal(body.realizedAusd, -2.55);
  assert.equal(body.feesAndFundingAusd, -1.05);
  assert.equal(body.openPnlAusd, 1);
  assert.equal(body.closedCount, 1);
  assert.equal(body.hitRate, 0);
  assert.equal(body.checks, 9);
  assert.equal(body.entries, 2);
  assert.ok(body.series.length > 0);
  // From the same read-only snapshot: both positions opened today (20 + 10 margin).
  assert.deepEqual(body.today, {
    newMarginAusd: 30,
    realizedAusd: -2.55,
    openCount: 1,
    leverageInUse: 3,
    checks: 4,
    manualChecks: 0,
    manualLimit: 6,
    costMicros: "4500",
  });
});

test("a close that made less than its open and size-up fees is a loss in the record and its hit rate", async () => {
  // eth-1's close made 0.6 before fees; its close (0.5), open (0.25) and size-up (0.1) fees took 0.85.
  const f = app({ ethClosePnl: "0.6" });

  const positions = perpsPositionsResponseSchema.parse(
    await (await f.root.request(`/agents/${PERPL}/perps/positions`, get())).json(),
  );
  const record = perpsRecordSchema.parse(
    await (await f.root.request(`/agents/${PERPL}/perps/record`, get())).json(),
  );

  assert.equal(positions.closed[0]!.realizedPnl, "-0.25");
  assert.equal(record.wins, 0);
  assert.equal(record.hitRate, 0);
});

test("the DTO vocabularies mirror trading's", () => {
  assert.deepEqual([...PERPS_CHECK_OUTCOMES], [...CHECK_OUTCOMES]);
  assert.deepEqual([...PERPS_CHECK_TRIGGERS], [...TRADING_TRIGGERS]);
  assert.deepEqual([...PERPS_CLOSE_REASONS], [...CLOSE_REASONS]);
  assert.deepEqual([...PERPS_OWNER_ACTION_KINDS], [...TRADING_ACTION_KINDS]);
  assert.deepEqual([...PERPS_OWNER_ACTION_STATUSES], [...TRADING_ACTION_STATUSES]);
});
