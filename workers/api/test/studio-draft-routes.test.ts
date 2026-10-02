import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  DEFAULT_BRIEF,
  PilotError,
  PublishBlockedError,
  STARTER_CAPS,
  buildUserPrincipal,
  prepareDraft,
  type AgentConfig,
  type AgentRecord,
  type PublishCheck,
  type ResearchRepository,
  type StudioDirectory,
  type TransferLedgerEntry,
} from "@pickler/core";
import { PUBLISH_BLOCKERS, studioAgentSchema } from "@pickler/api-schema";
import type { AppEnv } from "../src/env.js";
import { studioRoutes } from "../src/routes/studio.js";

const DRAFT = "33333333-3333-4333-8333-333333333333";
const LIVE = "44444444-4444-4444-8444-444444444444";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const PUBLISHED_AT = new Date("2026-10-02T12:00:00.000Z");

const { config: draftConfig } = prepareDraft({
  name: "Halftime",
  handle: "halftime",
  voice: "analyst",
  avatar: { accent: "lime", pattern: 0 },
  sources: { web: null },
  brief: DEFAULT_BRIEF,
  caps: STARTER_CAPS,
  walletId: "unused",
});

interface Agent {
  id: string;
  draft: boolean;
  visibility: "private" | "public";
  publishedAt: Date | null;
  xHandle: string | null;
  name: string;
  killed: boolean;
  wallet: boolean;
}

function app({
  balance = 50,
  balanceFails = false,
  killed = false,
  wallet = true,
  publishConflict = false,
  publishesDuringSetup = false,
  ledger = [] as TransferLedgerEntry[],
}: {
  balance?: number;
  balanceFails?: boolean;
  killed?: boolean;
  wallet?: boolean;
  publishConflict?: boolean;
  /** A publish lands after setup's draft check and before its write. */
  publishesDuringSetup?: boolean;
  ledger?: TransferLedgerEntry[];
} = {}) {
  const agents: Agent[] = [
    {
      id: DRAFT,
      draft: true,
      visibility: "private",
      publishedAt: null,
      xHandle: null,
      name: "Halftime",
      killed,
      wallet,
    },
    {
      id: LIVE,
      draft: false,
      visibility: "public",
      publishedAt: PUBLISHED_AT,
      xHandle: "LiveBot",
      name: "Live",
      killed: false,
      wallet: true,
    },
  ];
  const configs = new Map<string, { version: number; config: AgentConfig }>([
    [DRAFT, { version: 1, config: draftConfig }],
    [LIVE, { version: 4, config: draftConfig }],
  ]);
  const identities: { id: string; identity: Record<string, unknown> }[] = [];
  const ledgerReads: string[] = [];
  const checks: unknown[] = [];
  const chain = { balance };
  const balanceCache = new Map<string, number>();
  const record = (id: string): AgentRecord => ({
    id,
    tenantId: "trusted",
    version: configs.get(id)!.version,
    config: configs.get(id)!.config,
    paused: false,
    scheduleEnabled: false,
    nextDueAt: null,
  });
  const find = (id: string) => {
    const agent = agents.find((candidate) => candidate.id === id);
    if (!agent) {
      throw new PilotError("NOT_FOUND", "Agent not found");
    }
    return agent;
  };
  const directory = {
    access: async () => ({
      workspaceId: "workspace",
      tenantId: "trusted",
      ownerUserId: "user",
      role: "admin",
      enabled: true,
    }),
    list: async () =>
      agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        handle: agent.name.toLowerCase(),
        accent: "lime" as const,
        avatarPattern: 0,
        draft: agent.draft,
        visibility: agent.visibility,
        publishedAt: agent.publishedAt,
        xHandle: agent.xHandle,
        scope: { tenantId: "trusted", agentId: agent.id },
      })),
    agentScope: async (_access, id) => ({ tenantId: "trusted", agentId: find(id).id }),
    updateIdentity: async (_access, id, identity) => {
      const agent = find(id);
      if (identity.name !== undefined) {
        agent.name = identity.name;
      }
      identities.push({ id, identity });
    },
    activity: async (_access, id) => {
      find(id);
      return [
        { kind: "wallet", text: "Agent wallet created · 0x1111…1111", at: PUBLISHED_AT },
        { kind: "created", text: "Halftime created", at: new Date("2026-10-01T00:00:00Z") },
      ];
    },
    publish: async (_access, id, check: PublishCheck) => {
      const agent = find(id);
      if (agent.visibility === "public") {
        return { visibility: "public" as const, publishedAt: agent.publishedAt! };
      }
      const state = { killed: agent.killed, walletAddress: agent.wallet ? ADDRESS : null };
      checks.push(state);
      const blockers = await check(state);
      if (blockers.length) {
        throw new PublishBlockedError(blockers);
      }
      if (publishConflict) {
        throw new PilotError("PUBLISH_CONFLICT", "changed");
      }
      agent.visibility = "public";
      agent.publishedAt = PUBLISHED_AT;
      agent.draft = false;
      return { visibility: "public" as const, publishedAt: PUBLISHED_AT };
    },
  } as Partial<StudioDirectory> as StudioDirectory;
  const studio = studioRoutes({
    directory,
    repository: {
      agent: async (scope: { agentId: string }) => {
        if (publishesDuringSetup) {
          find(scope.agentId).draft = false;
        }
        return record(scope.agentId);
      },
      readiness: async () => ({ connectionsChecked: false, manualSucceeded: true }),
      updateConfig: async (
        scope: { agentId: string },
        expected: number,
        config: AgentConfig,
        options: { requireDraft?: boolean; writeSpend?: boolean } = {},
      ) => {
        const stored = configs.get(scope.agentId)!;
        if (stored.version !== expected) {
          throw new PilotError("CONFLICT", "Configuration version changed");
        }
        if (options.requireDraft && !find(scope.agentId).draft) {
          throw new PilotError("NOT_A_DRAFT", "Only a draft's setup is edited here");
        }
        // As the real store: the stored spend stays unless `writeSpend` writes the incoming one.
        const { spend: incoming, ...rest } = config;
        const spend = (options.writeSpend ? incoming : undefined) ?? stored.config.spend;
        configs.set(scope.agentId, {
          version: expected + 1,
          config: spend ? { ...rest, spend } : rest,
        });
        return record(scope.agentId);
      },
    } as unknown as ResearchRepository,
    notifyQueued: async () => {},
    wallets: {
      findAgentWallet: async (id) =>
        agents.find((agent) => agent.id === id)?.wallet
          ? { walletId: `w-${id}`, address: ADDRESS }
          : null,
    },
    // Cached per address like the real reader, until `forget`.
    balances: {
      read: async (address) => {
        if (balanceFails) {
          throw new Error("JSON-RPC eth_call failed: 502");
        }
        const cached = balanceCache.get(address);
        if (cached !== undefined) {
          return cached;
        }
        balanceCache.set(address, chain.balance);
        return chain.balance;
      },
      forget: (address) => {
        balanceCache.delete(address);
      },
    },
    transfers: {
      list: async (userId) => {
        ledgerReads.push(userId);
        return ledger;
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
  const root = new Hono<AppEnv>();
  root.use("*", async (c, next) => {
    c.set("requestId", "request-1");
    await next();
  });
  root.route("/", studio);
  return { root, agents, configs, identities, ledgerReads, checks, chain };
}

const send = (method: string, payload?: unknown) => ({
  method,
  headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
  ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
});
const get = () => ({ headers: { Authorization: "Bearer token" } });

test("the studio agent says whether it is public, since when, and its verified X handle", async () => {
  const f = app();

  const draft = studioAgentSchema.parse(
    await (await f.root.request(`/agents/${DRAFT}`, get())).json(),
  );
  const live = studioAgentSchema.parse(
    await (await f.root.request(`/agents/${LIVE}`, get())).json(),
  );

  assert.equal(draft.visibility, "private");
  assert.equal(draft.publishedAt, null);
  assert.equal(draft.xHandle, null);
  assert.equal(live.visibility, "public");
  assert.equal(live.publishedAt, PUBLISHED_AT.toISOString());
  assert.equal(live.xHandle, "LiveBot");
});

test("the agents list carries the same visibility, publishedAt and xHandle", async () => {
  const f = app();

  const { agents } = await (await f.root.request("/agents", get())).json();

  assert.deepEqual(
    agents.map(
      (agent: { visibility: string; publishedAt: string | null; xHandle: string | null }) => [
        agent.visibility,
        agent.publishedAt,
        agent.xHandle,
      ],
    ),
    [
      ["private", null, null],
      ["public", PUBLISHED_AT.toISOString(), "LiveBot"],
    ],
  );
});

test("setup revises a draft's config with core's rules and answers the studio agent", async () => {
  const f = app();

  const response = await f.root.request(
    `/agents/${DRAFT}/setup`,
    send("PUT", {
      expectedVersion: 1,
      caps: { perTradeAusd: 10, perDayAusd: 40, maxLeverage: 2 },
      voice: "deadpan",
    }),
  );

  assert.equal(response.status, 200);
  const agent = studioAgentSchema.parse(await response.json());
  assert.equal(agent.version, 2);
  assert.deepEqual(agent.spend, { perCallAusd: 10, perDayAusd: 40 });
  const saved = f.configs.get(DRAFT)!.config;
  assert.equal(saved.voice, "deadpan");
  assert.equal(saved.maxLeverage, 2);
  assert.deepEqual(saved.marketScope, draftConfig.marketScope);
  // The profile's voice name follows the config's voice.
  assert.deepEqual(f.identities, [{ id: DRAFT, identity: { voice: "Deadpan" } }]);
});

test("setup without a voice leaves the profile alone", async () => {
  const f = app();

  const response = await f.root.request(
    `/agents/${DRAFT}/setup`,
    send("PUT", {
      expectedVersion: 1,
      sources: { web: { mode: "only", sites: ["coindesk.com"] } },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(f.configs.get(DRAFT)!.config.sources?.web?.sites, ["coindesk.com"]);
  assert.deepEqual(f.identities, []);
});

test("setup on an agent that is not a draft is 409 NOT_A_DRAFT and writes nothing", async () => {
  const f = app();

  const response = await f.root.request(
    `/agents/${LIVE}/setup`,
    send("PUT", { expectedVersion: 4, voice: "deadpan" }),
  );

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "NOT_A_DRAFT");
  assert.equal(f.configs.get(LIVE)!.version, 4);
});

test("setup that a publish overtakes is 409 NOT_A_DRAFT, refused by the write itself", async () => {
  const f = app({ publishesDuringSetup: true });

  const response = await f.root.request(
    `/agents/${DRAFT}/setup`,
    send("PUT", { expectedVersion: 1, voice: "deadpan" }),
  );

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "NOT_A_DRAFT");
  assert.equal(f.configs.get(DRAFT)!.version, 1);
  assert.deepEqual(f.identities, []);
});

test("setup at a stale version is 409 CONFLICT, the config store's own code", async () => {
  const f = app();

  const response = await f.root.request(
    `/agents/${DRAFT}/setup`,
    send("PUT", { expectedVersion: 7, voice: "deadpan" }),
  );

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "CONFLICT");
  assert.deepEqual(f.identities, []);
});

test("setup refuses a bad brief with INVALID_BRIEF and caps out of bounds with INVALID_INPUT", async () => {
  const f = app();

  const brief = await f.root.request(
    `/agents/${DRAFT}/setup`,
    send("PUT", { expectedVersion: 1, brief: { ...DEFAULT_BRIEF, entersWhen: [] } }),
  );
  const caps = await f.root.request(
    `/agents/${DRAFT}/setup`,
    send("PUT", {
      expectedVersion: 1,
      caps: { perTradeAusd: 1_000_000, perDayAusd: 1, maxLeverage: 1 },
    }),
  );
  const unknown = await f.root.request(
    `/agents/${DRAFT}/setup`,
    send("PUT", { expectedVersion: 1, marketScope: {} }),
  );

  assert.equal(brief.status, 400);
  assert.equal((await brief.json()).error, "INVALID_BRIEF");
  assert.equal(caps.status, 400);
  assert.equal((await caps.json()).error, "INVALID_INPUT");
  assert.equal(unknown.status, 400);
  assert.equal(f.configs.get(DRAFT)!.version, 1);
});

test("setup of another owner's agent is 404", async () => {
  const f = app();

  const response = await f.root.request(
    "/agents/99999999-9999-4999-8999-999999999999/setup",
    send("PUT", { expectedVersion: 1, voice: "deadpan" }),
  );

  assert.equal(response.status, 404);
});

test("identity writes name and avatar and answers the studio agent", async () => {
  const f = app();

  const response = await f.root.request(
    `/agents/${DRAFT}/identity`,
    send("PUT", { name: "Second Half", avatar: { accent: "cyan", pattern: 4 } }),
  );

  assert.equal(response.status, 200);
  assert.equal(studioAgentSchema.parse(await response.json()).name, "Second Half");
  assert.deepEqual(f.identities, [
    { id: DRAFT, identity: { name: "Second Half", accent: "cyan", avatarPattern: 4 } },
  ]);
});

test("identity refuses an empty name, a handle and an unknown accent with 400 INVALID_INPUT", async () => {
  const f = app();

  for (const body of [
    { name: "  " },
    { handle: "other" },
    { avatar: { accent: "red", pattern: 0 } },
  ]) {
    const response = await f.root.request(`/agents/${DRAFT}/identity`, send("PUT", body));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "INVALID_INPUT");
  }
  assert.deepEqual(f.identities, []);
});

test("activity answers the directory's events with ISO times", async () => {
  const f = app();

  const response = await f.root.request(`/agents/${DRAFT}/activity`, get());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    events: [
      {
        kind: "wallet",
        text: "Agent wallet created · 0x1111…1111",
        at: PUBLISHED_AT.toISOString(),
      },
      { kind: "created", text: "Halftime created", at: "2026-10-01T00:00:00.000Z" },
    ],
  });
});

test("publish makes a funded draft public, and the studio agent says so", async () => {
  const f = app({ balance: 10 });

  const response = await f.root.request(`/agents/${DRAFT}/publish`, send("POST", {}));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    visibility: "public",
    publishedAt: PUBLISHED_AT.toISOString(),
  });
  assert.deepEqual(f.checks, [{ killed: false, walletAddress: ADDRESS }]);
  const agent = studioAgentSchema.parse(
    await (await f.root.request(`/agents/${DRAFT}`, get())).json(),
  );
  assert.equal(agent.visibility, "public");
  assert.equal(agent.publishedAt, PUBLISHED_AT.toISOString());
});

test("publish reads the balance fresh, not the cached one", async () => {
  const f = app({ balance: 50 });
  // The studio agent's read caches 50 AUSD; then the owner pulls it back to master.
  await f.root.request(`/agents/${DRAFT}`, get());
  f.chain.balance = 3;

  const response = await f.root.request(`/agents/${DRAFT}/publish`, send("POST", {}));

  assert.equal(response.status, 409);
  assert.deepEqual((await response.json()).detail, { blockers: ["FUNDS"] });
  assert.equal(f.agents[0]!.visibility, "private");
});

test("publish on a public agent answers its state without a check", async () => {
  const f = app();

  const response = await f.root.request(`/agents/${LIVE}/publish`, send("POST"));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).publishedAt, PUBLISHED_AT.toISOString());
  assert.deepEqual(f.checks, []);
});

test("publish under 10 AUSD is 409 PUBLISH_BLOCKED with FUNDS", async () => {
  const f = app({ balance: 9.999999 });

  const response = await f.root.request(`/agents/${DRAFT}/publish`, send("POST", {}));

  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error, "PUBLISH_BLOCKED");
  assert.deepEqual(body.detail, { blockers: ["FUNDS"] });
  assert.equal(typeof body.message, "string");
  assert.equal(f.agents[0]!.visibility, "private");
});

test("publish of a killed agent without a wallet lists both blockers", async () => {
  const f = app({ killed: true, wallet: false });

  const response = await f.root.request(`/agents/${DRAFT}/publish`, send("POST", {}));

  assert.equal(response.status, 409);
  const { detail } = await response.json();
  assert.deepEqual(detail.blockers, ["KILLED", "WALLET"]);
  for (const blocker of detail.blockers) {
    assert.ok((PUBLISH_BLOCKERS as readonly string[]).includes(blocker));
  }
});

test("publish with a balance the chain cannot read is 503 BALANCES_UNAVAILABLE", async () => {
  const f = app({ balanceFails: true });

  const response = await f.root.request(`/agents/${DRAFT}/publish`, send("POST", {}));

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "BALANCES_UNAVAILABLE");
  assert.equal(f.agents[0]!.visibility, "private");
});

test("publish that keeps meeting a changed agent is 409 PUBLISH_CONFLICT", async () => {
  const f = app({ publishConflict: true });

  const response = await f.root.request(`/agents/${DRAFT}/publish`, send("POST", {}));

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "PUBLISH_CONFLICT");
});

test("publish refuses a body with fields", async () => {
  const f = app();

  const response = await f.root.request(`/agents/${DRAFT}/publish`, send("POST", { force: true }));

  assert.equal(response.status, 400);
  assert.deepEqual(f.checks, []);
});

test("the ledger answers the caller's transfers, read by their own user id", async () => {
  const f = app({
    ledger: [
      {
        direction: "to_agent",
        token: "AUSD",
        amount: "10",
        agentName: "Halftime",
        txHash: "0xabc",
        at: PUBLISHED_AT,
      },
    ],
  });

  const response = await f.root.request("/wallets/ledger", get());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    entries: [
      {
        direction: "to_agent",
        token: "AUSD",
        amount: "10",
        agentName: "Halftime",
        txHash: "0xabc",
        at: PUBLISHED_AT.toISOString(),
      },
    ],
  });
  assert.deepEqual(f.ledgerReads, ["user"]);
});
