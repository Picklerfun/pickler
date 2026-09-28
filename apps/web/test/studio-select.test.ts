import assert from "node:assert/strict";
import { test } from "node:test";
import { agentFromSearch, selectAgent } from "../src/features/studio/lib/select";

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
