import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { emptyPerplLiveDocument } from "@pickler/trading/perpl-live";
import { createPerplKeyVault, perplHex } from "../src/perpl/key-vault.js";
import { createPerplTradingHttp, perplKeyBinding } from "../src/perpl/trading-http.js";

async function credential() {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const vault = createPerplKeyVault("11".repeat(32));
  const document = {
    ...emptyPerplLiveDocument("0x" + "22".repeat(20), crypto.randomUUID()),
    publicKey:
      "0x" + perplHex(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
  };
  const privateHex = perplHex(
    new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
  );
  document.encryptedKey = await vault.seal(privateHex, perplKeyBinding(document, "private"));
  document.encryptedToken = await vault.seal(
    "controlled-token",
    perplKeyBinding(document, "token"),
  );
  return { vault, document, pair, privateHex };
}
test("HTTP canonical signature covers exact method, target, query, nonce and body", async () => {
  const f = await credential();
  const nonces = new Set<string>();
  const transport: typeof fetch = async (url, init) => {
    assert.equal(String(url), "https://testnet.perpl.xyz/api/v1/trading/orders");
    assert.equal(init?.redirect, "manual");
    const headers = new Headers(init?.headers);
    const nonce = headers.get("X-API-Nonce")!;
    assert.equal(nonces.has(nonce), false);
    nonces.add(nonce);
    const body = String(init?.body);
    const canonical = [
      "10143",
      "POST",
      "/v1/trading/orders",
      headers.get("X-API-Timestamp"),
      nonce,
      createHash("sha256").update(body).digest("hex"),
    ].join("\n");
    assert.equal(
      await crypto.subtle.verify(
        "Ed25519",
        f.pair.publicKey,
        Buffer.from(headers.get("X-API-Signature")!, "base64url"),
        new TextEncoder().encode(canonical),
      ),
      true,
    );
    assert.equal(headers.get("X-API-Key"), "controlled-token");
    return Response.json({ status: { code: 0 }, statuses: [{ code: 0 }] });
  };
  const client = createPerplTradingHttp(f.vault, transport);
  const request = {
    rq: 1,
    mkt: 16,
    acc: 7,
    t: 1 as const,
    p: 0 as const,
    s: 4,
    fl: 4 as const,
    ms: 50,
    lv: 100,
    lb: 120,
  };
  assert.equal(await client.submit(f.document, request, async () => {}), "accepted");
  assert.equal(await client.submit(f.document, { ...request, rq: 2 }, async () => {}), "accepted");
  assert.equal(nonces.size, 2);
  assert.equal(f.document.encryptedKey!.includes(f.privateHex), false);
  assert.equal(f.document.encryptedToken!.includes("controlled-token"), false);
});
test("GET authentication signs the exact query and empty body", async () => {
  const f = await credential();
  const target = "/v1/trading/order-history?count=100";
  const client = createPerplTradingHttp(f.vault, async (url, init) => {
    assert.equal(String(url), `https://testnet.perpl.xyz/api${target}`);
    assert.equal(init?.body, undefined);
    const headers = new Headers(init?.headers);
    const canonical = [
      "10143",
      "GET",
      target,
      headers.get("X-API-Timestamp"),
      headers.get("X-API-Nonce"),
      createHash("sha256").update("").digest("hex"),
    ].join("\n");
    assert.equal(
      await crypto.subtle.verify(
        "Ed25519",
        f.pair.publicKey,
        Buffer.from(headers.get("X-API-Signature")!, "base64url"),
        new TextEncoder().encode(canonical),
      ),
      true,
    );
    return Response.json({ d: [] });
  });
  await client.request(target, { document: f.document });
});
test("HTTP 200 with a per-order refusal is rejected, not filled", async () => {
  const f = await credential();
  const client = createPerplTradingHttp(f.vault, async () =>
    Response.json({ status: { code: 0 }, statuses: [{ code: 400 }] }),
  );
  assert.equal(
    await client.submit(
      f.document,
      { rq: 1, mkt: 16, acc: 7, t: 1, p: 0, s: 4, fl: 4, ms: 50, lv: 100, lb: 120 },
      async () => {},
    ),
    "rejected",
  );
});
test("redirects and malformed acknowledgements keep credentials isolated", async () => {
  const f = await credential();
  const redirected = createPerplTradingHttp(
    f.vault,
    async () =>
      new Response("sensitive provider body", {
        status: 302,
        headers: { Location: "https://untrusted.invalid" },
      }),
  );
  await assert.rejects(redirected.request("/v1/trading/wallet", { document: f.document }), {
    code: "PERPL_HTTP_302",
  });
  const malformed = createPerplTradingHttp(f.vault, async () =>
    Response.json({ status: { code: 0 } }),
  );
  await assert.rejects(
    malformed.submit(
      f.document,
      { rq: 1, mkt: 16, acc: 7, t: 1, p: 0, s: 4, fl: 4, ms: 50, lv: 100, lb: 120 },
      async () => {},
    ),
    { code: "PERPL_SUBMISSION_UNKNOWN" },
  );
});
test("another wallet or public key cannot decrypt this account's credential", async () => {
  const f = await credential();
  let sent = 0;
  const client = createPerplTradingHttp(f.vault, async () => {
    sent++;
    return Response.json({});
  });
  await assert.rejects(
    client.request("/v1/trading/wallet", {
      document: { ...f.document, address: "0x" + "33".repeat(20) },
    }),
    { code: "PERPL_KEY_UNAVAILABLE" },
  );
  assert.equal(sent, 0);
});
test("ownership guard runs immediately before sending a signed request", async () => {
  const f = await credential();
  let sent = 0;
  const client = createPerplTradingHttp(f.vault, async () => {
    sent++;
    return Response.json({});
  });
  await assert.rejects(
    client.request("/v1/trading/wallet", {
      document: f.document,
      guard: async () => {
        throw new Error("ownership lost");
      },
    }),
    /ownership lost/,
  );
  assert.equal(sent, 0);
});
