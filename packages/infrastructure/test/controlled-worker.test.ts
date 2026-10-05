import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { installControlledStudioTransport } from "./controlled-worker.js";

test("controlled provider transport strips credentials, forbids escapes and respects cancellation", async () => {
  const original = globalThis.fetch;
  const calls: Request[] = [];
  try {
    const identity = randomUUID();
    installControlledStudioTransport(identity, async (input, init) => {
      calls.push(new Request(input, init));
      return Response.json({ controlled: true });
    });
    await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: "Bearer synthetic-secret" },
      body: JSON.stringify({ model: "test" }),
    });
    assert.equal(calls[0]!.url, "http://127.0.0.1:8798/provider");
    assert.equal(calls[0]!.headers.get("authorization"), null);
    assert.equal(calls[0]!.headers.get("x-controlled-identity"), identity);
    assert.equal(calls[0]!.redirect, "manual");
    assert.deepEqual(await calls[0]!.json(), {
      url: "https://api.typesafe.ai/v1/systemone",
      method: "POST",
      body: '{"model":"test"}',
    });

    for (const url of [
      "https://example.com",
      "http://127.0.0.1:54521/auth/v1/token",
      "http://127.0.0.1:8798/control",
      "http://127.0.0.1:55521/rest/v1/accounts",
    ]) {
      await assert.rejects(fetch(url), /unconfigured destination/);
    }
    const controller = new AbortController();
    controller.abort(new Error("cancelled before preparation"));
    await assert.rejects(
      fetch("https://testnet.perpl.xyz/api/v1/pub/context", { signal: controller.signal }),
      /cancelled before preparation/,
    );
    assert.equal(calls.length, 1);
    installControlledStudioTransport(
      identity,
      async () => new Response(null, { status: 302, headers: { Location: "https://example.com" } }),
    );
    await assert.rejects(
      fetch("https://api.turnkey.com/public/v1/submit/create_wallet"),
      /redirects/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
