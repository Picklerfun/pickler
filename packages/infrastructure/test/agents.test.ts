import { test } from "node:test";
import assert from "node:assert/strict";
import { createSampleAgentDirectory, systemClock } from "../src/index.js";

test("sample directory resolves profiles and picks it lists", async () => {
  const directory = createSampleAgentDirectory(systemClock);
  const [first] = await directory.listAgents();
  const profile = await directory.getProfile(first!.ticker);
  assert.ok(profile?.calls.length);
  const pick = await directory.getPick(first!.ticker, profile!.calls[0]!.id);
  assert.equal(pick?.id, profile!.calls[0]!.id);
  assert.equal(await directory.getPick("$UNLK", profile!.calls[0]!.id), null);
  assert.equal(await directory.getProfile("$NOPE"), null);
});
