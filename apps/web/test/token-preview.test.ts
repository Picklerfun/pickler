import test from "node:test";
import assert from "node:assert/strict";
import { tokenPreview, tokenProfilePreview } from "../src/features/tokens/fixture";

import { stageFromSearch } from "../src/features/studio/home/stage";
import { draftRail } from "../src/features/studio/draft/model";
import { liveRail } from "../src/features/studio/live/model";

test("token fixtures are explicit, portable and refused in production", async () => {
  const { tokenStateSchema, agentPersonaSchema } = await import("@pickler/api-schema");
  for (const stage of ["token-empty", "token-launched"]) {
    assert.equal(tokenProfilePreview("production", "halftime", stage), null);
    assert.equal(tokenProfilePreview("development", "other", stage), null);
    const profile = agentPersonaSchema.parse(tokenProfilePreview("development", "halftime", stage));
    assert.equal(profile.launchedToken !== null, stage === "token-launched");
  }
  for (const stage of ["perpl-token-empty", "perpl-token-launched"]) {
    assert.equal(stageFromSearch("production", stage), undefined);
    assert.equal(stageFromSearch("development", stage), stage);
  }
  assert.equal(tokenStateSchema.parse(tokenPreview()).token, null);
  assert.equal(tokenStateSchema.parse(tokenPreview(true)).token?.chainId, 10143);
  assert.deepEqual(tokenPreview(false, true).blockers, ["GO_PUBLIC_FIRST"]);
});
test("both studio types expose the persistent Token route", () => {
  assert.equal(
    draftRail("token")
      .flatMap((g) => g.items)
      .find((i) => i.key === "token")?.on,
    true,
  );
  assert.equal(
    liveRail("token", { positions: 0, decisions: 0 })
      .flatMap((g) => g.items)
      .find((i) => i.key === "token")?.on,
    true,
  );
});
