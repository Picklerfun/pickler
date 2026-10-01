import assert from "node:assert/strict";
import { test } from "node:test";
import { agentFromSearch, selectAgent, studioAgentHref } from "../src/features/studio/lib/select";

/* `/studio?agent=<id>`: the agent the studio opens on. */

const agents = [{ id: "runtime-a", productId: "a" }, { id: "b", productId: "b" }, { id: "legacy" }];

test("the asked agent is selected by its product id", () => {
  assert.equal(selectAgent(agents, "b"), "b");
});

test("an agent without a product id is selected by its own id", () => {
  assert.equal(selectAgent(agents, "legacy"), "legacy");
});

test("no parameter, or an id that is not the person's, opens on the first agent", () => {
  assert.equal(selectAgent(agents, undefined), "a");
  assert.equal(selectAgent(agents, "someone-elses"), "a");
});

test("no agents selects nothing", () => {
  assert.equal(selectAgent([], "b"), null);
});

test("the parameter is read once, trimmed, and empty means absent", () => {
  assert.equal(agentFromSearch("  b "), "b");
  assert.equal(agentFromSearch(["b", "a"]), "b");
  assert.equal(agentFromSearch(""), undefined);
  assert.equal(agentFromSearch(undefined), undefined);
});

test("the link to an agent is the studio's home with the agent on it", () => {
  // The home differs by host (`studioHref`): `/` on the studio host, `/studio` on a shared one.
  assert.equal(studioAgentHref("/", "a"), "/?agent=a");
  assert.equal(studioAgentHref("/studio", "a"), "/studio?agent=a");
  assert.equal(
    studioAgentHref("https://app.pickler.fun/", "a"),
    "https://app.pickler.fun/?agent=a",
  );
});

test("the link to no agent in particular is the studio's home", () => {
  assert.equal(studioAgentHref("/", null), "/");
  assert.equal(studioAgentHref("/studio", undefined), "/studio");
});

test("an agent id is encoded, and read back as what it was", () => {
  const href = studioAgentHref("/studio", "a b&section=x");
  assert.equal(href, "/studio?agent=a%20b%26section%3Dx");
  assert.equal(
    agentFromSearch(new URLSearchParams(href.split("?")[1]).get("agent") ?? undefined),
    "a b&section=x",
  );
});
