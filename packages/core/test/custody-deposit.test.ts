import { test } from "node:test";
import assert from "node:assert/strict";
import { createCustodyService } from "../src/features/wallets/application/custody.js";
import {
  AgentWalletNotFoundError,
  NoCustodyAccountError,
} from "../src/features/wallets/domain/passkey.js";
import {
  DepositsUnavailableError,
  InvalidDepositAmountError,
} from "../src/features/wallets/domain/deposit.js";
import type {
  AgentWalletActivityBuilders,
  AgentWalletRepository,
  CustodyAccount,
  CustodyRepository,
  DepositChain,
  TransferInspection,
  UnsignedActivity,
} from "../src/features/wallets/ports/custody.js";
import type { SignedActivityForwarder } from "../src/features/signing/ports/signing.js";
import {
  InvalidSignedActivityError,
  type ForwardExpectations,
  type TurnkeyActivity,
} from "../src/features/signing/domain/turnkey-activity.js";

const USER = "11111111-1111-4111-8111-111111111111";
const AGENT = "agent-1";
const MASTER = "0x1111111111111111111111111111111111111111";
const AGENT_ADDRESS = "0x2222222222222222222222222222222222222222";
const TOKEN = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
const HASH = `0x${"ab".repeat(32)}`;
const ACCOUNT: CustodyAccount = {
  userId: USER,
  subOrganizationId: "sub-ana",
  masterWalletId: "wal-master",
  rootUserId: "root-ana",
  address: MASTER,
};

/**
 * The fake chain serializes a transfer as JSON, so a test can tamper with any field of it; the
 * real adapter's RLP is tested in infrastructure.
 */
const encode = (inspection: TransferInspection) =>
  JSON.stringify(inspection, (_key, value) =>
    typeof value === "bigint" ? `${value.toString()}n` : value,
  );
const decode = (raw: string): TransferInspection | null => {
  try {
    return JSON.parse(raw, (_key, value) =>
      typeof value === "string" && /^\d+n$/.test(value) ? BigInt(value.slice(0, -1)) : value,
    ) as TransferInspection;
  } catch {
    return null;
  }
};

function fakes(options: { walletOwner?: string; linked?: boolean } = {}) {
  const state = {
    deposits: [] as { agentId: string; txHash: string; amountMicroUsd: bigint }[],
    forgotten: [] as string[],
    broadcasts: [] as string[],
    prepared: [] as { from: string; to: string; amount: bigint }[],
    forwards: [] as ForwardExpectations[],
    broadcastFails: false,
    activity: {
      id: "act-1",
      fingerprint: "f",
      status: "ACTIVITY_STATUS_COMPLETED",
      result: { signTransactionResult: { signedTransaction: "02signed" } },
    } as TurnkeyActivity,
  };

  const repository = {
    async findByUserId(userId: string) {
      return userId === USER ? ACCOUNT : null;
    },
  } as unknown as CustodyRepository;

  const owner = options.walletOwner ?? USER;
  const agentWallets = {
    async findAgentWallet(agentId: string) {
      return options.linked === false || agentId !== AGENT
        ? null
        : { walletId: "wal-agent", address: AGENT_ADDRESS };
    },
    async findOwnedAgentWallet(userId: string, walletId: string) {
      return userId === owner && walletId === "wal-agent"
        ? { walletId, address: AGENT_ADDRESS }
        : null;
    },
    async saveDeposit(input: { agentId: string; txHash: string; amountMicroUsd: bigint }) {
      state.deposits.push(input);
    },
  } as unknown as AgentWalletRepository;

  let clock = 0;
  const signTransaction: AgentWalletActivityBuilders["signTransaction"] = (input) => {
    const { subOrganizationId, timestampMs: asked, ...parameters } = input;
    const timestampMs = asked ?? String((clock += 1));
    return {
      url: "https://api.turnkey.com/public/v1/submit/sign_transaction",
      body: JSON.stringify({
        type: "ACTIVITY_TYPE_SIGN_TRANSACTION_V2",
        timestampMs,
        organizationId: subOrganizationId,
        parameters,
      }),
      timestampMs,
      organizationId: subOrganizationId,
    };
  };
  const unused = () => {
    throw new Error("not in this ceremony");
  };
  const agentActivities: AgentWalletActivityBuilders = {
    createDelegatedUser: unused,
    createAgentWallet: unused,
    createPolicies: unused,
    signTransaction,
  };

  const forwarder: SignedActivityForwarder = {
    async forward(_request, expectations) {
      state.forwards.push(expectations);
      return state.activity;
    },
  };

  const chain: DepositChain = {
    chainId: 10143,
    token: TOKEN,
    decimals: 6,
    async prepareTransfer(input) {
      state.prepared.push(input);
      return encode({
        chainId: 10143,
        to: TOKEN,
        value: 0n,
        gas: 60_000n,
        recipient: input.to,
        amount: input.amount,
      });
    },
    inspectTransfer: decode,
    async broadcast(signed) {
      state.broadcasts.push(signed);
      if (state.broadcastFails) {
        throw new Error("nonce too low");
      }
      return HASH;
    },
    forgetBalance(address) {
      state.forgotten.push(address);
    },
  };

  return { state, repository, agentWallets, agentActivities, forwarder, chain };
}

function service(f: ReturnType<typeof fakes>, withChain = true) {
  return createCustodyService({
    challenges: { put: async () => {}, consume: async () => null },
    repository: f.repository,
    turnkey: { create: async () => Promise.reject(new Error("unused")) },
    activities: {
      build: () => {
        throw new Error("unused");
      },
    },
    forwarder: f.forwarder,
    agentActivities: f.agentActivities,
    agentWallets: f.agentWallets,
    ...(withChain ? { deposits: f.chain } : {}),
    delegatedPublicKey: "02abc",
    venueContracts: [],
    rpId: "pickler.fun",
    appName: "Pickler",
    now: () => new Date("2026-09-25T12:00:00Z"),
    randomId: () => "r",
  });
}

function stamped(unsigned: UnsignedActivity, body: string = unsigned.body) {
  return {
    url: unsigned.url,
    body,
    stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "s" },
  };
}

/** The prepared activity with its transaction edited, as a tampering browser would stamp it. */
function withTransfer(unsigned: UnsignedActivity, edit: (transfer: TransferInspection) => void) {
  const body = JSON.parse(unsigned.body);
  const transfer = decode(body.parameters.unsignedTransaction)!;
  edit(transfer);
  body.parameters.unsignedTransaction = encode(transfer);
  return stamped(unsigned, JSON.stringify(body));
}

test("prepare builds a transfer of the amount in base units from the master to the agent", async () => {
  const f = fakes();

  const unsigned = await service(f).prepareDeposit(USER, AGENT, 25);

  assert.deepEqual(f.state.prepared, [{ from: MASTER, to: AGENT_ADDRESS, amount: 25_000_000n }]);
  assert.equal(unsigned.amountMicroUsd, 25_000_000n);
  assert.equal(unsigned.organizationId, "sub-ana");
  const body = JSON.parse(unsigned.body);
  assert.equal(body.parameters.signWith, MASTER);
  assert.equal(decode(body.parameters.unsignedTransaction)?.recipient, AGENT_ADDRESS);
});

test("only the offered amounts are accepted, at prepare and at confirm", async () => {
  const f = fakes();
  for (const amount of [0, 5, 11, 25.5, 1000, -10]) {
    await assert.rejects(service(f).prepareDeposit(USER, AGENT, amount), InvalidDepositAmountError);
  }
  const unsigned = await service(f).prepareDeposit(USER, AGENT, 10);
  await assert.rejects(
    service(f).confirmDeposit(USER, AGENT, 11, stamped(unsigned)),
    InvalidDepositAmountError,
  );
  assert.equal(f.state.forwards.length, 0);
});

test("an agent with no wallet, or a wallet that is not the caller's, has nothing to fund", async () => {
  await assert.rejects(
    service(fakes({ linked: false })).prepareDeposit(USER, AGENT, 10),
    AgentWalletNotFoundError,
  );
  await assert.rejects(
    service(fakes({ walletOwner: "someone-else" })).prepareDeposit(USER, AGENT, 10),
    AgentWalletNotFoundError,
  );
  await assert.rejects(
    service(fakes()).prepareDeposit("no-account", AGENT, 10),
    NoCustodyAccountError,
  );
});

test("without a composed chain, deposits are unavailable", async () => {
  await assert.rejects(
    service(fakes(), false).prepareDeposit(USER, AGENT, 10),
    DepositsUnavailableError,
  );
});

test("confirm forwards the stamp, broadcasts, forgets the balance and records the deposit", async () => {
  const f = fakes();
  const unsigned = await service(f).prepareDeposit(USER, AGENT, 50);

  const confirmed = await service(f).confirmDeposit(USER, AGENT, 50, stamped(unsigned));

  assert.deepEqual(confirmed, { txHash: HASH });
  assert.deepEqual(f.state.forwards, [
    { organizationId: "sub-ana", allowedActivityTypes: ["ACTIVITY_TYPE_SIGN_TRANSACTION_V2"] },
  ]);
  assert.deepEqual(f.state.broadcasts, ["02signed"]);
  assert.deepEqual(f.state.forgotten, [AGENT_ADDRESS]);
  assert.deepEqual(f.state.deposits, [
    { agentId: AGENT, txHash: HASH, amountMicroUsd: 50_000_000n },
  ]);
});

const tampers: [string, (transfer: TransferInspection) => void][] = [
  ["another recipient", (t) => (t.recipient = "0x3333333333333333333333333333333333333333")],
  ["another token", (t) => (t.to = "0x4444444444444444444444444444444444444444")],
  ["another amount", (t) => (t.amount = 100_000_000n)],
  ["another chain", (t) => (t.chainId = 143)],
  ["native value", (t) => (t.value = 1n)],
  ["an inflated gas limit", (t) => (t.gas = 10_000_000n)],
];

for (const [name, edit] of tampers) {
  test(`a stamped transfer with ${name} is refused before anything reaches Turnkey`, async () => {
    const f = fakes();
    const unsigned = await service(f).prepareDeposit(USER, AGENT, 25);

    await assert.rejects(
      service(f).confirmDeposit(USER, AGENT, 25, withTransfer(unsigned, edit)),
      InvalidSignedActivityError,
    );

    assert.equal(f.state.forwards.length, 0);
    assert.equal(f.state.broadcasts.length, 0);
    assert.equal(f.state.deposits.length, 0);
  });
}

test("a body that differs anywhere else, such as the signer, is refused", async () => {
  const f = fakes();
  const unsigned = await service(f).prepareDeposit(USER, AGENT, 25);
  const body = JSON.parse(unsigned.body);
  body.parameters.signWith = AGENT_ADDRESS;

  await assert.rejects(
    service(f).confirmDeposit(USER, AGENT, 25, stamped(unsigned, JSON.stringify(body))),
    InvalidSignedActivityError,
  );
  await assert.rejects(
    service(f).confirmDeposit(USER, AGENT, 25, stamped(unsigned, "{")),
    InvalidSignedActivityError,
  );
  assert.equal(f.state.forwards.length, 0);
});

test("a transaction that is not a transfer at all is refused", async () => {
  const f = fakes();
  const unsigned = await service(f).prepareDeposit(USER, AGENT, 25);
  const body = JSON.parse(unsigned.body);
  body.parameters.unsignedTransaction = "0x02deadbeef";

  await assert.rejects(
    service(f).confirmDeposit(USER, AGENT, 25, stamped(unsigned, JSON.stringify(body))),
    /not a token transfer/,
  );
});

test("a broadcast failure propagates and records nothing", async () => {
  const f = fakes();
  const unsigned = await service(f).prepareDeposit(USER, AGENT, 25);
  f.state.broadcastFails = true;

  await assert.rejects(
    service(f).confirmDeposit(USER, AGENT, 25, stamped(unsigned)),
    /nonce too low/,
  );

  assert.equal(f.state.deposits.length, 0);
  assert.equal(f.state.forgotten.length, 0);
});

test("an activity that completed without a signed transaction broadcasts nothing", async () => {
  const f = fakes();
  const unsigned = await service(f).prepareDeposit(USER, AGENT, 25);
  f.state.activity = { id: "act-1", fingerprint: "f", status: "ACTIVITY_STATUS_COMPLETED" };

  await assert.rejects(service(f).confirmDeposit(USER, AGENT, 25, stamped(unsigned)));

  assert.equal(f.state.broadcasts.length, 0);
  assert.equal(f.state.deposits.length, 0);
});
