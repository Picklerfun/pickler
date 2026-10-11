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
  assert.deepEqual(tokenPreview(false, true).blockers, ["GO_PUBLIC_FIRST", "LAUNCH_UNAVAILABLE"]);
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

test("inline previews match the fixed supply and never enable launching", async () => {
  const wire = await import("@pickler/api-schema");
  const business = await import("@pickler/core");
  const { AUSD } = await import("@pickler/chain");
  assert.equal(wire.AGENT_TOKEN_TOTAL_SUPPLY, business.AGENT_TOKEN_TOTAL_SUPPLY);
  assert.equal(BigInt(wire.AGENT_TOKEN_TOTAL_SUPPLY), 21_000_000n * 10n ** 18n);
  const state = wire.tokenStateSchema.parse(tokenPreview());
  assert.equal(state.economics?.totalSupply, wire.AGENT_TOKEN_TOTAL_SUPPLY);
  assert.equal(
    BigInt(state.economics!.saleAllocation) + BigInt(state.economics!.lpAllocation),
    BigInt(wire.AGENT_TOKEN_TOTAL_SUPPLY),
  );
  assert.equal(state.masterAddress, "0x5555555555555555555555555555555555555555");
  assert.equal(state.available, false);
  assert.equal(state.preset, null);
  assert.deepEqual(state.economics, business.tokenReferenceEconomics(AUSD[10143]));
});

test("legacy state without reference economics remains readable", async () => {
  const { tokenStateSchema } = await import("@pickler/api-schema");
  const legacy = tokenPreview();
  delete legacy.economics;
  const state = tokenStateSchema.parse(legacy);
  assert.equal(state.economics, undefined);
  assert.equal(state.confirmation, "absent");
  assert.equal(state.available, false);
});

test("unknown economics versions are refused instead of displaying unreviewed terms", async () => {
  const { tokenStateSchema } = await import("@pickler/api-schema");
  const state = tokenPreview();
  assert.equal(
    tokenStateSchema.safeParse({ ...state, economics: { ...state.economics, version: 3 } }).success,
    false,
  );
});

test("trade DTOs refuse arbitrary contracts, zero/overflow amounts and implicit slippage", async () => {
  const { tokenOperationInputSchema } = await import("@pickler/api-schema");
  const valid = {
    action: "buy",
    expectedVersion: 0,
    trade: { amount: "1000000", slippageBps: 50 },
  };
  assert.equal(tokenOperationInputSchema.safeParse(valid).success, true);
  for (const input of [
    { ...valid, recipient: "0x" + "8".repeat(40) },
    { ...valid, asset: "ausd" },
    { ...valid, trade: undefined },
    { ...valid, action: "launch" },
    ...["0", "01", "1e6", "-1", (2n ** 256n).toString()].map((amount) => ({
      ...valid,
      trade: { ...valid.trade, amount },
    })),
    ...[0, 101, 1.5].map((slippageBps) => ({ ...valid, trade: { ...valid.trade, slippageBps } })),
  ]) {
    assert.equal(tokenOperationInputSchema.safeParse(input).success, false);
  }
  const { readFileSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const quotes = JSON.parse(
    readFileSync(new URL("../src/features/tokens/trade-quotes.json", import.meta.url), "utf8"),
  );
  assert.equal(quotes.buy.amount, "1000000");
  assert.equal(quotes.sell.slippageBps, 50);
  execFileSync(process.execPath, [
    "--import",
    "tsx",
    "scripts/generate-token-economics.mjs",
    "--check",
  ]);
});

test("token error copy is specific, safe and separates unsent failures from reverts", async () => {
  const { tokenOperationErrorMessage, tokenRequestErrorMessage } =
    await import("../src/features/tokens/token-operation-feedback");
  assert.match(tokenOperationErrorMessage("GAS_LIMIT_EXCEEDED", false), /estimated gas exceeds/);
  assert.match(tokenOperationErrorMessage("RPC_UNAVAILABLE", false), /testnet connection/);
  assert.match(
    tokenOperationErrorMessage("METADATA_UNAVAILABLE", false),
    /metadata could not be saved/,
  );
  assert.match(
    tokenOperationErrorMessage("TRANSACTION_REVERTED", true),
    /gas may have been charged/,
  );
  const unknown = "private provider trace with credentials";
  assert.equal(tokenOperationErrorMessage(unknown, false).includes(unknown), false);
  assert.equal(tokenRequestErrorMessage(unknown).includes(unknown), false);
  assert.match(tokenOperationErrorMessage(unknown, false), /No transaction was signed or sent/);
  assert.doesNotMatch(tokenOperationErrorMessage(unknown, true), /No transaction/);
});
