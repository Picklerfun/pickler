import assert from "node:assert/strict";
import test from "node:test";
import { createPaperFundingAnchor } from "../src/persistence/paper-funding-anchor.js";
const HASH = `0x${"ab".repeat(32)}`;
const BLOCK = { number: "0x10", hash: HASH, timestamp: "0x64" };
function fixture(
  result: (method: string, params: unknown[]) => unknown = (method) =>
    method === "eth_chainId" ? "0x279f" : BLOCK,
) {
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const fetcher = async (_url: unknown, options?: RequestInit) => {
    assert.equal(options?.redirect, "error");
    const request = JSON.parse(String(options?.body));
    calls.push(request);
    return Response.json({
      jsonrpc: "2.0",
      id: request.id,
      result: result(request.method, request.params),
    });
  };
  return { calls, fetcher: fetcher as typeof fetch };
}
test("capture pins finalized identity and revalidation reads that exact block", async () => {
  const f = fixture();
  let budget = 0;
  const verify = createPaperFundingAnchor({
    chainId: 10143,
    fetch: f.fetcher,
    beforeRpc: (count) => {
      budget += count;
    },
  });
  const anchor = await verify();
  assert.deepEqual(anchor, { number: 16, hash: HASH, timestamp: 100000 });
  assert.deepEqual(await verify(anchor), anchor);
  assert.equal(budget, 4);
  assert.deepEqual(
    f.calls.filter((c) => c.method === "eth_getBlockByNumber").map((c) => c.params),
    [
      ["finalized", false],
      ["0x10", false],
    ],
  );
});
test("wrong network, reorg, null blocks and invalid envelopes cannot establish coverage", async () => {
  const f = fixture();
  const anchor = await createPaperFundingAnchor({ chainId: 10143, fetch: f.fetcher })();
  for (const answer of [
    (method: string) => (method === "eth_chainId" ? "0x1" : BLOCK),
    (method: string) =>
      method === "eth_chainId" ? "0x279f" : { ...BLOCK, hash: `0x${"cd".repeat(32)}` },
    (method: string) => (method === "eth_chainId" ? "0x279f" : null),
    (method: string) => (method === "eth_chainId" ? "0x279f" : { ...BLOCK, number: "0x11" }),
    (method: string) => (method === "eth_chainId" ? "0x279f" : { ...BLOCK, timestamp: "0x65" }),
  ]) {
    await assert.rejects(
      createPaperFundingAnchor({ chainId: 10143, fetch: fixture(answer).fetcher })(anchor),
      { code: "FUNDING_PENDING" },
    );
  }
  await assert.rejects(
    createPaperFundingAnchor({
      chainId: 10143,
      fetch: (async () =>
        Response.json({ jsonrpc: "2.0", id: 999, result: "0x279f" })) as typeof fetch,
    })(),
    { code: "FUNDING_PENDING" },
  );
});
test("request budget is shared and exhausted before sending another RPC", async () => {
  const f = fixture();
  let remaining = 2;
  const verify = createPaperFundingAnchor({
    chainId: 10143,
    fetch: f.fetcher,
    beforeRpc: () => {
      if (!remaining--) {
        throw new Error("budget");
      }
    },
  });
  const anchor = await verify();
  await assert.rejects(verify(anchor), /budget/);
  assert.equal(f.calls.length, 2);
});
test("streaming size bound refuses a body even without Content-Length", async () => {
  let cancelled = false;
  const fetcher = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(600000));
          controller.enqueue(new Uint8Array(600000));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
  await assert.rejects(
    createPaperFundingAnchor({ chainId: 10143, fetch: fetcher as typeof fetch })(),
    { code: "FUNDING_PENDING" },
  );
  assert.equal(cancelled, true);
});
test("deadline includes body consumption and cancels its stream", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelled = false;
  const promise = createPaperFundingAnchor({
    chainId: 10143,
    fetch: (async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      )) as typeof fetch,
  })();
  const rejected = assert.rejects(promise, { code: "FUNDING_PENDING" });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(10000);
  await rejected;
  assert.equal(cancelled, true);
});
test("cancelled invocations consume no request budget", async () => {
  const controller = new AbortController();
  controller.abort();
  const f = fixture();
  let budget = 0;
  await assert.rejects(
    createPaperFundingAnchor({
      chainId: 10143,
      fetch: f.fetcher,
      signal: controller.signal,
      beforeRpc: () => {
        budget++;
      },
    })(),
  );
  assert.equal(budget, 0);
  assert.equal(f.calls.length, 0);
});
