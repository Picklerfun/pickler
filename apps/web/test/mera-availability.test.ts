import { test } from "node:test";
import assert from "node:assert/strict";
import { meraAvailability, type MeraPlace } from "../src/features/wallet/lib/mera-availability";
import { readNativeBalance } from "../src/features/wallet/lib/native-balance";

const at = (over: Partial<MeraPlace>): MeraPlace => ({
  hostname: "pickler.fun",
  studioHost: "app.pickler.fun",
  relyingParty: "pickler.fun",
  production: true,
  enabled: true,
  ...over,
});

test("the passkey wallet is offered on the marketplace's host, against its own relying party", () => {
  assert.deepEqual(meraAvailability(at({})), { offered: true, rpId: "pickler.fun", note: null });
  assert.deepEqual(meraAvailability(at({ hostname: "PICKLER.FUN" })), {
    offered: true,
    rpId: "pickler.fun",
    note: null,
  });
});

test("it is never offered on the studio's host, where the Turnkey passkeys live", () => {
  const studio = meraAvailability(at({ hostname: "app.pickler.fun" }));

  assert.equal(studio.offered, false);
  assert.match((studio as { reason: string }).reason, /marketplace/);
});

test("the studio's host is refused even when it is also named as the relying party", () => {
  // A misconfiguration that would put both kinds of passkey in one picker.
  const collided = meraAvailability(
    at({ hostname: "app.pickler.fun", relyingParty: "app.pickler.fun" }),
  );

  assert.equal(collided.offered, false);
});

test("it is not offered on any other host: a preview, a lookalike, a subdomain", () => {
  for (const hostname of ["pickler-web.workers.dev", "evilpickler.fun", "beta.pickler.fun"]) {
    const elsewhere = meraAvailability(at({ hostname }));

    assert.equal(elsewhere.offered, false, hostname);
    assert.match((elsewhere as { reason: string }).reason, /pickler\.fun/, hostname);
  }
});

test("the switch turns it off wherever it would have been offered", () => {
  assert.equal(meraAvailability(at({ enabled: false })).offered, false);
  assert.equal(
    meraAvailability(at({ hostname: "localhost", production: false, enabled: false })).offered,
    false,
  );
});

test("on localhost outside production it is offered, and says what that account is not", () => {
  const local = meraAvailability(at({ hostname: "localhost", production: false }));

  assert.equal(local.offered, true);
  assert.equal((local as { rpId: string }).rpId, "localhost");
  assert.match((local as { note: string }).note, /not your app account/);
  assert.match((local as { note: string }).note, /studio/);
});

test("localhost in a production build is just another host", () => {
  assert.equal(meraAvailability(at({ hostname: "localhost", production: true })).offered, false);
});

test("a loopback address cannot be a relying party, so development says to use localhost", () => {
  const ip = meraAvailability(at({ hostname: "127.0.0.1", production: false }));

  assert.equal(ip.offered, false);
  assert.match((ip as { reason: string }).reason, /localhost/);
});

const rpc = (result: unknown, status = 200) =>
  (async () => Response.json({ jsonrpc: "2.0", id: 1, result }, { status })) as typeof fetch;

test("a balance is read over the public endpoint, and one that was not read is null, never zero", async () => {
  assert.equal(await readNativeBalance("0xabc", "https://rpc.example", rpc("0x2a")), 42n);
  assert.equal(await readNativeBalance("0xabc", "https://rpc.example", rpc("0x")), null);
  assert.equal(await readNativeBalance("0xabc", "https://rpc.example", rpc(undefined)), null);
  assert.equal(await readNativeBalance("0xabc", "https://rpc.example", rpc("0x1", 502)), null);
  assert.equal(
    await readNativeBalance("0xabc", "https://rpc.example", (async () => {
      throw new TypeError("offline");
    }) as typeof fetch),
    null,
  );
});
