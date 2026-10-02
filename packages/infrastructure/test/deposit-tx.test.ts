import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, parseTransaction, serializeTransaction, toHex, toRlp, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AUSD } from "@pickler/chain";
import { DepositNotSendableError, SignedTransactionMismatchError } from "@pickler/core";
import {
  broadcastTransaction,
  buildNativeTransferTx,
  buildTransferTx,
  createAusdDepositChain,
  inspectNativeTransfer,
  inspectTransfer,
  JsonRpcError,
  pendingNonce,
  quoteFees,
  verifySignedTransfer,
  transactionHash,
  transferCalldata,
  type Rpc,
} from "../src/index.js";

const TOKEN = AUSD[10143].address;
const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const GWEI = 1_000_000_000n;

/** Answers each method from `answers`; a function answer may throw. Records every call. */
function fakeRpc(answers: Record<string, unknown | (() => unknown)>) {
  const calls: { method: string; params: unknown[] }[] = [];
  const rpc: Rpc = {
    async call(method, params) {
      calls.push({ method, params });
      const answer = answers[method];
      if (typeof answer === "function") {
        return (answer as () => unknown)();
      }
      if (answer === undefined) {
        throw new Error(`unexpected ${method}`);
      }
      return answer;
    },
  };
  return { rpc, calls };
}

const healthy = {
  eth_getTransactionCount: "0x7",
  eth_maxPriorityFeePerGas: "0x77359400", // 2 gwei
  eth_getBlockByNumber: { baseFeePerGas: "0xba43b7400" }, // 50 gwei
  eth_estimateGas: "0xc350", // 50_000
};

test("the transfer is built from the pending nonce, the chain's fees and a padded estimate", async () => {
  const { rpc, calls } = fakeRpc(healthy);
  const data = transferCalldata(TO, 25_000_000n);

  const built = await buildTransferTx({
    rpc,
    chainId: 10143,
    token: TOKEN,
    from: FROM,
    to: TO,
    amount: 25_000_000n,
  });

  assert.deepEqual(
    calls.map((call) => call.method).sort(),
    [
      "eth_estimateGas",
      "eth_getBlockByNumber",
      "eth_getTransactionCount",
      "eth_maxPriorityFeePerGas",
    ].sort(),
  );
  const params = Object.fromEntries(calls.map((call) => [call.method, call.params]));
  assert.deepEqual(params["eth_getTransactionCount"], [FROM, "pending"]);
  assert.deepEqual(params["eth_maxPriorityFeePerGas"], []);
  assert.deepEqual(params["eth_getBlockByNumber"], ["latest", false]);
  assert.deepEqual(params["eth_estimateGas"], [{ from: FROM, to: TOKEN, data }]);

  assert.equal(built.nonce, 7);
  assert.equal(built.maxPriorityFeePerGas, 2n * GWEI);
  assert.equal(built.maxFeePerGas, 50n * GWEI * 2n + 2n * GWEI);
  assert.equal(built.gas, 60_000n);
  assert.match(built.unsignedTransaction, /^0x02[0-9a-f]+$/);
});

test("the serialized transaction parses back to a zero-value AUSD transfer on Monad testnet", async () => {
  const { rpc } = fakeRpc(healthy);

  const built = await buildTransferTx({
    rpc,
    chainId: 10143,
    token: TOKEN,
    from: FROM,
    to: TO,
    amount: 25_000_000n,
  });
  const parsed = parseTransaction(built.unsignedTransaction as `0x${string}`);

  assert.equal(parsed.type, "eip1559");
  assert.equal(parsed.chainId, 10143);
  assert.equal(parsed.to?.toLowerCase(), TOKEN.toLowerCase());
  assert.equal(parsed.data, transferCalldata(TO, 25_000_000n));
  assert.equal(parsed.value ?? 0n, 0n);
  assert.equal(parsed.nonce, 7);
  assert.equal(parsed.gas, 60_000n);
  assert.equal(parsed.maxFeePerGas, built.maxFeePerGas);
  assert.equal(parsed.maxPriorityFeePerGas, built.maxPriorityFeePerGas);
});

test("the padded estimate rounds up", async () => {
  const { rpc } = fakeRpc({ ...healthy, eth_estimateGas: "0xc351" }); // 50_001

  const built = await buildTransferTx({
    rpc,
    chainId: 10143,
    token: TOKEN,
    from: FROM,
    to: TO,
    amount: 1n,
  });

  assert.equal(built.gas, 60_002n); // 60_001.2 rounded up
});

test("an RPC without eth_maxPriorityFeePerGas falls back to a 1 gwei tip", async () => {
  for (const unsupported of [
    new JsonRpcError("the method eth_maxPriorityFeePerGas does not exist", -32601),
    new JsonRpcError("Method not found", undefined),
  ]) {
    const { rpc } = fakeRpc({
      ...healthy,
      eth_maxPriorityFeePerGas: () => {
        throw unsupported;
      },
    });

    const built = await buildTransferTx({
      rpc,
      chainId: 10143,
      token: TOKEN,
      from: FROM,
      to: TO,
      amount: 1n,
    });

    assert.equal(built.maxPriorityFeePerGas, GWEI);
    assert.equal(built.maxFeePerGas, 50n * GWEI * 2n + GWEI);
  }
});

test("any other failure of eth_maxPriorityFeePerGas propagates rather than guessing a tip", async () => {
  for (const failure of [
    new Error("eth_maxPriorityFeePerGas failed with HTTP 502"),
    new JsonRpcError("header not found", -32000),
  ]) {
    const { rpc } = fakeRpc({
      ...healthy,
      eth_maxPriorityFeePerGas: () => {
        throw failure;
      },
    });

    await assert.rejects(quoteFees(rpc), failure);
  }
});

test("the pending nonce is read with the pending tag", async () => {
  const { rpc, calls } = fakeRpc(healthy);

  assert.equal(await pendingNonce(rpc, FROM), 7);
  assert.deepEqual(calls, [{ method: "eth_getTransactionCount", params: [FROM, "pending"] }]);
});

test("a failed estimate propagates as a transfer the master wallet cannot send", async () => {
  const { rpc } = fakeRpc({
    ...healthy,
    eth_estimateGas: () => {
      throw new Error("execution reverted: transfer amount exceeds balance");
    },
  });

  await assert.rejects(
    buildTransferTx({ rpc, chainId: 10143, token: TOKEN, from: FROM, to: TO, amount: 1n }),
    (error: unknown) =>
      error instanceof DepositNotSendableError &&
      error.cause instanceof Error &&
      /exceeds balance/.test(error.cause.message),
  );
});

test("a block without a base fee or a malformed nonce is refused rather than guessed", async () => {
  const noBase = fakeRpc({ ...healthy, eth_getBlockByNumber: {} });
  await assert.rejects(
    buildTransferTx({
      rpc: noBase.rpc,
      chainId: 10143,
      token: TOKEN,
      from: FROM,
      to: TO,
      amount: 1n,
    }),
    /base fee/,
  );

  const badNonce = fakeRpc({ ...healthy, eth_getTransactionCount: "0x" });
  await assert.rejects(
    buildTransferTx({
      rpc: badNonce.rpc,
      chainId: 10143,
      token: TOKEN,
      from: FROM,
      to: TO,
      amount: 1n,
    }),
    /eth_getTransactionCount/,
  );
});

const TRANSFER = {
  type: "eip1559" as const,
  chainId: 10143,
  nonce: 3,
  to: TOKEN as Hex,
  value: 0n,
  data: transferCalldata(TO, 10_000_000n) as Hex,
  gas: 60_000n,
  maxFeePerGas: 100n,
  maxPriorityFeePerGas: 1n,
};
/** A made-up signature: the hash below does not depend on it being valid. */
const SIGNATURE = {
  r: `0x${"12".repeat(32)}` as Hex,
  s: `0x${"34".repeat(32)}` as Hex,
  yParity: 1,
};

test("inspection reads chain, token, value, gas, recipient and amount back", () => {
  assert.deepEqual(inspectTransfer(serializeTransaction(TRANSFER)), {
    chainId: 10143,
    nonce: 3,
    to: TOKEN.toLowerCase(),
    value: 0n,
    gas: 60_000n,
    maxFeePerGas: 100n,
    maxPriorityFeePerGas: 1n,
    recipient: TO,
    amount: 10_000_000n,
  });
});

test("inspection refuses anything but a bare unsigned EIP-1559 transfer", () => {
  const cases: [string, string][] = [
    ["garbage", "0x02deadbeef"],
    ["not hex", "hello"],
    [
      "legacy",
      serializeTransaction({
        type: "legacy",
        chainId: 10143,
        nonce: 3,
        to: TRANSFER.to,
        value: 0n,
        data: TRANSFER.data,
        gas: 60_000n,
        gasPrice: 100n,
      }),
    ],
    ["signed", serializeTransaction(TRANSFER, SIGNATURE)],
    [
      "approve",
      serializeTransaction({
        ...TRANSFER,
        data: `0x095ea7b3${transferCalldata(TO, 1n).slice(10)}` as Hex,
      }),
    ],
    ["trailing bytes", serializeTransaction({ ...TRANSFER, data: `${TRANSFER.data}00` as Hex })],
    [
      "dirty address word",
      serializeTransaction({
        ...TRANSFER,
        data: `0xa9059cbb${"f".repeat(24)}${TO.slice(2)}${"0".repeat(63)}1` as Hex,
      }),
    ],
    [
      "access list",
      serializeTransaction({
        ...TRANSFER,
        accessList: [{ address: TOKEN as Hex, storageKeys: [] }],
      }),
    ],
  ];
  for (const [name, raw] of cases) {
    assert.equal(inspectTransfer(raw), null, name);
  }
});

const NATIVE = {
  type: "eip1559" as const,
  chainId: 10143,
  nonce: 1,
  to: TO as Hex,
  value: 5n,
  data: "0x" as Hex,
  gas: 21_000n,
  maxFeePerGas: 3n,
  maxPriorityFeePerGas: 1n,
};

test("inspectNativeTransfer reads a plain transfer it serialized", () => {
  assert.deepEqual(inspectNativeTransfer(serializeTransaction(NATIVE)), {
    chainId: 10143,
    nonce: 1,
    to: TO,
    value: 5n,
    gas: 21_000n,
    maxFeePerGas: 3n,
    maxPriorityFeePerGas: 1n,
  });
});

test("inspectNativeTransfer refuses calldata, a signature, an access list and anything not EIP-1559", () => {
  const cases: [string, string][] = [
    ["garbage", "0x02deadbeef"],
    ["calldata", serializeTransaction({ ...NATIVE, value: 0n, data: "0xa9059cbb" })],
    ["a token transfer", serializeTransaction(TRANSFER)],
    ["signed", serializeTransaction(NATIVE, SIGNATURE)],
    [
      "access list",
      serializeTransaction({ ...NATIVE, accessList: [{ address: TO as Hex, storageKeys: [] }] }),
    ],
    [
      "legacy",
      serializeTransaction({
        type: "legacy",
        chainId: 10143,
        nonce: 1,
        to: TO as Hex,
        value: 5n,
        gas: 21_000n,
        gasPrice: 3n,
      }),
    ],
  ];
  for (const [name, raw] of cases) {
    assert.equal(inspectNativeTransfer(raw), null, name);
  }
});

test("inspectNativeTransfer refuses a contract creation, value with data, and EIP-7702 or EIP-4844 types", () => {
  const { to: _to, ...untargeted } = NATIVE;
  void _to;
  const cases: [string, string][] = [
    ["contract creation", serializeTransaction({ ...untargeted, data: "0x6000" })],
    ["value with data", serializeTransaction({ ...NATIVE, data: "0x00" })],
    [
      "eip7702",
      serializeTransaction({
        type: "eip7702",
        chainId: 10143,
        nonce: 1,
        to: TO as Hex,
        value: 5n,
        gas: 21_000n,
        maxFeePerGas: 3n,
        maxPriorityFeePerGas: 1n,
        authorizationList: [{ address: FROM as Hex, chainId: 10143, nonce: 0, ...SIGNATURE }],
      }),
    ],
    [
      "eip4844",
      serializeTransaction({
        type: "eip4844",
        chainId: 10143,
        nonce: 1,
        to: TO as Hex,
        value: 5n,
        gas: 21_000n,
        maxFeePerGas: 3n,
        maxPriorityFeePerGas: 1n,
        maxFeePerBlobGas: 1n,
        blobVersionedHashes: [`0x01${"00".repeat(31)}` as Hex],
      }),
    ],
  ];
  for (const [name, raw] of cases) {
    assert.match(raw, /^0x0[234]/, `${name} serialized`);
    assert.equal(inspectNativeTransfer(raw), null, name);
  }
});

test("a non-canonical encoding of the same plain transfer is refused", () => {
  // The NATIVE fields by hand, with the nonce encoded as 0x0001 instead of 0x01.
  const fields = (nonce: Hex) =>
    `0x02${toRlp([
      toHex(10143),
      nonce,
      toHex(1n),
      toHex(3n),
      toHex(21_000n),
      TO as Hex,
      toHex(5n),
      "0x",
      [],
    ]).slice(2)}` as Hex;
  const canonical = fields("0x01");
  const padded = fields("0x0001");
  assert.equal(canonical, serializeTransaction(NATIVE));
  assert.equal(parseTransaction(padded).nonce, 1);

  assert.notEqual(inspectNativeTransfer(canonical), null);
  assert.equal(inspectNativeTransfer(padded), null);
});

test("a plain transfer is built from the pending nonce, the chain's fees and a padded estimate of the value move", async () => {
  const { rpc, calls } = fakeRpc({ ...healthy, eth_estimateGas: "0x5208" }); // 21_000

  const unsigned = await buildNativeTransferTx({
    rpc,
    chainId: 10143,
    from: FROM,
    to: TO,
    amount: 5n * 10n ** 17n,
  });

  const params = Object.fromEntries(calls.map((call) => [call.method, call.params]));
  assert.deepEqual(params["eth_getTransactionCount"], [FROM, "pending"]);
  assert.deepEqual(params["eth_estimateGas"], [
    { from: FROM, to: TO, value: `0x${(5n * 10n ** 17n).toString(16)}` },
  ]);
  assert.deepEqual(inspectNativeTransfer(unsigned), {
    chainId: 10143,
    nonce: 7,
    to: TO,
    value: 5n * 10n ** 17n,
    gas: 25_200n,
    maxFeePerGas: 50n * GWEI * 2n + 2n * GWEI,
    maxPriorityFeePerGas: 2n * GWEI,
  });
});

test("a failed estimate of a plain transfer propagates as one the wallet cannot send", async () => {
  const { rpc } = fakeRpc({
    ...healthy,
    eth_estimateGas: () => {
      throw new JsonRpcError("insufficient funds", -32000);
    },
  });

  await assert.rejects(
    buildNativeTransferTx({ rpc, chainId: 10143, from: FROM, to: TO, amount: 1n }),
    DepositNotSendableError,
  );
});

test("a broadcast sends the signed transaction with a 0x prefix and answers its own hash", async () => {
  const signed = serializeTransaction(TRANSFER, SIGNATURE);
  const hash = keccak256(signed);
  const { rpc, calls } = fakeRpc({ eth_sendRawTransaction: hash });

  // Turnkey answers Ethereum signatures without the prefix today.
  const answered = await broadcastTransaction(rpc, signed.slice(2));

  assert.equal(answered, hash);
  assert.deepEqual(calls, [{ method: "eth_sendRawTransaction", params: [signed] }]);
});

test("a refused broadcast or a different hash from the node is an error, never a hash", async () => {
  const signed = serializeTransaction(TRANSFER, SIGNATURE);
  const refused = fakeRpc({
    eth_sendRawTransaction: () => {
      throw new Error("nonce too low");
    },
  });
  await assert.rejects(broadcastTransaction(refused.rpc, signed), /nonce too low/);

  const other = fakeRpc({ eth_sendRawTransaction: `0x${"00".repeat(32)}` });
  await assert.rejects(broadcastTransaction(other.rpc, signed), /different transaction hash/);

  const empty = fakeRpc({ eth_sendRawTransaction: "0x" });
  await assert.rejects(broadcastTransaction(empty.rpc, signed), /no transaction hash/);
});

test("the AUSD deposit chain is AUSD on the configured network and forgets through the reader", async () => {
  const forgotten: string[] = [];
  const requests: { method: string }[] = [];
  const chain = createAusdDepositChain({
    chainId: 10143,
    rpcUrl: "https://rpc.example",
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body)) as { method: string };
      requests.push(body);
      const results: Record<string, unknown> = healthy;
      return Response.json({ jsonrpc: "2.0", id: 1, result: results[body.method] });
    }) as typeof fetch,
    balances: { forget: (address) => forgotten.push(address) },
  });

  assert.equal(chain.chainId, 10143);
  assert.equal(chain.token, TOKEN);
  assert.equal(chain.decimals, 6);
  const unsigned = await chain.prepareTransfer({ from: FROM, to: TO, amount: 10_000_000n });
  assert.equal(chain.inspectTransfer(unsigned)?.recipient, TO);
  assert.equal(requests.length, 4);
  const native = await chain.prepareNativeTransfer({ from: FROM, to: TO, amount: 5n });
  assert.equal(chain.inspectNativeTransfer(native)?.value, 5n);
  chain.forgetBalance(TO);
  assert.deepEqual(forgotten, [TO]);
  assert.throws(() => createAusdDepositChain({ chainId: 1, balances: { forget: () => {} } }));
});

test("the fee quote is the one prepare builds with", async () => {
  const { rpc } = fakeRpc(healthy);

  const quote = await quoteFees(rpc);
  const built = await buildTransferTx({
    rpc,
    chainId: 10143,
    token: TOKEN,
    from: FROM,
    to: TO,
    amount: 1n,
  });

  assert.deepEqual(quote, { maxFeePerGas: 102n * GWEI, maxPriorityFeePerGas: 2n * GWEI });
  assert.equal(built.maxFeePerGas, quote.maxFeePerGas);
  assert.equal(built.maxPriorityFeePerGas, quote.maxPriorityFeePerGas);
});

test("the local hash is the keccak of the signed bytes, with or without the prefix", () => {
  const signed = serializeTransaction(TRANSFER, SIGNATURE);

  assert.equal(transactionHash(signed), keccak256(signed));
  assert.equal(transactionHash(signed.slice(2)), keccak256(signed));
});

test("a refusal for a transaction the node already holds counts as sent", async () => {
  const signed = serializeTransaction(TRANSFER, SIGNATURE);
  const hash = keccak256(signed);
  for (const message of ["already known", "nonce too low"]) {
    const { rpc, calls } = fakeRpc({
      eth_sendRawTransaction: () => {
        throw new Error(message);
      },
      eth_getTransactionByHash: { hash: hash.toUpperCase().replace("0X", "0x") },
    });

    assert.equal(await broadcastTransaction(rpc, signed), hash);
    assert.deepEqual(calls[1], { method: "eth_getTransactionByHash", params: [hash] });
  }
});

test("a refusal the node cannot back with this transaction propagates", async () => {
  const signed = serializeTransaction(TRANSFER, SIGNATURE);
  const refuse = () => {
    throw new Error("nonce too low");
  };
  for (const lookup of [
    null,
    { hash: `0x${"00".repeat(32)}` },
    () => {
      throw new Error("rpc down");
    },
  ]) {
    const { rpc } = fakeRpc({ eth_sendRawTransaction: refuse, eth_getTransactionByHash: lookup });
    await assert.rejects(broadcastTransaction(rpc, signed), /nonce too low/);
  }
});

test("a non-canonical encoding of the same transfer is refused", () => {
  // The TRANSFER fields by hand, with the nonce encoded as 0x0003 instead of 0x03.
  const fields = (nonce: Hex) =>
    `0x02${toRlp([
      toHex(10143),
      nonce,
      toHex(1n),
      toHex(100n),
      toHex(60_000n),
      TRANSFER.to,
      "0x",
      TRANSFER.data,
      [],
    ]).slice(2)}` as Hex;
  const canonical = fields("0x03");
  const padded = fields("0x0003");
  assert.equal(canonical, serializeTransaction(TRANSFER));
  // viem reads both as nonce 3, so only the encoding check tells them apart.
  assert.equal(parseTransaction(padded).nonce, 3);

  assert.notEqual(inspectTransfer(canonical), null);
  assert.equal(inspectTransfer(padded), null);
});

// A throwaway key for tests only; it holds nothing on any network.
const MASTER_KEY = `0x${"11".repeat(32)}` as Hex;
const OTHER_KEY = `0x${"22".repeat(32)}` as Hex;
const master = privateKeyToAccount(MASTER_KEY);
const other = privateKeyToAccount(OTHER_KEY);

test("a transaction signed by the master with the approved fields passes", async () => {
  const unsigned = serializeTransaction(TRANSFER);
  const signed = await master.signTransaction(TRANSFER);

  await verifySignedTransfer({
    signedTransaction: signed.slice(2),
    unsignedTransaction: unsigned,
    signer: master.address.toLowerCase(),
  });
});

test("a transaction signed by another key is refused", async () => {
  const signed = await other.signTransaction(TRANSFER);

  await assert.rejects(
    verifySignedTransfer({
      signedTransaction: signed,
      unsignedTransaction: serializeTransaction(TRANSFER),
      signer: master.address,
    }),
    (error: unknown) =>
      error instanceof SignedTransactionMismatchError && /another address/.test(error.message),
  );
});

test("a signed transaction whose fields differ from the approved one is refused", async () => {
  for (const edit of [
    { nonce: 4 },
    { to: FROM as Hex },
    { value: 1n },
    { data: transferCalldata(FROM, 10_000_000n) as Hex },
    { gas: 60_001n },
    { maxFeePerGas: 101n },
    { maxPriorityFeePerGas: 2n },
    { chainId: 143 },
  ]) {
    const signed = await master.signTransaction({ ...TRANSFER, ...edit });

    await assert.rejects(
      verifySignedTransfer({
        signedTransaction: signed,
        unsignedTransaction: serializeTransaction(TRANSFER),
        signer: master.address,
      }),
      (error: unknown) =>
        error instanceof SignedTransactionMismatchError && /fields differ/.test(error.message),
      JSON.stringify(edit, (_k, v) => (typeof v === "bigint" ? String(v) : v)),
    );
  }
});

test("an unsigned or unparseable answer is refused", async () => {
  for (const signedTransaction of [serializeTransaction(TRANSFER), "0x02dead"]) {
    await assert.rejects(
      verifySignedTransfer({
        signedTransaction,
        unsignedTransaction: serializeTransaction(TRANSFER),
        signer: master.address,
      }),
      SignedTransactionMismatchError,
    );
  }
});
