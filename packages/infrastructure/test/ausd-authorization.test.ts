import { test } from "node:test";
import assert from "node:assert/strict";
import { SettlementRejected, type Authorization } from "@pickler/core";
import { encodeAbiParameters, encodeEventTopics, getAddress, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  authorizationTypedData,
  createAusdAuthorizationGateway,
  transferMatches,
  type PublicClientLike,
  type WalletClientLike,
} from "../src/index.js";

const AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
const OTHER = "0x2222222222222222222222222222222222222222";
const KEY = "0x0000000000000000000000000000000000000000000000000000000000000001";
const RELAYER = "0x0000000000000000000000000000000000000000000000000000000000000002";
const PAY_TO = "0x3333333333333333333333333333333333333333";
const NONCE = `0x${"ab".repeat(32)}` as Hex;
const HASH = `0x${"cd".repeat(32)}` as Hex;
const payer = privateKeyToAccount(KEY);

function authorization(overrides: Partial<Authorization> = {}): Authorization {
  return {
    from: payer.address,
    to: PAY_TO,
    value: "250000",
    validAfter: "0",
    validBefore: "4102444800",
    nonce: NONCE,
    ...overrides,
  };
}

async function sign(value: Authorization): Promise<Hex> {
  return payer.signTypedData(authorizationTypedData(value));
}

const TRANSFER = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

function rawTransferLog(address: string, from: string, to: string, value: bigint) {
  const topics = encodeEventTopics({
    abi: TRANSFER,
    eventName: "Transfer",
    args: { from: from as `0x${string}`, to: to as `0x${string}` },
  });
  const data = encodeAbiParameters([{ type: "uint256" }], [value]);
  return { address, topics: topics as Hex[], data };
}

function decodedLog(address: string, from: string, to: string, value: bigint) {
  return { address, args: { from, to, value } };
}

const revertError = new Error("execution reverted");

function gateway(overrides: {
  simulate?: PublicClientLike["simulateContract"];
  write?: WalletClientLike["writeContract"];
  wait?: PublicClientLike["waitForTransactionReceipt"];
  read?: PublicClientLike["readContract"];
}) {
  const calls: string[] = [];
  const client: PublicClientLike = {
    readContract: overrides.read ?? (async () => false),
    simulateContract:
      overrides.simulate ??
      (async () => {
        calls.push("simulate");
        return {};
      }),
    waitForTransactionReceipt:
      overrides.wait ??
      (async () => ({
        status: "success",
        blockNumber: 77n,
        logs: [rawTransferLog(AUSD, payer.address, PAY_TO, 250000n)],
      })),
  };
  const wallet: WalletClientLike = {
    writeContract:
      overrides.write ??
      (async () => {
        calls.push("write");
        return HASH;
      }),
  };
  return {
    calls,
    gateway: createAusdAuthorizationGateway({
      rpcUrl: "http://127.0.0.1:1",
      relayerPrivateKey: RELAYER,
      client,
      wallet,
    }),
  };
}

test("authorizationTypedData uses the AUSD domain and the six standard fields", () => {
  const data = authorizationTypedData(authorization());

  assert.deepEqual(data.domain, {
    name: "Agora Dollar",
    version: "1",
    chainId: 10143,
    verifyingContract: AUSD,
  });
  assert.equal(data.primaryType, "TransferWithAuthorization");
  assert.deepEqual(
    data.types.TransferWithAuthorization.map((field) => field.name),
    ["from", "to", "value", "validAfter", "validBefore", "nonce"],
  );
});

test("signatureValid accepts the payer signature and rejects a tampered value", async () => {
  const { gateway: subject } = gateway({});
  const signed = authorization();
  const signature = await sign(signed);

  assert.equal(await subject.signatureValid(signed, signature), true);
  assert.equal(await subject.signatureValid({ ...signed, value: "250001" }, signature), false);
});

test("signatureValid never throws on malformed input", async () => {
  const { gateway: subject } = gateway({});

  assert.equal(await subject.signatureValid(authorization(), "0x1234"), false);
  assert.equal(await subject.signatureValid(authorization(), "nonsense"), false);
  assert.equal(await subject.signatureValid(authorization({ value: "abc" }), "0x"), false);
  assert.equal(await subject.signatureValid(authorization({ from: "0xnope" }), "0x"), false);
});

test("a lowercase-addressed authorization validates against checksummed typed data", async () => {
  const { gateway: subject } = gateway({});
  const checksummed = authorization({ from: getAddress(payer.address), to: getAddress(PAY_TO) });
  const lowercase = authorization({
    from: payer.address.toLowerCase(),
    to: PAY_TO.toLowerCase(),
  });
  const signature = await sign(checksummed);

  assert.equal(await subject.signatureValid(lowercase, signature), true);
});

test("transferMatches requires the AUSD address, parties and value, ignoring case", () => {
  const value = authorization();
  const good = decodedLog(AUSD, payer.address, PAY_TO, 250000n);

  assert.equal(transferMatches([good], value, AUSD), true);
  assert.equal(
    transferMatches(
      [decodedLog(AUSD.toLowerCase(), payer.address.toLowerCase(), PAY_TO.toLowerCase(), 250000n)],
      value,
      AUSD,
    ),
    true,
  );
  assert.equal(
    transferMatches([decodedLog(OTHER, payer.address, PAY_TO, 250000n)], value, AUSD),
    false,
  );
  assert.equal(
    transferMatches([decodedLog(AUSD, payer.address, PAY_TO, 249999n)], value, AUSD),
    false,
  );
  assert.equal(transferMatches([decodedLog(AUSD, OTHER, PAY_TO, 250000n)], value, AUSD), false);
  assert.equal(
    transferMatches([decodedLog(AUSD, payer.address, OTHER, 250000n)], value, AUSD),
    false,
  );
  assert.equal(transferMatches([], value, AUSD), false);
});

test("nonceUsed and balance read the latest block with the AUSD ABI", async () => {
  const requests: Record<string, unknown>[] = [];
  const { gateway: subject } = gateway({
    read: async (request) => {
      requests.push(request as unknown as Record<string, unknown>);
      return request.functionName === "balanceOf" ? 5n : true;
    },
  });

  assert.equal(await subject.nonceUsed(payer.address, NONCE), true);
  assert.equal(await subject.balance(payer.address), 5n);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.address, AUSD);
    assert.equal("blockTag" in request, false);
    assert.equal("blockNumber" in request, false);
  }
});

test("settle simulates before it broadcasts and returns the hash and block", async () => {
  const { gateway: subject, calls } = gateway({});
  const signed = authorization();

  const result = await subject.settle(signed, await sign(signed));

  assert.deepEqual(calls, ["simulate", "write"]);
  assert.deepEqual(result, { txHash: HASH, blockNumber: 77n });
});

test("a simulation revert before broadcast is a SettlementRejected and never writes", async () => {
  const { gateway: subject, calls } = gateway({
    simulate: async () => {
      throw revertError;
    },
  });
  const signed = authorization();

  await assert.rejects(
    subject.settle(signed, await sign(signed)),
    (error) => error instanceof SettlementRejected,
  );
  assert.deepEqual(calls, []);
});

test("an error from writeContract is ambiguous and stays a plain Error", async () => {
  const { gateway: subject } = gateway({
    write: async () => {
      throw new Error("socket hang up");
    },
  });
  const signed = authorization();

  await assert.rejects(
    subject.settle(signed, await sign(signed)),
    (error) => error instanceof Error && !(error instanceof SettlementRejected),
  );
});

test("a reverted receipt is a SettlementRejected", async () => {
  const { gateway: subject } = gateway({
    wait: async () => ({ status: "reverted", blockNumber: 9n, logs: [] }),
  });
  const signed = authorization();

  await assert.rejects(
    subject.settle(signed, await sign(signed)),
    (error) => error instanceof SettlementRejected,
  );
});

test("a receipt-wait timeout is a plain Error and asks for 30 seconds", async () => {
  const timeouts: number[] = [];
  const { gateway: subject } = gateway({
    wait: async (request) => {
      timeouts.push(request.timeout);
      throw new Error("Timed out while waiting for transaction");
    },
  });
  const signed = authorization();

  await assert.rejects(
    subject.settle(signed, await sign(signed)),
    (error) => error instanceof Error && !(error instanceof SettlementRejected),
  );
  assert.deepEqual(timeouts, [30_000]);
});

test("an RPC error after the hash exists is a plain Error", async () => {
  const { gateway: subject } = gateway({
    wait: async () => {
      throw new Error("HTTP request failed");
    },
  });
  const signed = authorization();

  await assert.rejects(
    subject.settle(signed, await sign(signed)),
    (error) => error instanceof Error && !(error instanceof SettlementRejected),
  );
});

test("a success receipt without the matching AUSD transfer is a plain Error", async () => {
  const { gateway: subject } = gateway({
    wait: async () => ({
      status: "success",
      blockNumber: 9n,
      logs: [rawTransferLog(OTHER, payer.address, PAY_TO, 250000n)],
    }),
  });
  const signed = authorization();

  await assert.rejects(
    subject.settle(signed, await sign(signed)),
    (error) => error instanceof Error && !(error instanceof SettlementRejected),
  );
});

const ALREADY_USED = { read: async () => true };
const STATE_READ_FAILS = {
  read: async () => {
    throw new Error("rpc down");
  },
};

test("a simulation revert with a consumed nonce is a plain Error", async () => {
  const { gateway: subject } = gateway({
    ...ALREADY_USED,
    simulate: async () => {
      throw revertError;
    },
  });
  const signed = authorization();

  await assert.rejects(
    subject.settle(signed, await sign(signed)),
    (error) => error instanceof Error && !(error instanceof SettlementRejected),
  );
});

test("a reverted receipt with a consumed nonce is a plain Error", async () => {
  const { gateway: subject } = gateway({
    ...ALREADY_USED,
    wait: async () => ({ status: "reverted", blockNumber: 9n, logs: [] }),
  });
  const signed = authorization();

  await assert.rejects(
    subject.settle(signed, await sign(signed)),
    (error) => error instanceof Error && !(error instanceof SettlementRejected),
  );
});

test("a reverted receipt whose nonce state cannot be read is a plain Error", async () => {
  const { gateway: subject } = gateway({
    ...STATE_READ_FAILS,
    wait: async () => ({ status: "reverted", blockNumber: 9n, logs: [] }),
  });
  const signed = authorization();

  await assert.rejects(
    subject.settle(signed, await sign(signed)),
    (error) => error instanceof Error && !(error instanceof SettlementRejected),
  );
});

test("a signature that cannot be parsed is rejected before anything is sent", async () => {
  const { gateway: subject, calls } = gateway({});

  await assert.rejects(
    subject.settle(authorization(), "0xzz"),
    (error) => error instanceof SettlementRejected,
  );
  assert.deepEqual(calls, []);
});

test("no settle error carries the relayer key or a cause", async () => {
  const leak = () => new Error(`failed with ${RELAYER}`);
  const failing: Parameters<typeof gateway>[0][] = [
    {
      simulate: async () => {
        throw leak();
      },
    },
    {
      write: async () => {
        throw leak();
      },
    },
    {
      wait: async () => {
        throw leak();
      },
    },
    {
      wait: async () => ({ status: "reverted", blockNumber: 9n, logs: [] }),
      read: async () => {
        throw leak();
      },
    },
  ];
  const signed = authorization();
  const signature = await sign(signed);

  for (const overrides of failing) {
    const { gateway: subject } = gateway(overrides);

    await assert.rejects(subject.settle(signed, signature), (error) => {
      return (
        error instanceof Error &&
        !error.message.includes(RELAYER.slice(2)) &&
        error.cause === undefined
      );
    });
  }
});
