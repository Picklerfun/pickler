import test from "node:test";
import assert from "node:assert/strict";
import {
  AuthenticationRequiredError,
  buildUserPrincipal,
  type AgentDraft,
  type AgentDrafter,
  type StudioDirectory,
  type ResearchRepository,
} from "@pickler/core";
import { DraftUnavailableError } from "@pickler/infrastructure";
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

function app(drafter: AgentDrafter | null, { signedIn = true } = {}) {
  const directory = {
    access: async () => ({
      workspaceId: "workspace",
      tenantId: "trusted",
      ownerUserId: "user",
      role: "auditor",
      enabled: true,
    }),
  } as unknown as StudioDirectory;
  return studioRoutes({
    directory,
    repository: {} as ResearchRepository,
    notifyQueued: async () => {},
    drafter,
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

test("a model failure is 503 DRAFT_UNAVAILABLE", async () => {
  const drafter = {
    draft: async () => {
      throw new DraftUnavailableError(new Error("timeout"));
    },
  };

  const response = await app(drafter).request("/agents/draft", post(line));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "DRAFT_UNAVAILABLE" });
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
