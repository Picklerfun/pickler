import test from "node:test";
import assert from "node:assert/strict";
import {
  AuthenticationRequiredError,
  buildUserPrincipal,
  DEFAULT_CONFIG,
  LOCK_REASONS as CORE_LOCK_REASONS,
  PilotError,
  assertConfig,
  assertSpendLimits,
  type AgentConfig,
  type AgentRecord,
  type ScheduleReadiness,
  type SpendLimits,
  type StudioDirectory,
  type ResearchRepository,
} from "@pickler/core";
import { LOCK_REASONS } from "@pickler/api-schema";
import { studioRoutes } from "../src/routes/studio.js";

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";
const ADDRESS: Record<string, string> = {
  [FIRST]: "0x1111111111111111111111111111111111111111",
  [SECOND]: "0x2222222222222222222222222222222222222222",
};

const scopedConfig = (() => {
  const config = { ...DEFAULT_CONFIG };
  delete config.categoryIds;
  return {
    ...config,
    marketScope: {
      version: 1 as const,
      category: "sports",
      subcategories: ["american-football" as const],
    },
  };
})();

interface Options {
  agents?: string[];
  balances?: Record<string, number>;
  ready?: boolean;
  failRead?: boolean;
  /** Agents whose balance read fails while the others answer. */
  failReadFor?: string[];
  /** What the balance reader throws where the chain is not composed. */
  readError?: Error;
  signedIn?: boolean;
  /** Which of `agents` are private drafts. */
  drafts?: string[];
}

function fixture({
  agents: initial = [FIRST],
  balances = {},
  ready = true,
  failRead = false,
  failReadFor = [],
  readError,
  signedIn = true,
  drafts = [],
}: Options = {}) {
  const agents = initial;
  const scheduled: boolean[] = [];
  const reads: string[] = [];
  const updates: { expectedVersion: number; spend: unknown }[] = [];
  const spends: SpendLimits[] = [];
  const intervals: { hours: number; now: number }[] = [];
  const scope = (id: string) => ({ tenantId: "trusted", agentId: id });

  const directory: StudioDirectory = {
    onboard: async () => {},
    access: async () => ({
      workspaceId: "workspace",
      tenantId: "trusted",
      ownerUserId: "user",
      role: "admin",
      enabled: true,
    }),
    agentScope: async (_access, id) => {
      if (!agents.includes(id)) {
        throw new PilotError("NOT_FOUND", "Missing");
      }
      return scope(id);
    },
    list: async () =>
      agents.map((id) => ({
        id,
        name: `Agent ${id.slice(0, 1)}`,
        handle: `h${id.slice(0, 4)}`,
        accent: id === FIRST ? ("magenta" as const) : ("lime" as const),
        draft: drafts.includes(id),
        visibility: drafts.includes(id) ? ("private" as const) : ("public" as const),
        publishedAt: drafts.includes(id) ? null : new Date("2026-09-01T00:00:00Z"),
        xHandle: null,
        scope: scope(id),
      })),
    runs: async () => [],
  };

  const records = new Map<string, AgentRecord>();
  const record = (id: string): AgentRecord =>
    records.get(id) ?? {
      id,
      tenantId: "trusted",
      version: 1,
      config: scopedConfig,
      paused: false,
      scheduleEnabled: false,
      nextDueAt: null,
    };
  // Like the store: the manual run (when `ready`) happened at version 1, and readiness is per
  // configuration version, so any version bump clears it.
  const readinessOf = (id: string): ScheduleReadiness => {
    const current = ready && record(id).version === 1;
    return { connectionsChecked: current, manualSucceeded: current };
  };
  const repository = {
    agent: async (s: { agentId: string }) => record(s.agentId),
    readiness: async (s: { agentId: string }) => readinessOf(s.agentId),
    updateSpend: async (s: { agentId: string }, spend: SpendLimits) => {
      assertSpendLimits(spend);
      spends.push(spend);
      const current = record(s.agentId);
      const next = { ...current, config: { ...current.config, spend } };
      records.set(s.agentId, next);
      return next;
    },
    // Like the store: only `config.intervalHours`, no version bump.
    updateInterval: async (s: { agentId: string }, hours: number, now: number) => {
      intervals.push({ hours, now });
      const current = record(s.agentId);
      const next = { ...current, config: { ...current.config, intervalHours: hours } };
      records.set(s.agentId, next);
      return next;
    },
    updateConfig: async (s: { agentId: string }, expectedVersion: number, config: AgentConfig) => {
      const current = record(s.agentId);
      if (current.version !== expectedVersion) {
        throw new PilotError("CONFLICT", "Configuration version changed");
      }
      assertConfig(config);
      updates.push({ expectedVersion, spend: config.spend });
      const next = { ...current, config, version: current.version + 1 };
      records.set(s.agentId, next);
      return next;
    },
    schedule: async (s: { agentId: string }, enabled: boolean) => {
      if (enabled && !readinessOf(s.agentId).manualSucceeded) {
        throw new PilotError("NOT_READY", "Run once by hand");
      }
      scheduled.push(enabled);
    },
  } as unknown as ResearchRepository;

  const app = studioRoutes({
    directory,
    repository,
    notifyQueued: async () => {},
    wallets: {
      findAgentWallet: async (agentId) =>
        ADDRESS[agentId]
          ? { walletId: `wallet-${agentId.slice(0, 1)}`, address: ADDRESS[agentId]! }
          : null,
    },
    balances: {
      read: async (address) => {
        reads.push(address);
        if (readError) {
          throw readError;
        }
        if (failRead) {
          throw new Error("rpc down");
        }
        const id = Object.keys(ADDRESS).find((key) => ADDRESS[key] === address)!;
        if (failReadFor.includes(id)) {
          throw new Error("rpc down");
        }
        return balances[id] ?? 0;
      },
    },
    authenticate: async () => {
      if (!signedIn) {
        throw new AuthenticationRequiredError();
      }
      return {
        principal: buildUserPrincipal({
          user: { id: "user" },
          integrator: { id: "workspace" },
          memberRole: "admin",
        }),
        workspace: null,
      };
    },
  });
  return { app, scheduled, reads, updates, spends, intervals };
}

const put = (body: unknown) => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

test("the API's lock reasons are core's", () => {
  assert.deepEqual([...LOCK_REASONS], [...CORE_LOCK_REASONS]);
});

test("an agent holding 3 AUSD cannot run alone, and the schedule is refused as NOT_FUNDED", async () => {
  const { app, scheduled } = fixture({ balances: { [FIRST]: 3 } });

  const response = await app.request(`/agents/${FIRST}`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.wallet, {
    walletId: "wallet-1",
    address: ADDRESS[FIRST],
    balanceAusd: 3,
  });
  assert.deepEqual(body.canSchedule, { ok: false, reason: "unfunded" });
  assert.deepEqual(body.canCreateAnother, { ok: false, reason: "unfunded_agent" });
  assert.equal(body.productId, FIRST);

  const refused = await app.request(`/agents/${FIRST}/schedule`, put({ enabled: true }));

  assert.equal(refused.status, 409);
  assert.deepEqual(await refused.json(), {
    error: "NOT_FUNDED",
    message: "Fund its wallet · min. 10 AUSD",
  });
  assert.deepEqual(scheduled, []);
});

test("an agent with 10 AUSD and a successful manual run can be scheduled", async () => {
  const { app, scheduled } = fixture({ balances: { [FIRST]: 10 } });

  const body = await (await app.request(`/agents/${FIRST}`)).json();

  assert.deepEqual(body.canSchedule, { ok: true, reason: null });
  assert.deepEqual(body.canCreateAnother, { ok: true, reason: null });

  const accepted = await app.request(`/agents/${FIRST}/schedule`, put({ enabled: true }));

  assert.equal(accepted.status, 200);
  assert.deepEqual(scheduled, [true]);
});

test("the first run comes before funding; the schedule keeps answering NOT_READY", async () => {
  const { app, scheduled } = fixture({ balances: { [FIRST]: 3 }, ready: false });

  const body = await (await app.request(`/agents/${FIRST}`)).json();

  assert.deepEqual(body.canSchedule, { ok: false, reason: "first_run" });

  const refused = await app.request(`/agents/${FIRST}/schedule`, put({ enabled: true }));

  assert.equal(refused.status, 409);
  assert.deepEqual(await refused.json(), { error: "NOT_READY", message: "Run once by hand" });
  assert.deepEqual(scheduled, []);
});

test("turning the schedule off needs neither funds nor a balance read", async () => {
  const { app, scheduled, reads } = fixture({ failRead: true });

  const response = await app.request(`/agents/${FIRST}/schedule`, put({ enabled: false }));

  assert.equal(response.status, 200);
  assert.deepEqual(scheduled, [false]);
  assert.deepEqual(reads, []);
});

test("the list carries each agent's wallet and the same create lock", async () => {
  const { app } = fixture({ agents: [FIRST, SECOND], balances: { [FIRST]: 12, [SECOND]: 40 } });

  const { agents } = await (await app.request("/agents")).json();

  assert.equal(agents.length, 2);
  assert.deepEqual(
    agents.map((agent: { wallet: { balanceAusd: number } }) => agent.wallet.balanceAusd),
    [12, 40],
  );
  for (const agent of agents) {
    assert.deepEqual(agent.canCreateAnother, { ok: true, reason: null });
    assert.deepEqual(agent.canSchedule, { ok: true, reason: null });
  }
});

test("one agent's page reads its own balance; another agent's failed read does not fail it", async () => {
  const { app } = fixture({
    agents: [FIRST, SECOND],
    balances: { [FIRST]: 12 },
    failReadFor: [SECOND],
  });

  const response = await app.request(`/agents/${FIRST}`);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.wallet.balanceAusd, 12);
  // An unknown balance is not an unfunded agent; the create decides again with a real read.
  assert.deepEqual(body.canCreateAnother, { ok: true, reason: null });
});

test("one agent's page still says when another agent is known to be unfunded", async () => {
  const { app } = fixture({ agents: [FIRST, SECOND], balances: { [FIRST]: 12, [SECOND]: 3 } });

  const body = await (await app.request(`/agents/${FIRST}`)).json();

  assert.deepEqual(body.canCreateAnother, { ok: false, reason: "unfunded_agent" });
});

test("an agent's own failed balance read fails its page", async () => {
  const { app } = fixture({
    agents: [FIRST, SECOND],
    balances: { [SECOND]: 12 },
    failReadFor: [FIRST],
  });

  const response = await app.request(`/agents/${FIRST}`);

  assert.equal(response.status, 500);
});

test("the list still fails on any failed balance read", async () => {
  const { app } = fixture({ agents: [FIRST, SECOND], failReadFor: [SECOND] });

  const list = await app.request("/agents");

  assert.equal(list.status, 500);
});

test("balances that are not composed answer 503 BALANCES_UNAVAILABLE", async () => {
  const { app } = fixture({
    readError: new PilotError("BALANCES_UNAVAILABLE", "Balances are not available"),
  });

  const response = await app.request(`/agents/${FIRST}`);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "BALANCES_UNAVAILABLE",
    message: "Balances are not available",
  });
});

test("a balance that cannot be read fails the request instead of reading as zero", async () => {
  const { app } = fixture({ failRead: true });

  const one = await app.request(`/agents/${FIRST}`);
  const all = await app.request("/agents");

  assert.equal(one.status, 500);
  assert.equal(all.status, 500);
  assert.deepEqual(await one.json(), {
    error: "INTERNAL_OR_PROVIDER_FAILURE",
    message: "Something went wrong; try again",
  });
});

test("an agent without a wallet reads as unfunded and does not block creation", async () => {
  const { app } = fixture({ agents: [SECOND.replace("2222", "3333")] });
  const id = SECOND.replace("2222", "3333");

  const body = await (await app.request(`/agents/${id}`)).json();

  assert.equal(body.wallet, null);
  assert.deepEqual(body.canSchedule, { ok: false, reason: "unfunded" });
  assert.deepEqual(body.canCreateAnother, { ok: true, reason: null });
});

test("saving limits keeps the version, the schedule lock open and readiness", async () => {
  const { app, spends, updates, scheduled } = fixture({ balances: { [FIRST]: 10 } });

  const response = await app.request(
    `/agents/${FIRST}/limits`,
    put({ perCallAusd: 5, perDayAusd: 50 }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.version, 1);
  assert.deepEqual(body.config.spend, { perCallAusd: 5, perDayAusd: 50 });
  assert.deepEqual(spends, [{ perCallAusd: 5, perDayAusd: 50 }]);
  assert.deepEqual(updates, []);

  const agent = await (await app.request(`/agents/${FIRST}`)).json();

  assert.equal(agent.version, 1);
  assert.deepEqual(agent.spend, { perCallAusd: 5, perDayAusd: 50 });
  assert.equal(agent.spendEnforced, true);
  assert.deepEqual(agent.canSchedule, { ok: true, reason: null });

  const on = await app.request(`/agents/${FIRST}/schedule`, put({ enabled: true }));

  assert.equal(on.status, 200);
  assert.deepEqual(scheduled, [true]);
});

test("a config change after saving limits still bumps the version and needs a new run", async () => {
  const { app } = fixture({ balances: { [FIRST]: 10 } });
  await app.request(`/agents/${FIRST}/limits`, put({ perCallAusd: 5, perDayAusd: 50 }));
  const { config } = await (await app.request(`/agents/${FIRST}`)).json();

  const response = await app.request(
    `/agents/${FIRST}/config`,
    put({ expectedVersion: 1, config }),
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).version, 2);
  const agent = await (await app.request(`/agents/${FIRST}`)).json();
  assert.deepEqual(agent.canSchedule, { ok: false, reason: "first_run" });
});

test("limits outside their bounds, or a day below a call, are refused before any write", async () => {
  const { app, spends } = fixture();

  for (const body of [
    { perCallAusd: 0, perDayAusd: 10 },
    { perCallAusd: 1_001, perDayAusd: 10_000 },
    { perCallAusd: 5, perDayAusd: 10_001 },
    { perCallAusd: 50, perDayAusd: 49 },
    { perCallAusd: 5 },
    { perCallAusd: 5, perDayAusd: 50, expectedVersion: 1 },
    { perCallAusd: 5, perDayAusd: 50, tenantId: "victim" },
  ]) {
    const response = await app.request(`/agents/${FIRST}/limits`, put(body));

    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.deepEqual(spends, []);
});

test("an agent without limits says so, and that limits are enforced on paper", async () => {
  const { app } = fixture({ balances: { [FIRST]: 10 } });

  const agent = await (await app.request(`/agents/${FIRST}`)).json();

  assert.equal(agent.spend, null);
  assert.equal(agent.spendEnforced, true);
});

test("changing the interval keeps the version, the schedule lock open and readiness", async () => {
  const { app, intervals, updates, scheduled } = fixture({ balances: { [FIRST]: 10 } });
  const started = Date.now();

  const response = await app.request(`/agents/${FIRST}/interval`, put({ hours: 12 }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.version, 1);
  assert.equal(body.config.intervalHours, 12);
  assert.deepEqual(
    intervals.map((write) => write.hours),
    [12],
  );
  assert.ok(intervals[0]!.now >= started);
  assert.deepEqual(updates, []);

  const agent = await (await app.request(`/agents/${FIRST}`)).json();

  assert.equal(agent.version, 1);
  assert.equal(agent.config.intervalHours, 12);
  assert.deepEqual(agent.canSchedule, { ok: true, reason: null });

  const on = await app.request(`/agents/${FIRST}/schedule`, put({ enabled: true }));

  assert.equal(on.status, 200);
  assert.deepEqual(scheduled, [true]);
});

test("every offered interval is accepted, and nothing else reaches the store", async () => {
  const { app, intervals } = fixture();

  for (const hours of [3, 6, 12, 24]) {
    const response = await app.request(`/agents/${FIRST}/interval`, put({ hours }));

    assert.equal(response.status, 200, String(hours));
  }
  for (const body of [
    { hours: 0 },
    { hours: 4 },
    { hours: 48 },
    { hours: "6" },
    {},
    { hours: 6, expectedVersion: 1 },
    { hours: 6, tenantId: "victim" },
  ]) {
    const response = await app.request(`/agents/${FIRST}/interval`, put(body));

    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.deepEqual(
    intervals.map((write) => write.hours),
    [3, 6, 12, 24],
  );
});

test("the interval of someone else's agent, or without a session, is refused", async () => {
  const signedOut = fixture({ signedIn: false });

  const refused = await signedOut.app.request(`/agents/${FIRST}/interval`, put({ hours: 6 }));

  assert.equal(refused.status, 401);
  assert.deepEqual(signedOut.intervals, []);

  const { app, intervals } = fixture();

  const missing = await app.request(`/agents/${SECOND}/interval`, put({ hours: 6 }));

  assert.equal(missing.status, 404);
  assert.deepEqual(intervals, []);
});

test("the agent DTO carries its profile's accent, in the list and on its own", async () => {
  const { app } = fixture({ agents: [FIRST, SECOND], balances: { [FIRST]: 10, [SECOND]: 10 } });

  const list = await (await app.request("/agents")).json();
  const one = await (await app.request(`/agents/${FIRST}`)).json();

  assert.deepEqual(
    list.agents.map((agent: { accent: string }) => agent.accent),
    ["magenta", "lime"],
  );
  assert.equal(one.accent, "magenta");
});
