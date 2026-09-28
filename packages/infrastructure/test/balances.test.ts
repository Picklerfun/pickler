import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, parseAbi } from "viem";
import { AUSD, MONAD_MAINNET, MONAD_TESTNET } from "@pickler/chain";
import { createBalanceReader } from "../src/index.js";

const ADDRESS = "0x1111111111111111111111111111111111111122";

/**
 * `balanceOf(address)` calldata written out by hand: the 4-byte selector, then the address
 * left-padded to 32 bytes. Cross-checked against viem's encoder below so the literal itself is
 * pinned to a real ABI implementation rather than to the reader under test.
 */
const BALANCE_OF_CALLDATA =
  "0x70a082310000000000000000000000001111111111111111111111111111111111111122";

interface RpcRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: unknown[];
}

interface RecordedCall {
  url: string;
  init: RequestInit;
  request: RpcRequest;
}

interface Answer {
  status?: number;
  body?: unknown;
  throws?: Error;
}

/** A fetch that records every request it was handed and answers whatever the case asks for. */
function recordingFetch(respond: (request: RpcRequest) => Answer) {
  const calls: RecordedCall[] = [];

  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = JSON.parse(String(init?.body)) as RpcRequest;
    calls.push({ url: String(input), init: init ?? {}, request });

    const answer = respond(request);
    if (answer.throws) {
      throw answer.throws;
    }

    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { calls, fetch: fetchImpl as unknown as typeof fetch };
}

const ok = (result: string): Answer => ({ body: { jsonrpc: "2.0", id: 1, result } });

const rpcError = (message: string): Answer => ({
  body: { jsonrpc: "2.0", id: 1, error: { code: -32000, message } },
});

/** An ABI-encoded uint256 return value, as a node would send it back from eth_call. */
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;

const only = (calls: RecordedCall[], method: string) => {
  const matches = calls.filter((call) => call.request.method === method);
  assert.equal(matches.length, 1, `expected exactly one ${method} call`);
  return matches[0]!;
};

test("the hand-written balanceOf calldata matches a real ABI encoder", () => {
  const encoded = encodeFunctionData({
    abi: parseAbi(["function balanceOf(address owner) view returns (uint256)"]),
    args: [ADDRESS],
  });

  assert.equal(encoded, BALANCE_OF_CALLDATA);
});

test("it reads the native and token balances at their own decimals", async () => {
  const fake = recordingFetch((request) =>
    request.method === "eth_getBalance" ? ok("0x0de0b6b3a7640000") : ok(word(1234560n)),
  );

  const reader = createBalanceReader({ chainId: MONAD_MAINNET.chainId, fetch: fake.fetch });
  const balances = await reader.read(ADDRESS);

  assert.deepEqual(balances, {
    native: { symbol: "MON", decimals: 18, raw: "1000000000000000000" },
    token: { symbol: "AUSD", decimals: 6, raw: "1234560" },
  });

  assert.equal(fake.calls.length, 2);
  for (const call of fake.calls) {
    assert.equal(call.url, MONAD_MAINNET.publicRpcUrls[0]);
    assert.equal(call.init.method, "POST");
    assert.deepEqual(call.init.headers, { "Content-Type": "application/json" });
    assert.equal(call.init.redirect, "manual");
  }

  assert.deepEqual(only(fake.calls, "eth_getBalance").request.params, [ADDRESS, "latest"]);
  assert.deepEqual(only(fake.calls, "eth_call").request.params, [
    { to: AUSD[MONAD_MAINNET.chainId].address, data: BALANCE_OF_CALLDATA },
    "latest",
  ]);
});

test("it asks the testnet token contract when reading the testnet", async () => {
  const fake = recordingFetch(() => ok("0x0"));

  const reader = createBalanceReader({
    chainId: MONAD_TESTNET.chainId,
    fetch: fake.fetch,
  });
  await reader.read(ADDRESS);

  const call = only(fake.calls, "eth_call").request.params[0] as { to: string };
  assert.equal(call.to, AUSD[MONAD_TESTNET.chainId].address);
  assert.notEqual(call.to, AUSD[MONAD_MAINNET.chainId].address);
  assert.equal(fake.calls[0]!.url, MONAD_TESTNET.publicRpcUrls[0]);
});

test("a configured rpc url replaces the public default", async () => {
  const fake = recordingFetch(() => ok("0x0"));

  const reader = createBalanceReader({
    chainId: MONAD_MAINNET.chainId,
    rpcUrl: "https://rpc.example.invalid/key",
    fetch: fake.fetch,
  });
  await reader.read(ADDRESS);

  assert.deepEqual(
    new Set(fake.calls.map((call) => call.url)),
    new Set(["https://rpc.example.invalid/key"]),
  );
});

test("an unreachable chain yields nulls, not an invented zero", async () => {
  const fake = recordingFetch(() => ({ throws: new TypeError("fetch failed") }));

  const reader = createBalanceReader({ chainId: MONAD_MAINNET.chainId, fetch: fake.fetch });
  const balances = await reader.read(ADDRESS);

  assert.deepEqual(balances, {
    native: { symbol: "MON", decimals: 18, raw: null },
    token: { symbol: "AUSD", decimals: 6, raw: null },
  });
  assert.equal(fake.calls.length, 2);
});

test("a JSON-RPC error response yields nulls rather than throwing", async () => {
  const fake = recordingFetch(() => rpcError("execution reverted"));

  const reader = createBalanceReader({ chainId: MONAD_MAINNET.chainId, fetch: fake.fetch });
  const balances = await reader.read(ADDRESS);

  assert.equal(balances.native.raw, null);
  assert.equal(balances.token.raw, null);
});

test("a non-success HTTP response yields nulls even when it carries a result", async () => {
  const fake = recordingFetch(() => ({
    status: 429,
    body: { jsonrpc: "2.0", id: 1, result: "0x1" },
  }));

  const reader = createBalanceReader({ chainId: MONAD_MAINNET.chainId, fetch: fake.fetch });
  const balances = await reader.read(ADDRESS);

  assert.equal(balances.native.raw, null);
  assert.equal(balances.token.raw, null);
});

test("zero is reported as zero, not as unavailable", async () => {
  const fake = recordingFetch((request) =>
    request.method === "eth_getBalance" ? ok("0x0") : ok(word(0n)),
  );

  const reader = createBalanceReader({ chainId: MONAD_MAINNET.chainId, fetch: fake.fetch });
  const balances = await reader.read(ADDRESS);

  assert.equal(balances.native.raw, "0");
  assert.equal(balances.token.raw, "0");
  assert.notEqual(balances.native.raw, null);
  assert.notEqual(balances.token.raw, null);
});

test("an empty or absent result is unavailable, not zero", async () => {
  // BigInt("") is 0n, so a reader that only checks for presence turns "the node told us nothing"
  // into "this wallet holds nothing" — the exact confusion null is here to prevent.
  const empty = recordingFetch(() => ok(""));

  const reader = createBalanceReader({ chainId: MONAD_MAINNET.chainId, fetch: empty.fetch });
  const balances = await reader.read(ADDRESS);

  assert.equal(balances.native.raw, null);
  assert.equal(balances.token.raw, null);

  // "0x" is empty returndata: an eth_call that answered nothing, not a zero balance.
  const emptyReturn = recordingFetch((request) =>
    request.method === "eth_call" ? ok("0x") : ok("0x0"),
  );

  const other = createBalanceReader({ chainId: MONAD_MAINNET.chainId, fetch: emptyReturn.fetch });
  const otherBalances = await other.read(ADDRESS);

  assert.equal(otherBalances.token.raw, null);
  assert.equal(otherBalances.native.raw, "0");
});

test("one balance failing does not erase the other", async () => {
  const nativeOnly = recordingFetch((request) =>
    request.method === "eth_getBalance" ? ok("0x2a") : rpcError("execution reverted"),
  );

  const reader = createBalanceReader({ chainId: MONAD_MAINNET.chainId, fetch: nativeOnly.fetch });
  const balances = await reader.read(ADDRESS);

  assert.equal(balances.native.raw, "42");
  assert.equal(balances.token.raw, null);

  const tokenOnly = recordingFetch((request) =>
    request.method === "eth_call" ? ok(word(7n)) : rpcError("node is syncing"),
  );

  const other = createBalanceReader({ chainId: MONAD_MAINNET.chainId, fetch: tokenOnly.fetch });
  const otherBalances = await other.read(ADDRESS);

  assert.equal(otherBalances.native.raw, null);
  assert.equal(otherBalances.token.raw, "7");
});

test("an unsupported chain id is refused before any request is made", () => {
  const fake = recordingFetch(() => ok("0x0"));

  assert.throws(() => createBalanceReader({ chainId: 8453, fetch: fake.fetch }), {
    message: "Unsupported chain id 8453",
  });
  assert.equal(fake.calls.length, 0);
});

test("a malformed address is refused rather than encoded into a plausible query", async () => {
  const fake = recordingFetch(() => ok("0x0"));

  const reader = createBalanceReader({ chainId: MONAD_MAINNET.chainId, fetch: fake.fetch });

  await assert.rejects(() => reader.read("1111111111111111111111111111111111111122"), {
    message: /not an address/,
  });
  assert.equal(fake.calls.length, 0);
});
