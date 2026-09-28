import { test } from "node:test";
import assert from "node:assert/strict";
import { AUSD, MONAD_TESTNET } from "@pickler/chain";
import {
  createAusdBalanceReader,
  createJsonRpc,
  createTokenBalanceReader,
  erc20Balance,
  JsonRpcError,
  toDisplay,
  transferCalldata,
  type Rpc,
} from "../src/index.js";

const TOKEN = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
const OWNER = "0x1111111111111111111111111111111111111111";

function fakeFetch(respond: (body: { method: string; params: unknown[] }) => Response) {
  const requests: {
    url: string;
    init: RequestInit;
    body: { method: string; params: unknown[] };
  }[] = [];
  const call = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body));
    requests.push({ url: String(url), init: init!, body });
    return respond(body);
  }) as typeof fetch;
  return { call, requests };
}

const ok = (result: unknown) => Response.json({ jsonrpc: "2.0", id: 1, result });

test("the JSON-RPC client posts a 2.0 request, refuses redirects and has a timeout", async () => {
  const fake = fakeFetch(() => ok("0x1"));
  const rpc = createJsonRpc("https://rpc.example", fake.call);

  const result = await rpc.call("eth_blockNumber", []);

  assert.equal(result, "0x1");
  assert.equal(fake.requests[0]!.url, "https://rpc.example");
  assert.equal(fake.requests[0]!.init.method, "POST");
  assert.equal(fake.requests[0]!.init.redirect, "manual");
  assert.ok(fake.requests[0]!.init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(String(fake.requests[0]!.init.body)), {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_blockNumber",
    params: [],
  });
});

test("the JSON-RPC client throws on an HTTP failure and on an error payload", async () => {
  const down = createJsonRpc(
    "https://rpc.example",
    fakeFetch(() => new Response("no", { status: 502 })).call,
  );
  await assert.rejects(down.call("eth_call", []), /HTTP 502/);

  const refused = createJsonRpc(
    "https://rpc.example",
    fakeFetch(() =>
      Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "nope" } }),
    ).call,
  );
  await assert.rejects(refused.call("eth_call", []), /nope/);
});

test("erc20Balance calls balanceOf with the owner padded to 32 bytes and parses the hex", async () => {
  const fake = fakeFetch(() =>
    ok("0x00000000000000000000000000000000000000000000000000000000017d7840"),
  );
  const rpc = createJsonRpc("https://rpc.example", fake.call);

  const units = await erc20Balance(rpc, TOKEN, OWNER);

  assert.equal(units, 25_000_000n);
  assert.deepEqual(fake.requests[0]!.body, {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [
      {
        to: TOKEN,
        data: "0x70a08231" + "1111111111111111111111111111111111111111".padStart(64, "0"),
      },
      "latest",
    ],
  });
});

test("an empty or malformed eth_call result is an error, never a zero balance", async () => {
  for (const result of ["0x", "", null, 42]) {
    const rpc: Rpc = { call: async () => result };
    await assert.rejects(erc20Balance(rpc, TOKEN, OWNER));
  }
});

test("erc20Balance refuses an owner that is not an address", async () => {
  const rpc: Rpc = { call: async () => "0x0" };
  await assert.rejects(erc20Balance(rpc, TOKEN, "0x1234"), /not an address/);
});

test("transferCalldata encodes transfer(to, amount)", () => {
  assert.equal(
    transferCalldata("0x000000000000000000000000000000000000dEaD", 25_000_000n),
    "0xa9059cbb" +
      "000000000000000000000000000000000000000000000000000000000000dead" +
      "00000000000000000000000000000000000000000000000000000000017d7840",
  );
});

test("toDisplay converts base units to a display figure without rounding up", () => {
  assert.equal(toDisplay(25_000_000n, 6), 25);
  assert.equal(toDisplay(1n, 6), 0.000001);
  assert.equal(toDisplay(9_999_999n, 6), 9.999999);
  assert.equal(toDisplay(0n, 6), 0);
});

test("the token balance reader asks the chain once per TTL, and again after forget", async () => {
  let calls = 0;
  const rpc: Rpc = {
    call: async () => {
      calls++;
      return "0x" + (12_500_000).toString(16);
    },
  };
  let now = 1_000;
  const reader = createTokenBalanceReader(rpc, TOKEN, 6, 15_000, () => now);

  assert.equal(await reader.read(OWNER), 12.5);
  assert.equal(await reader.read(OWNER.toUpperCase().replace("0X", "0x")), 12.5);
  assert.equal(calls, 1);

  now += 14_999;
  await reader.read(OWNER);
  assert.equal(calls, 1);

  now += 1;
  await reader.read(OWNER);
  assert.equal(calls, 2);

  reader.forget(OWNER.toUpperCase().replace("0X", "0x"));
  await reader.read(OWNER);
  assert.equal(calls, 3);
});

test("a failed read propagates and is not cached", async () => {
  let fail = true;
  const rpc: Rpc = {
    call: async () => {
      if (fail) {
        throw new Error("rpc down");
      }
      return "0x0";
    },
  };
  const reader = createTokenBalanceReader(rpc, TOKEN, 6);

  await assert.rejects(reader.read(OWNER), /rpc down/);

  fail = false;
  assert.equal(await reader.read(OWNER), 0);
});

test("the AUSD reader defaults to Monad testnet's public endpoint and AUSD contract", async () => {
  const fake = fakeFetch(() => ok("0x" + (10_000_000).toString(16)));
  const reader = createAusdBalanceReader({ chainId: 10143, fetch: fake.call });

  assert.equal(await reader.read(OWNER), 10);
  assert.equal(fake.requests[0]!.url, MONAD_TESTNET.publicRpcUrls[0]);
  assert.deepEqual((fake.requests[0]!.body.params[0] as { to: string }).to, AUSD[10143].address);
});

test("the AUSD reader refuses an unsupported chain at composition", () => {
  assert.throws(() => createAusdBalanceReader({ chainId: 8453 }));
});

test("a JSON-RPC error keeps the node's code", async () => {
  const rpc = createJsonRpc(
    "https://rpc.example",
    fakeFetch(() =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32601, message: "Method not found" },
      }),
    ).call,
  );

  await assert.rejects(
    rpc.call("eth_maxPriorityFeePerGas", []),
    (error: unknown) =>
      error instanceof JsonRpcError &&
      error.code === -32601 &&
      error.message === "Method not found",
  );
});
