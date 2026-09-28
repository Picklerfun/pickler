import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  AuthenticationRequiredError,
  buildUserPrincipal,
  draftToConfig,
  type AgentDraft,
  type AgentDrafter,
  type StudioDirectory,
  type ResearchRepository,
} from "@pickler/core";
import { agentDraftSchema } from "@pickler/api-schema";
import { DraftUnavailableError, createOpenAiCompatibleDrafter } from "@pickler/infrastructure";
import type { AppEnv } from "../src/env.js";
import { studioRoutes } from "../src/routes/studio.js";

const halftime: AgentDraft = {
  name: "Halftime",
  handle: "halftime",
  venues: ["polymarket"],
  beat: "Sports",
  subcategories: ["NFL"],
  sites: ["espn.com"],
  skills: ["Injury double-check"],
  edge: "Reads injury reports before the lines move.",
  style: "balanced",
  accent: "lime",
};

function app(drafter: AgentDrafter | null, { signedIn = true, owner = true } = {}) {
  const directory = {
    access: async () => ({
      workspaceId: "workspace",
      tenantId: "trusted",
      ownerUserId: owner ? "user" : "other",
      role: "auditor",
      enabled: true,
    }),
  } as unknown as StudioDirectory;
  const studio = studioRoutes({
    directory,
    repository: {} as ResearchRepository,
    notifyQueued: async () => {},
    drafter,
    wallets: { findAgentWallet: async () => null },
    balances: {
      read: async () => {
        throw new Error("no balance read expected");
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
          memberRole: "auditor",
        }),
        workspace: null,
      };
    },
  });
  const root = new Hono<AppEnv>();
  root.use("*", async (c, next) => {
    c.set("requestId", "request-1");
    await next();
  });
  root.route("/", studio);
  return root;
}
const post = (line: string) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
  body: JSON.stringify({ line }),
});
const line = "Calls NFL games off injury news before the lines move";

test("a draft the runtime can run comes back with nothing unsupported", async () => {
  const response = await app({ draft: async () => halftime }).request("/agents/draft", post(line));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { draft: halftime, unsupported: [] });
});

test("a draft that names perpl says so instead of dropping it", async () => {
  const drafter = { draft: async () => ({ ...halftime, venues: ["polymarket", "perpl"] }) };

  const response = await app(drafter as AgentDrafter).request("/agents/draft", post(line));

  assert.equal(response.status, 200);
  const body = (await response.json()) as { unsupported: string[] };
  assert.deepEqual(body.unsupported, ["venue:perpl"]);
});

test("a model failure is 503 DRAFT_UNAVAILABLE, with the cause logged server-side only", async () => {
  const drafter = {
    draft: async () => {
      throw new DraftUnavailableError(new Error("The model answered 500"));
    },
  };
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  let response: Response;
  try {
    response = await app(drafter).request("/agents/draft", post(line));
  } finally {
    console.error = original;
  }

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "DRAFT_UNAVAILABLE" });
  assert.deepEqual(logged, [
    [
      "Draft unavailable",
      {
        requestId: "request-1",
        message: "The model could not draft this agent",
        cause: "The model answered 500",
      },
    ],
  ]);
});

test("a model answer naming a subcategory outside its beat is 503 DRAFT_UNAVAILABLE", async () => {
  for (const subcategories of [["Cricket"], ["NFL", "Fed"]]) {
    const drafter = createOpenAiCompatibleDrafter({
      baseUrl: "https://model.example/v1",
      apiKey: "test-only",
      modelId: "m",
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ ...halftime, subcategories }) } }],
          }),
        ),
      validate: (raw) => agentDraftSchema.parse(raw),
    });
    const original = console.error;
    console.error = () => {};

    let response: Response;
    try {
      response = await app(drafter).request("/agents/draft", post(line));
    } finally {
      console.error = original;
    }

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "DRAFT_UNAVAILABLE" });
  }
});

test("no configured model is 503 DRAFT_UNAVAILABLE", async () => {
  const response = await app(null).request("/agents/draft", post(line));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "DRAFT_UNAVAILABLE" });
});

test("drafting needs a signed-in user", async () => {
  let called = false;
  const drafter = {
    draft: async () => {
      called = true;
      return halftime;
    },
  };

  const response = await app(drafter, { signedIn: false }).request("/agents/draft", post(line));

  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test("a member without manage rights is refused the way creating an agent is", async () => {
  let called = false;
  const drafter = {
    draft: async () => {
      called = true;
      return halftime;
    },
  };
  const studio = app(drafter, { owner: false });
  const create = {
    name: "Halftime",
    handle: "halftime",
    config: draftToConfig(halftime),
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
    // Schema-valid so the request reaches authorization rather than failing input validation
    // first; this fake directory is never asked to create anything either way.
    wallet: { walletId: "wallet-1" },
  };

  const drafted = await studio.request("/agents/draft", post(line));
  const created = await studio.request("/agents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer token",
      "Idempotency-Key": "create",
    },
    body: JSON.stringify(create),
  });

  assert.equal(created.status, 403);
  assert.equal(drafted.status, created.status);
  assert.deepEqual(await drafted.json(), await created.json());
  assert.equal(called, false);
});

test("a line too short to draft from is refused before the model is asked", async () => {
  let called = false;
  const drafter = {
    draft: async () => {
      called = true;
      return halftime;
    },
  };

  const response = await app(drafter).request("/agents/draft", post("x"));

  assert.equal(response.status, 400);
  assert.equal(called, false);
});
