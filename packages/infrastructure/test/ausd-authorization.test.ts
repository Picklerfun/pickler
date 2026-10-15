import { test } from "node:test";
import assert from "node:assert/strict";
import { SettlementRejected, SettlementUnknown, type Authorization } from "@pickler/core";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  keccak256,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  authorizationTypedData,
  createAusdAuthorizationGateway,
  settlementTransfersMatch,
  type PublicClientLike,
  type SplitterSettleRequest,
  type WalletClientLike,
} from "../src/index.js";

const AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
const SPLITTER = "0x4444444444444444444444444444444444444444";
const TREASURY = "0x5555555555555555555555555555555555555555";
const PAYEE = "0x3333333333333333333333333333333333333333";
const OTHER = "0x2222222222222222222222222222222222222222";
const KEY = "0x0000000000000000000000000000000000000000000000000000000000000001";
const RELAYER = "0x0000000000000000000000000000000000000000000000000000000000000002";
const SALT = `0x${"5a".repeat(32)}` as Hex;
const NONCE = keccak256(
  encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [PAYEE, SALT]),
);
const HASH = `0x${"cd".repeat(32)}` as Hex;
const VALUE = 250000n;
const CREATOR = 162500n;
const PROTOCOL = 87500n;
/** From `forge test -vv` of PicklerAdviceSplitter: nonceFor(0x…dEaD, bytes32(uint256(1))). */
const CONTRACT_NONCE_VECTOR = "0xb34209a263f6c38fe55f099e9e70f9d67e93982480ff3234a5e0108028ad164d";
const payer = privateKeyToAccount(KEY);

function authorization(overrides: Partial<Authorization> = {}): Authorization {
  return {
    from: payer.address,
    to: SPLITTER,
    value: VALUE.toString(),
    validAfter: "0",
    validBefore: "4102444800",
    nonce: NONCE,
    salt: SALT,
    ...overrides,
  };
}

async function sign(value: Authorization): Promise<Hex> {
  return payer.signTypedData(authorizationTypedData(value));
}

const EVENTS = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event AdviceSettled(address indexed from, address indexed payee, bytes32 indexed nonce, uint256 value, uint256 creatorAmount, uint256 protocolAmount)",
]);

function rawTransferLog(address: string, from: string, to: string, value: bigint) {
  const topics = encodeEventTopics({
    abi: EVENTS,
    eventName: "Transfer",
    args: { from: from as `0x${string}`, to: to as `0x${string}` },
  });
  const data = encodeAbiParameters([{ type: "uint256" }], [value]);
  return { address, topics: topics as Hex[], data };
}

function rawSettledLog(
  overrides: {
    address?: string;
    from?: string;
    payee?: string;
    nonce?: Hex;
    amounts?: [bigint, bigint, bigint];
  } = {},
) {
  const topics = encodeEventTopics({
    abi: EVENTS,
    eventName: "AdviceSettled",
    args: {
      from: (overrides.from ?? payer.address) as `0x${string}`,
      payee: (overrides.payee ?? PAYEE) as `0x${string}`,
      nonce: overrides.nonce ?? NONCE,
    },
  });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    overrides.amounts ?? [VALUE, CREATOR, PROTOCOL],
  );
  return { address: overrides.address ?? SPLITTER, topics: topics as Hex[], data };
}

const PAID = rawTransferLog(AUSD, payer.address, SPLITTER, VALUE);
const TO_PAYEE = rawTransferLog(AUSD, SPLITTER, PAYEE, CREATOR);
const TO_TREASURY = rawTransferLog(AUSD, SPLITTER, TREASURY, PROTOCOL);
const SETTLED = rawSettledLog();

function success(logs: ReturnType<typeof rawTransferLog>[]) {
  return async () => ({ status: "success" as const, blockNumber: 77n, logs });
}

const revertError = new Error("execution reverted");

/** An unknown outcome: a typed `SettlementUnknown` with the broadcast hash, or null before it. */
function unknownOutcome(hash: string | null) {
  return (error: unknown) => error instanceof SettlementUnknown && error.txHash === hash;
}

type Read = PublicClientLike["readContract"];

/** Answers the AUSD reads with `authorizationState`; settle never reads the splitter. */
function reads(authorizationState: () => Promise<unknown>): Read {
  return async (request) => {
    if (request.functionName === "treasury" || request.functionName === "asset") {
      throw new Error(`settle read the splitter's ${request.functionName}()`);
    }
    return authorizationState();
  };
}

function gateway(overrides: {
  simulate?: PublicClientLike["simulateContract"];
  write?: WalletClientLike["writeContract"];
  wait?: PublicClientLike["waitForTransactionReceipt"];
  read?: Read;
  treasury?: string;
}) {
  const calls: string[] = [];
  const requests: SplitterSettleRequest[] = [];
  const client: PublicClientLike = {
    readContract: overrides.read ?? reads(async () => false),
    simulateContract:
      overrides.simulate ??
      (async (request) => {
        calls.push("simulate");
        requests.push(request);
        return {};
      }),
    waitForTransactionReceipt: overrides.wait ?? success([PAID, TO_PAYEE, TO_TREASURY, SETTLED]),
  };
  const wallet: WalletClientLike = {
    writeContract:
      overrides.write ??
      (async (request) => {
        calls.push("write");
        requests.push(request);
        return HASH;
      }),
  };
  return {
    calls,
    requests,
    gateway: createAusdAuthorizationGateway({
      rpcUrl: "http://127.0.0.1:1",
      relayerPrivateKey: RELAYER,
      splitter: SPLITTER,
      treasury: overrides.treasury ?? TREASURY,
      client,
      wallet,
    }),
  };
}

test("authorizationTypedData is a ReceiveWithAuthorization in the AUSD domain with six fields", () => {
  const data = authorizationTypedData(authorization());

  assert.deepEqual(data.domain, {
    name: "Agora Dollar",
    version: "1",
    chainId: 10143,
    verifyingContract: AUSD,
  });
  assert.equal(data.primaryType, "ReceiveWithAuthorization");
  assert.deepEqual(Object.keys(data.types), ["ReceiveWithAuthorization"]);
  assert.deepEqual(
    data.types.ReceiveWithAuthorization.map((field) => [field.name, field.type]),
    [
      ["from", "address"],
      ["to", "address"],
      ["value", "uint256"],
      ["validAfter", "uint256"],
      ["validBefore", "uint256"],
      ["nonce", "bytes32"],
    ],
  );
});

test("signatureValid accepts the payer signature and rejects a changed recipient or value", async () => {
  const { gateway: subject } = gateway({});
  const signed = authorization();
  const signature = await sign(signed);

  assert.equal(await subject.signatureValid(signed, signature), true);
  assert.equal(await subject.signatureValid({ ...signed, to: PAYEE }, signature), false);
  assert.equal(await subject.signatureValid({ ...signed, value: "250001" }, signature), false);
});

test("a phase 1 TransferWithAuthorization signature does not verify", async () => {
  const { gateway: subject } = gateway({});
  const signed = authorization();
  const typed = authorizationTypedData(signed);
  const signature = await payer.signTypedData({
    domain: typed.domain,
    types: { TransferWithAuthorization: typed.types.ReceiveWithAuthorization },
    primaryType: "TransferWithAuthorization",
    message: typed.message,
  });

  assert.equal(await subject.signatureValid(signed, signature), false);
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
  const checksummed = authorization({ from: getAddress(payer.address), to: getAddress(SPLITTER) });
  const lowercase = authorization({
    from: payer.address.toLowerCase(),
    to: SPLITTER.toLowerCase(),
  });
  const signature = await sign(checksummed);

  assert.equal(await subject.signatureValid(lowercase, signature), true);
});

test("nonceFor is keccak256(abi.encode(payee, salt)) and matches the contract's vector", () => {
  const { gateway: subject } = gateway({});
  const dead = "0x000000000000000000000000000000000000dEaD";
  const one = `0x${"00".repeat(31)}01`;
  const payee = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
  const salt = `0x${"9c".repeat(32)}`;
  const expected = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }],
      [payee.toLowerCase() as `0x${string}`, salt as Hex],
    ),
  );

  assert.equal(subject.nonceFor(dead, one), CONTRACT_NONCE_VECTOR);
  assert.equal(subject.nonceFor(dead.toLowerCase(), one), CONTRACT_NONCE_VECTOR);
  assert.equal(subject.nonceFor(payee, salt), expected);
  assert.equal(subject.nonceFor(payee.toLowerCase(), salt), expected);
  assert.notEqual(subject.nonceFor(OTHER, salt), expected);
});

test("settlementTransfersMatch requires all three AUSD transfers with their amounts", () => {
  const decode = (log: ReturnType<typeof rawTransferLog>, address = log.address) => {
    const from = `0x${log.topics[1]!.slice(26)}`;
    const to = `0x${log.topics[2]!.slice(26)}`;
    return { address, args: { from, to, value: BigInt(log.data) } };
  };
  const expected = {
    from: payer.address,
    splitter: SPLITTER,
    payee: PAYEE,
    treasury: TREASURY,
    value: VALUE,
    creator: CREATOR,
    protocol: PROTOCOL,
  };
  const all = [decode(PAID), decode(TO_PAYEE), decode(TO_TREASURY)];

  assert.equal(settlementTransfersMatch(all, expected, AUSD), true);
  assert.equal(
    settlementTransfersMatch(
      all,
      { ...expected, from: payer.address.toLowerCase(), splitter: getAddress(SPLITTER) },
      AUSD.toLowerCase(),
    ),
    true,
    "addresses compare ignoring case",
  );
  for (const missing of [0, 1, 2]) {
    const logs = all.filter((_, index) => index !== missing);

    assert.equal(settlementTransfersMatch(logs, expected, AUSD), false, `without log ${missing}`);
  }
  assert.equal(
    settlementTransfersMatch(
      [decode(PAID), decode(TO_PAYEE), decode(TO_TREASURY, OTHER)],
      expected,
      AUSD,
    ),
    false,
    "a treasury transfer of another token",
  );
  assert.equal(
    settlementTransfersMatch(all, { ...expected, protocol: PROTOCOL + 1n }, AUSD),
    false,
  );
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

test("splitterTreasury reads treasury() from the splitter once", async () => {
  const requests: Record<string, unknown>[] = [];
  const { gateway: subject } = gateway({
    read: async (request) => {
      requests.push(request as unknown as Record<string, unknown>);
      return TREASURY;
    },
  });

  assert.equal(await subject.splitterTreasury(), TREASURY);
  assert.equal(await subject.splitterTreasury(), TREASURY);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.address, SPLITTER);
  assert.equal(requests[0]!.functionName, "treasury");
});

test("a failed treasury read is not cached", async () => {
  let attempts = 0;
  const { gateway: subject } = gateway({
    read: async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error("rpc down");
      }
      return TREASURY;
    },
  });

  await assert.rejects(subject.splitterTreasury());
  assert.equal(await subject.splitterTreasury(), TREASURY);
  assert.equal(attempts, 2);
});

test("splitterAsset reads asset() from the splitter once, and a failed read is not cached", async () => {
  const requests: Record<string, unknown>[] = [];
  const { gateway: subject } = gateway({
    read: async (request) => {
      requests.push(request as unknown as Record<string, unknown>);
      if (requests.length === 1) {
        throw new Error("rpc down");
      }
      return AUSD;
    },
  });

  await assert.rejects(subject.splitterAsset());
  assert.equal(await subject.splitterAsset(), AUSD);
  assert.equal(await subject.splitterAsset(), AUSD);
  assert.equal(requests.length, 2);
  assert.equal(requests[1]!.address, SPLITTER);
  assert.equal(requests[1]!.functionName, "asset");
});

test("settle simulates and writes splitter.settle, then returns the hash, block and shares", async () => {
  const { gateway: subject, calls, requests } = gateway({});
  const signed = authorization();
  const signature = await sign(signed);

  const result = await subject.settle(signed, signature, PAYEE);

  assert.deepEqual(calls, ["simulate", "write"]);
  assert.deepEqual(result, {
    txHash: HASH,
    blockNumber: 77n,
    creatorAmount: CREATOR,
    protocolAmount: PROTOCOL,
  });
  for (const request of requests) {
    assert.equal(request.address, SPLITTER);
    assert.equal(request.functionName, "settle");
    assert.equal(request.args[0], payer.address);
    assert.deepEqual(request.args.slice(1, 6), [VALUE, 0n, 4102444800n, SALT, PAYEE]);
    assert.equal(request.args[6] === 27 || request.args[6] === 28, true);
    assert.equal(request.args.length, 9);
  }
});

test("a payee whose derived nonce is not the authorization's is rejected before anything is sent", async () => {
  const { gateway: subject, calls } = gateway({});
  const signed = authorization();

  await assert.rejects(
    subject.settle(signed, await sign(signed), OTHER),
    (error) => error instanceof SettlementRejected,
  );
  assert.deepEqual(calls, []);
});

test("a success receipt missing any of the three transfers is a SettlementUnknown with the hash", async () => {
  const cases = {
    "the treasury transfer": [PAID, TO_PAYEE, SETTLED],
    "the payee transfer": [PAID, TO_TREASURY, SETTLED],
    "the payer's transfer to the splitter": [TO_PAYEE, TO_TREASURY, SETTLED],
    "a treasury transfer to another address": [
      PAID,
      TO_PAYEE,
      rawTransferLog(AUSD, SPLITTER, OTHER, PROTOCOL),
      SETTLED,
    ],
    "a payee transfer short by one": [
      PAID,
      rawTransferLog(AUSD, SPLITTER, PAYEE, CREATOR - 1n),
      TO_TREASURY,
      SETTLED,
    ],
    "transfers of another token": [
      rawTransferLog(OTHER, payer.address, SPLITTER, VALUE),
      rawTransferLog(OTHER, SPLITTER, PAYEE, CREATOR),
      rawTransferLog(OTHER, SPLITTER, TREASURY, PROTOCOL),
      SETTLED,
    ],
  };
  const signed = authorization();
  const signature = await sign(signed);

  for (const [name, logs] of Object.entries(cases)) {
    const { gateway: subject } = gateway({ wait: success(logs) });

    await assert.rejects(subject.settle(signed, signature, PAYEE), unknownOutcome(HASH), name);
  }
});

test("a success receipt without the splitter's matching AdviceSettled is a SettlementUnknown", async () => {
  const cases = {
    "no AdviceSettled": [PAID, TO_PAYEE, TO_TREASURY],
    "another nonce": [PAID, TO_PAYEE, TO_TREASURY, rawSettledLog({ nonce: HASH })],
    "another payee": [PAID, TO_PAYEE, TO_TREASURY, rawSettledLog({ payee: OTHER })],
    "another emitter": [PAID, TO_PAYEE, TO_TREASURY, rawSettledLog({ address: OTHER })],
    "AdviceSettled alone": [SETTLED],
  };
  const signed = authorization();
  const signature = await sign(signed);

  for (const [name, logs] of Object.entries(cases)) {
    const { gateway: subject } = gateway({ wait: success(logs) });

    await assert.rejects(subject.settle(signed, signature, PAYEE), unknownOutcome(HASH), name);
  }
});

test("a success receipt settles without reading the splitter after the broadcast", async () => {
  const splitterReads: string[] = [];
  const { gateway: subject, calls } = gateway({
    read: async (request) => {
      if (request.functionName === "treasury" || request.functionName === "asset") {
        splitterReads.push(request.functionName);
        throw new Error("rpc down");
      }
      return false;
    },
  });
  const signed = authorization();

  const result = await subject.settle(signed, await sign(signed), PAYEE);

  assert.deepEqual(calls, ["simulate", "write"]);
  assert.equal(result.txHash, HASH);
  assert.deepEqual(splitterReads, [], "the expected treasury comes from the input, not the chain");
});

test("the third transfer is matched against the treasury given to the gateway", async () => {
  const { gateway: subject } = gateway({ treasury: OTHER });
  const signed = authorization();

  await assert.rejects(subject.settle(signed, await sign(signed), PAYEE), unknownOutcome(HASH));
});

test("a simulation revert before broadcast is a SettlementRejected and never writes", async () => {
  const { gateway: subject, calls } = gateway({
    simulate: async () => {
      throw revertError;
    },
  });
  const signed = authorization();

  await assert.rejects(
    subject.settle(signed, await sign(signed), PAYEE),
    (error) => error instanceof SettlementRejected,
  );
  assert.deepEqual(calls, []);
});

test("an error from writeContract is ambiguous, a SettlementUnknown without a hash", async () => {
  const { gateway: subject } = gateway({
    write: async () => {
      throw new Error("socket hang up");
    },
  });
  const signed = authorization();

  await assert.rejects(subject.settle(signed, await sign(signed), PAYEE), unknownOutcome(null));
});

test("a reverted receipt is a SettlementRejected", async () => {
  const { gateway: subject } = gateway({
    wait: async () => ({ status: "reverted", blockNumber: 9n, logs: [] }),
  });
  const signed = authorization();

  await assert.rejects(
    subject.settle(signed, await sign(signed), PAYEE),
    (error) => error instanceof SettlementRejected,
  );
});

test("a receipt-wait timeout is a SettlementUnknown with the hash and asks for 30 seconds", async () => {
  const timeouts: number[] = [];
  const { gateway: subject } = gateway({
    wait: async (request) => {
      timeouts.push(request.timeout);
      throw new Error("Timed out while waiting for transaction");
    },
  });
  const signed = authorization();

  await assert.rejects(subject.settle(signed, await sign(signed), PAYEE), unknownOutcome(HASH));
  assert.deepEqual(timeouts, [30_000]);
});

test("an RPC error after the hash exists is a SettlementUnknown with the hash", async () => {
  const { gateway: subject } = gateway({
    wait: async () => {
      throw new Error("HTTP request failed");
    },
  });
  const signed = authorization();

  await assert.rejects(subject.settle(signed, await sign(signed), PAYEE), unknownOutcome(HASH));
});

const ALREADY_USED = { read: reads(async () => true) };
const STATE_READ_FAILS = {
  read: reads(async () => {
    throw new Error("rpc down");
  }),
};

test("a simulation revert with a consumed nonce is a SettlementUnknown without a hash", async () => {
  const { gateway: subject } = gateway({
    ...ALREADY_USED,
    simulate: async () => {
      throw revertError;
    },
  });
  const signed = authorization();

  await assert.rejects(subject.settle(signed, await sign(signed), PAYEE), unknownOutcome(null));
});

test("a reverted receipt with a consumed nonce is a SettlementUnknown with the hash", async () => {
  const { gateway: subject } = gateway({
    ...ALREADY_USED,
    wait: async () => ({ status: "reverted", blockNumber: 9n, logs: [] }),
  });
  const signed = authorization();

  await assert.rejects(subject.settle(signed, await sign(signed), PAYEE), unknownOutcome(HASH));
});

test("a reverted receipt whose nonce state cannot be read is a SettlementUnknown with the hash", async () => {
  const { gateway: subject } = gateway({
    ...STATE_READ_FAILS,
    wait: async () => ({ status: "reverted", blockNumber: 9n, logs: [] }),
  });
  const signed = authorization();

  await assert.rejects(subject.settle(signed, await sign(signed), PAYEE), unknownOutcome(HASH));
});

test("the reverted-receipt state read asks AUSD for the payer's nonce", async () => {
  const requests: Record<string, unknown>[] = [];
  const { gateway: subject } = gateway({
    read: async (request) => {
      requests.push(request as unknown as Record<string, unknown>);
      return false;
    },
    wait: async () => ({ status: "reverted", blockNumber: 9n, logs: [] }),
  });
  const signed = authorization();

  await assert.rejects(subject.settle(signed, await sign(signed), PAYEE));
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.address, AUSD);
  assert.equal(requests[0]!.functionName, "authorizationState");
  assert.deepEqual(requests[0]!.args, [payer.address, NONCE]);
});

test("a signature that cannot be parsed is rejected before anything is sent", async () => {
  const { gateway: subject, calls } = gateway({});

  await assert.rejects(
    subject.settle(authorization(), "0xzz", PAYEE),
    (error) => error instanceof SettlementRejected,
  );
  assert.deepEqual(calls, []);
});

test("no settle error carries the relayer key, the signature or a cause", async () => {
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
    {
      wait: success([SETTLED]),
    },
  ];
  const signed = authorization();
  const signature = await sign(signed);

  for (const overrides of failing) {
    const { gateway: subject } = gateway(overrides);

    await assert.rejects(subject.settle(signed, signature, PAYEE), (error) => {
      return (
        error instanceof Error &&
        !error.message.includes(RELAYER.slice(2)) &&
        !JSON.stringify({ ...error, message: error.message }).includes(signature.slice(2)) &&
        error.cause === undefined
      );
    });
  }
});
