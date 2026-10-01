import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  DEFAULT_BRIEF,
  DEFAULT_CONFIG,
  MIN_START_MICRO_AUSD,
  MIN_START_MON_WEI,
  PilotError,
  STARTER_CAPS,
  AgentWalletNotFoundError,
  BalancesUnreadableError,
  buildUserPrincipal,
  type AgentConfig,
  type AgentRecord,
  type DraftProfile,
  type ResearchRepository,
  type StudioDirectory,
} from "@pickler/core";
import type { AppEnv } from "../src/env.js";
import { studioRoutes } from "../src/routes/studio.js";

const DRAFT = "33333333-3333-4333-8333-333333333333";
const FUNDED = "44444444-4444-4444-8444-444444444444";
const body = {
  name: "Halftime",
  handle: "halftime",
  voice: "analyst",
  avatar: { accent: "lime", pattern: 0 },
  sources: { web: null },
  brief: { ...DEFAULT_BRIEF },
  caps: { ...STARTER_CAPS },
  walletId: "wal-agent",
};

interface Created {
  name: string;
  handle: string;
  config: AgentConfig;
  profile: DraftProfile;
  walletId: string;
}

function app({
  listed = [] as { id: string; draft: boolean; wallet: boolean }[],
  refuse,
  balance = 50,
  mon = MIN_START_MON_WEI,
  ausd = MIN_START_MICRO_AUSD,
  custody = true,
  read = "ok",
  replay = false,
}: {
  listed?: { id: string; draft: boolean; wallet: boolean }[];
  refuse?: string;
  balance?: number;
  mon?: bigint | null;
  ausd?: bigint | null;
  custody?: boolean;
  /** How the balance read goes: as given, a timeout, or not the caller's wallet. */
  read?: "ok" | "timeout" | "not_mine";
  /** The directory answers a create that already committed, without running admit. */
  replay?: boolean;
} = {}) {
  const drafts: Created[] = [];
  const balanceReads: { userId: string; walletId: string }[] = [];
  const admitted: boolean[] = [];
  const config = { ...DEFAULT_CONFIG };
  const record = (id: string): AgentRecord => ({
    id,
    tenantId: "trusted",
    version: 1,
    config,
    paused: false,
    scheduleEnabled: false,
    nextDueAt: null,
  });
  const directory = {
    access: async () => ({
      workspaceId: "workspace",
      tenantId: "trusted",
      ownerUserId: "user",
      role: "admin",
      enabled: true,
    }),
    list: async () =>
      listed.map((agent) => ({
        id: agent.id,
        name: "Agent",
        handle: "agent",
        accent: "lime" as const,
        draft: agent.draft,
        scope: { tenantId: "trusted", agentId: agent.id },
      })),
    createDraft: async (_access, _user, input, admit) => {
      // The directory checks the handle and the wallet, then runs the lock, in its transaction.
      if (replay) {
        return { productId: DRAFT, scope: { tenantId: "trusted", agentId: DRAFT } };
      }
      if (refuse) {
        throw new PilotError(refuse, `refused: ${refuse}`);
      }
      admitted.push(true);
      await admit?.();
      drafts.push(input);
      return { productId: DRAFT, scope: { tenantId: "trusted", agentId: DRAFT } };
    },
    agentScope: async (_access, id) => ({ tenantId: "trusted", agentId: id }),
  } as Partial<StudioDirectory> as StudioDirectory;
  const studio = studioRoutes({
    directory,
    repository: {
      agent: async (scope: { agentId: string }) => record(scope.agentId),
      readiness: async () => ({ connectionsChecked: false, manualSucceeded: true }),
    } as unknown as ResearchRepository,
    notifyQueued: async () => {},
    wallets: {
      findAgentWallet: async (id) =>
        listed.find((agent) => agent.id === id)?.wallet
          ? { walletId: `w-${id}`, address: "0x1111111111111111111111111111111111111111" }
          : null,
    },
    balances: { read: async () => balance },
    ...(custody
      ? {
          custody: () =>
            ({
              walletBalance: async (userId: string, walletId: string) => {
                balanceReads.push({ userId, walletId });
                if (read === "timeout") {
                  throw new BalancesUnreadableError({ cause: new Error("timeout") });
                }
                if (read === "not_mine") {
                  throw new AgentWalletNotFoundError();
                }
                if (mon === null && ausd === null) {
                  throw new BalancesUnreadableError();
                }
                return { monWei: mon, ausdMicro: ausd };
              },
            }) as never,
        }
      : {}),
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
  return { root, drafts, balanceReads, admitted };
}

const post = (payload: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
  body: JSON.stringify(payload),
});

test("a draft is created with the wallet and answers 201 with its product id", async () => {
  const f = app();
  const response = await f.root.request("/drafts", post(body));
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.productId, DRAFT);
  assert.equal(created.agent.id, DRAFT);
  assert.equal(f.drafts.length, 1);
  const input = f.drafts[0]!;
  assert.equal(input.walletId, "wal-agent");
  assert.equal(input.handle, "halftime");
  assert.deepEqual(input.profile, { accent: "lime", avatarPattern: 0, voice: "Analyst" });
  assert.equal(input.config.voice, "analyst");
  assert.deepEqual(input.config.spend, { perCallAusd: 5, perDayAusd: 20 });
  // The balances are read again, for the caller's own wallet, inside the create.
  assert.deepEqual(f.balanceReads, [{ userId: "user", walletId: "wal-agent" }]);
});

test("a draft below either minimum is 409 WALLET_UNDERFUNDED with the balances", async () => {
  const f = app({ mon: 0n });
  const response = await f.root.request("/drafts", post(body));
  assert.equal(response.status, 409);
  const json = await response.json();
  assert.equal(json.error, "WALLET_UNDERFUNDED");
  assert.equal(typeof json.message, "string");
  assert.deepEqual(json.detail, {
    ausdMicro: "10000000",
    monWei: "0",
    minAusdMicro: "10000000",
    minMonWei: "500000000000000000",
  });
  assert.equal(f.drafts.length, 0);
});

test("an AUSD balance the chain did not answer, with MON read, is underfunded", async () => {
  const f = app({ ausd: null });
  const response = await f.root.request("/drafts", post(body));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).detail.ausdMicro, null);
});

test("a balance read that times out is 503 WALLETS_UNAVAILABLE, never underfunded", async () => {
  const f = app({ read: "timeout" });
  const response = await f.root.request("/drafts", post(body));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "WALLETS_UNAVAILABLE");
  assert.equal(f.drafts.length, 0);
});

test("a chain that answers neither balance is 503 WALLETS_UNAVAILABLE", async () => {
  const f = app({ mon: null, ausd: null });
  const response = await f.root.request("/drafts", post(body));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "WALLETS_UNAVAILABLE");
});

test("the balances are read before the transaction; a replay never runs admit, even underfunded", async () => {
  const f = app({ replay: true, mon: 0n });
  const response = await f.root.request("/drafts", post(body));
  assert.equal(response.status, 201);
  assert.deepEqual(f.admitted, []);
});

test("a wallet that is not the caller's has no reading and is WALLET_NOT_FOUND", async () => {
  const f = app({ read: "not_mine" });
  const response = await f.root.request("/drafts", post(body));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "WALLET_NOT_FOUND");
  assert.equal(f.drafts.length, 0);
});

test("without custody the drafts route is 503 and creates nothing", async () => {
  const f = app({ custody: false });
  const response = await f.root.request("/drafts", post(body));
  assert.equal(response.status, 503);
  assert.equal(f.drafts.length, 0);
});

test("a previewRunId is refused as unknown", async () => {
  const f = app();
  const response = await f.root.request(
    "/drafts",
    post({ ...body, previewRunId: "0000000a-0000-4000-8000-000000000000" }),
  );
  assert.equal(response.status, 400);
  assert.equal(f.drafts.length, 0);
});

test("a missing voice is 400 INVALID_INPUT", async () => {
  const f = app();
  const response = await f.root.request("/drafts", post({ ...body, voice: undefined }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "INVALID_INPUT");
});

test("no entry rule is 400 INVALID_BRIEF naming entersWhen", async () => {
  const f = app();
  const response = await f.root.request(
    "/drafts",
    post({ ...body, brief: { ...body.brief, entersWhen: [] } }),
  );
  assert.equal(response.status, 400);
  const json = await response.json();
  assert.equal(json.error, "INVALID_BRIEF");
  assert.equal(json.field, "entersWhen");
  assert.equal(f.drafts.length, 0);
});

test("sites are reduced to bare hosts before core checks them", async () => {
  const f = app();
  const response = await f.root.request(
    "/drafts",
    post({
      ...body,
      sources: {
        web: {
          mode: "prefer",
          sites: ["CoinDesk.com", "https://www.coindesk.com/markets", " theblock.co/latest "],
        },
      },
    }),
  );
  assert.equal(response.status, 201);
  assert.deepEqual(f.drafts[0]!.config.sources?.web, {
    mode: "prefer",
    sites: ["coindesk.com", "theblock.co"],
  });
});

test("a site that is no host at all is still refused", async () => {
  const f = app();
  const response = await f.root.request(
    "/drafts",
    post({ ...body, sources: { web: { mode: "prefer", sites: ["not a site"] } } }),
  );
  assert.equal(response.status, 400);
  assert.equal(f.drafts.length, 0);
});

for (const code of ["WALLET_ASSIGNED", "POLICIES_MISSING", "HANDLE_TAKEN"]) {
  test(`the directory's ${code} is 409 with that code`, async () => {
    const f = app({ refuse: code });
    const response = await f.root.request("/drafts", post(body));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: code, message: `refused: ${code}` });
  });
}

test("the directory's WALLET_NOT_FOUND is 404", async () => {
  const f = app({ refuse: "WALLET_NOT_FOUND" });
  const response = await f.root.request("/drafts", post(body));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "WALLET_NOT_FOUND");
});

const draftAgents = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `5555555${index}-5555-4555-8555-555555555555`,
    draft: true,
    wallet: false,
  }));

test("an unfunded agent with a wallet still closes the lock for a draft", async () => {
  const f = app({ listed: [{ id: FUNDED, draft: false, wallet: true }], balance: 3 });

  const response = await f.root.request("/drafts", post(body));

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "UNFUNDED_AGENT");
});

test("the fourth draft is refused: 409 DRAFT_LIMIT, naming the limit", async () => {
  const f = app({ listed: draftAgents(3) });

  const response = await f.root.request("/drafts", post(body));

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "DRAFT_LIMIT",
    message: "At most 3 drafts at a time",
  });
  assert.equal(f.drafts.length, 0);
});

test("the agents list says which are drafts, and drafts leave the lock open", async () => {
  const f = app({ listed: draftAgents(2) });

  const response = await f.root.request("/agents", { headers: { Authorization: "Bearer t" } });

  const { agents } = await response.json();
  assert.equal(agents[0].draft, true);
  assert.equal(agents[0].wallet, null);
  assert.deepEqual(agents[0].canCreateAnother, { ok: true, reason: null });
});

test("at the draft limit the lock says so", async () => {
  const f = app({ listed: draftAgents(3) });

  const response = await f.root.request("/agents", { headers: { Authorization: "Bearer t" } });

  const { agents } = await response.json();
  assert.deepEqual(agents[0].canCreateAnother, { ok: false, reason: "draft_limit" });
});

test("a funded agent without a draft leaves the lock open", async () => {
  const f = app({ listed: [{ id: FUNDED, draft: false, wallet: true }] });
  const response = await f.root.request("/agents", { headers: { Authorization: "Bearer t" } });
  const { agents } = await response.json();
  assert.equal(agents[0].draft, false);
  assert.deepEqual(agents[0].canCreateAnother, { ok: true, reason: null });
});
