// Which routes a run visits, when DESIGN_ROUTES names some.
import assert from "node:assert/strict";
import test from "node:test";
import { only } from "./lib/only.mjs";

const routes = [{ name: "landing" }, { name: "agents" }, { name: "agent-ask" }];

test("without the variable every route is visited", () => {
  assert.deepEqual(only(routes, undefined), routes);
  assert.deepEqual(only(routes, ""), routes);
});

test("the routes named are visited, in the list's own order", () => {
  assert.deepEqual(only(routes, "agent-ask, landing"), [
    { name: "landing" },
    { name: "agent-ask" },
  ]);
});

test("a name that matches nothing is refused, not skipped", () => {
  assert.throws(() => only(routes, "agents,agnets"), /no such route: agnets/);
});
