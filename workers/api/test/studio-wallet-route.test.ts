import test from "node:test";
import assert from "node:assert/strict";
import {
  buildUserPrincipal,
  DEFAULT_CONFIG,
  LOCK_REASONS as CORE_LOCK_REASONS,
  PilotError,
  type AgentRecord,
  type ScheduleReadiness,
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
}

function fixture({
  agents = [FIRST],
  balances = {},
  ready = true,
  failRead = false,
}: Options = {}) {
  const scheduled: boolean[] = [];
  const created: string[] = [];
  const reads: string[] = [];
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
    createAgent: async (_access, _user, input) => {
      created.push(input.handle);
      return scope(SECOND);
    },
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
        scope: scope(id),
      })),
    runs: async () => [],
  };

  const record = (id: string): AgentRecord => ({
    id,
    tenantId: "trusted",
    version: 1,
    config: scopedConfig,
    paused: false,
    scheduleEnabled: false,
    nextDueAt: null,
  });
  const readiness: ScheduleReadiness = { connectionsChecked: ready, manualSucceeded: ready };
  const repository = {
    agent: async (s: { agentId: string }) => record(s.agentId),
    readiness: async () => readiness,
    schedule: async (_scope: unknown, enabled: boolean) => {
      if (enabled && !ready) {
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
        if (failRead) {
          throw new Error("rpc down");
        }
        const id = Object.keys(ADDRESS).find((key) => ADDRESS[key] === address)!;
        return balances[id] ?? 0;
      },
    },
    authenticate: async () => ({
      principal: buildUserPrincipal({
        user: { id: "user" },
        integrator: { id: "workspace" },
        memberRole: "admin",
      }),
      workspace: null,
    }),
  });
  return { app, scheduled, created, reads };
}

const put = (body: unknown) => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const createBody = {
  name: "Second",
  handle: "second",
  config: scopedConfig,
  profile: {
    accent: "lime",
    blurb: "",
    venue: "predictions",
    vibe: "",
    voice: "",
    decides: "",
    wrong: "",
    xHandle: null,
  },
  wallet: { walletId: "wallet-2" },
};

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
  assert.deepEqual(await refused.json(), { error: "NOT_FUNDED" });
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
  assert.deepEqual(await refused.json(), { error: "NOT_READY" });
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

test("a second agent is refused while the first holds 3 AUSD", async () => {
  const { app, created } = fixture({ balances: { [FIRST]: 3 } });

  const response = await app.request("/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "k" },
    body: JSON.stringify(createBody),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "UNFUNDED_AGENT" });
  assert.deepEqual(created, []);
});

test("the first agent, and a next one once every agent is funded, are created", async () => {
  for (const options of [{ agents: [] }, { balances: { [FIRST]: 10 } }]) {
    const { app, created } = fixture(options);

    const response = await app.request("/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "k" },
      body: JSON.stringify(createBody),
    });

    assert.equal(response.status, 201);
    assert.deepEqual(created, ["second"]);
  }
});

test("a balance that cannot be read fails the request instead of reading as zero", async () => {
  const { app } = fixture({ failRead: true });

  const one = await app.request(`/agents/${FIRST}`);
  const all = await app.request("/agents");

  assert.equal(one.status, 500);
  assert.equal(all.status, 500);
  assert.deepEqual(await one.json(), { error: "INTERNAL_OR_PROVIDER_FAILURE" });
});

test("an agent without a wallet reads as unfunded and does not block creation", async () => {
  const { app } = fixture({ agents: [SECOND.replace("2222", "3333")] });
  const id = SECOND.replace("2222", "3333");

  const body = await (await app.request(`/agents/${id}`)).json();

  assert.equal(body.wallet, null);
  assert.deepEqual(body.canSchedule, { ok: false, reason: "unfunded" });
  assert.deepEqual(body.canCreateAnother, { ok: true, reason: null });
});
