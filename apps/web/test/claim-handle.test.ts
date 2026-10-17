import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAvailability, claimHandle, localProblem } from "../src/features/wallet/lib/handles";

// The rules are passed in rather than imported. `apps/web` is CommonJS to node's resolver and
// @pickler/api-schema publishes only an "import" condition, so a module that reads its values at
// load time cannot be required from here at all — which is why none of the five apps/web modules
// that do import its values has a test. The fixtures below are deliberately NOT core's numbers:
// whether this app's copy equals core's is asserted in workers/api/test/handle-rules.test.ts,
// which is the only place that can see both packages. This file tests the branching.

const RULES = { min: 3, max: 15, pattern: /^[a-z0-9_]+$/ };
const RESERVED: ReadonlySet<string> = new Set(["admin", "pickler"]);

test("a handle shorter than the minimum is too short", () => {
  assert.equal(localProblem("ab", RULES, RESERVED), "too_short");
});

test("a handle longer than the maximum is too long", () => {
  assert.equal(localProblem("a".repeat(16), RULES, RESERVED), "too_long");
});

test("a handle outside the character class says so", () => {
  assert.equal(localProblem("has spaces", RULES, RESERVED), "invalid_characters");
});

test("a short handle is called short, not called malformed", () => {
  // This is the one ordering that is observable: every reserved handle also satisfies the pattern,
  // so those two checks are disjoint and swapping them changes nothing. Length against pattern is
  // different — "a!" fails both, and the person is better served by being told the fixable thing.
  assert.equal(localProblem("a!", RULES, RESERVED), "too_short");
});

test("a reserved handle is reserved whatever case it was typed in", () => {
  assert.equal(localProblem("Admin", RULES, RESERVED), "reserved");
});

test("surrounding whitespace is not the person's mistake", () => {
  assert.equal(localProblem("  nightowl  ", RULES, RESERVED), null);
});

test("an ordinary handle has nothing wrong with it", () => {
  assert.equal(localProblem("nightowl", RULES, RESERVED), null);
});

test("the boundary lengths are allowed, not rejected", () => {
  // `min` and `max` are inclusive; an off-by-one here refuses a name the API would accept.
  assert.equal(localProblem("abc", RULES, RESERVED), null);
  assert.equal(localProblem("a".repeat(15), RULES, RESERVED), null);
});

test("a failed availability lookup is unknown, never taken", async () => {
  const failing = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
  assert.deepEqual(await checkAvailability("nightowl", failing), { known: false });
});

test("a free handle and a taken one are both known", async () => {
  const answering = (available: boolean) =>
    (async () =>
      new Response(JSON.stringify({ data: { available } }), {
        status: 200,
      })) as unknown as typeof fetch;
  assert.deepEqual(await checkAvailability("nightowl", answering(true)), {
    known: true,
    available: true,
  });
  assert.deepEqual(await checkAvailability("nightowl", answering(false)), {
    known: true,
    available: false,
  });
});

test("a handle with regrettable characters is still asked about safely", async () => {
  // The path segment is encoded, so a handle cannot reach out of its own URL.
  let asked = "";
  const spy = (async (url: string) => {
    asked = url;
    return new Response(JSON.stringify({ data: { available: true } }), { status: 200 });
  }) as unknown as typeof fetch;
  await checkAvailability("a/../../admin", spy);
  assert.equal(asked, "/api/v1/handles/a%2F..%2F..%2Fadmin/availability");
});

test("a refused claim carries the server's words, not ours", async () => {
  const refusing = (async () =>
    new Response(JSON.stringify({ message: "That handle is taken" }), {
      status: 409,
    })) as unknown as typeof fetch;
  await assert.rejects(
    () => claimHandle({ handle: "nightowl", displayName: "Ana" }, "tok", refusing),
    (caught: Error) => caught.message === "That handle is taken",
  );
});

test("a refusal with nothing readable in it still says something", async () => {
  const broken = (async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch;
  await assert.rejects(
    () => claimHandle({ handle: "nightowl", displayName: "Ana" }, "tok", broken),
    (caught: Error) => caught.message === "That handle could not be claimed",
  );
});

test("malformed availability is unknown and requests have finite timeouts", async () => {
  const malformed = async (_url: unknown, init?: RequestInit) => {
    assert.ok(init?.signal);
    return new Response(JSON.stringify({ data: { available: "false" } }));
  };
  assert.deepEqual(await checkAvailability("nightowl", malformed as typeof fetch), {
    known: false,
  });
});
