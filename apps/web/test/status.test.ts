import assert from "node:assert/strict";
import { test } from "node:test";
import { distance, matches, nearestHandles } from "../src/features/status/near";
import { ago, chainName, errorCode, handleFromPath } from "../src/features/status/words";

/* The secondary states: what they compute, one behaviour per test. */

const agents = ["halftime", "halfpipe", "hal", "counter", "nightowl"].map((handle) => ({ handle }));

test("distance counts one dropped letter as one edit", () => {
  assert.equal(distance("halftme", "halftime"), 1);
});

test("a mistyped handle's nearest match comes first", () => {
  assert.equal(nearestHandles("halftme", agents)[0]?.handle, "halftime");
});

test("a handle that shares its first three letters is close", () => {
  assert.ok(nearestHandles("halftme", agents).some((a) => a.handle === "hal"));
});

test("an unrelated handle is not offered as a close match", () => {
  assert.ok(!nearestHandles("halftme", agents).some((a) => a.handle === "counter"));
});

test("close matches stop at three", () => {
  assert.equal(nearestHandles("half", [...agents, { handle: "halfback" }]).length, 3);
});

test("the leading @ and the case of a typed handle do not matter", () => {
  assert.equal(nearestHandles("@HALFTME", agents)[0]?.handle, "halftime");
});

test("nothing typed has no close matches", () => {
  assert.deepEqual(nearestHandles("  ", agents), []);
});

test("a search matches when every word appears somewhere", () => {
  assert.equal(matches("funding sol", ["counter", "Fades funding on SOL"]), true);
});

test("a search with one word nowhere does not match", () => {
  assert.equal(matches("funding arb", ["counter", "Fades funding on SOL"]), false);
});

test("an empty search matches everything", () => {
  assert.equal(matches("   ", ["anything"]), true);
});

test("an error code carries the digest and the UTC time", () => {
  assert.equal(
    errorCode("7f3a21c0deadbeef1234", new Date("2026-09-30T14:02:11Z")),
    "ERR 7F3A21C0DEAD · 14:02:11 UTC",
  );
});

test("an error code without a digest is the time alone", () => {
  assert.equal(errorCode(undefined, new Date("2026-09-30T14:02:11Z")), "14:02:11 UTC");
});

test("under a minute offline is just now", () => {
  assert.equal(ago(0, 59_000), "just now");
});

test("minutes offline are counted in minutes", () => {
  assert.equal(ago(0, 3 * 60_000), "3 min ago");
});

test("an hour offline is counted in hours", () => {
  assert.equal(ago(0, 125 * 60_000), "2 h ago");
});

test("a known chain is named", () => {
  assert.equal(chainName(1), "Ethereum");
});

test("an unknown chain is named by its id", () => {
  assert.equal(chainName(999), "chain 999");
});

test("the handle comes out of an agent's address, decoded", () => {
  assert.equal(handleFromPath("/agents/half%20time/ask"), "half time");
});

test("a malformed escape in the address is shown as typed, not thrown", () => {
  assert.equal(handleFromPath("/agents/%E0"), "%E0");
});
