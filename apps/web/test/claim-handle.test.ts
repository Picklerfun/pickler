import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAvailability, claimHandle } from "../src/features/wallet/lib/handles";

// `localProblem` and its test are not here. They need `HANDLE_RULES` and `RESERVED_HANDLES` from
// @pickler/core at run time, and apps/web cannot load that package: core publishes only an
// "import" condition and apps/web is CommonJS to node's resolver, so the import throws
// ERR_PACKAGE_PATH_NOT_EXPORTED and takes this whole file with it. The two existing apps/web tests
// that reference core say the same thing and use `import type` to stay clear of it. Restating the
// rules here instead would be the second copy the rule must not have.

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
