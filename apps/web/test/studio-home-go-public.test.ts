import assert from "node:assert/strict";
import { test } from "node:test";
import { goPublicSteps } from "../src/features/studio/home/go-public-model";
import { draftFixture } from "../src/features/studio/home/fixture";

const made = () => draftFixture().agent;
const byKey = (agent: Parameters<typeof goPublicSteps>[0]) =>
  Object.fromEntries(goPublicSteps(agent).map((step) => [step.key, step]));

/* The bug the end-to-end run found: a draft made with its voice, a capped wallet and 10 AUSD
   still read "A draft has no wallet yet" and four steps to go. */
test("a draft made by the create screen has only Connect X left", () => {
  const steps = byKey(made());

  assert.deepEqual(
    goPublicSteps(made()).map((step) => step.key),
    ["voice", "x", "wallet", "fund"],
  );
  assert.equal(steps.voice?.done, true);
  assert.equal(steps.voice?.note, "ANALYST · HOW EVERY TRADE READS");
  assert.equal(steps.wallet?.done, true);
  assert.equal(steps.fund?.done, true);
  assert.equal(steps.fund?.note, "10.00 AUSD IN IT");
  assert.deepEqual(steps.x, {
    key: "x",
    title: "Connect X",
    note: "WHERE IT POSTS",
    done: false,
    action: "soon",
  });
});

test("a draft pulled below 10 AUSD offers to fund it again", () => {
  const agent = made();
  const steps = byKey({ ...agent, wallet: { ...agent.wallet!, balanceAusd: 9 } });

  assert.equal(steps.fund?.done, false);
  assert.equal(steps.fund?.action, "fund");
  assert.equal(steps.fund?.note, "AT LEAST 10 AUSD");
});

test("a draft from before keeps its steps open and shut, since nothing here can add them", () => {
  const agent = made();
  const config = { ...agent.config };
  delete config.voice;
  const steps = goPublicSteps({ config, wallet: null });

  assert.equal(
    steps.every((step) => !step.done && step.action === "soon"),
    true,
  );
});
