import { test } from "node:test";
import assert from "node:assert/strict";
import { createCustodyService } from "../src/features/wallets/application/custody.js";
import {
  AgentWalletNotFoundError,
  NoCustodyAccountError,
} from "../src/features/wallets/domain/passkey.js";
import {
  DepositFeeTooHighError,
  DepositNonceError,
  DepositsUnavailableError,
  InsufficientFundsError,
  InsufficientGasError,
  InvalidTransferError,
  SignedTransactionMismatchError,
  TransferAlreadyRecordedError,
} from "../src/features/wallets/domain/deposit.js";
import type {
  AgentWalletActivityBuilders,
  AgentWalletRepository,
  AgentWalletSummary,
  CustodyAccount,
  CustodyRepository,
  DepositChain,
  NativeTransferInspection,
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
const MASTER = "0x1111111111111111111111111111111111111111";
const AGENT_ADDRESS = "0x2222222222222222222222222222222222222222";
const STRANGER = "0x3333333333333333333333333333333333333333";
const TOKEN = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
const HASH = `0x${"ab".repeat(32)}`;
const ACCOUNT: CustodyAccount = {
  userId: USER,
  subOrganizationId: "sub-ana",
  masterWalletId: "wal-master",
  rootUserId: "root-ana",
  address: MASTER,
};

type Balances = { monWei: bigint | null; ausdMicro: bigint | null };

/**
 * The fake chain serializes a transaction as JSON, so a test can tamper with any field of it; the
 * real adapter's RLP is tested in infrastructure. A token transfer carries a `recipient`; a plain
 * transfer does not, and each inspector refuses the other's shape.
 */
const encode = (inspection: TransferInspection | NativeTransferInspection) =>
  JSON.stringify(inspection, (_key, value) =>
    typeof value === "bigint" ? `${value.toString()}n` : value,
  );
const parse = (raw: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(raw, (_key, value) =>
      typeof value === "string" && /^\d+n$/.test(value) ? BigInt(value.slice(0, -1)) : value,
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
};
const decode = (raw: string): TransferInspection | null => {
  const parsed = parse(raw);
  return parsed && "recipient" in parsed ? (parsed as unknown as TransferInspection) : null;
};
const decodeNative = (raw: string): NativeTransferInspection | null => {
  const parsed = parse(raw);
  return parsed && !("recipient" in parsed)
    ? (parsed as unknown as NativeTransferInspection)
    : null;
};

function fakes(options: { walletOwner?: string } = {}) {
  const state = {
    /** Whose `wal-agent` is: another person's from the moment this changes. */
    walletOwner: options.walletOwner ?? USER,
    balances: {} as Record<string, Balances>,
    transfers: [] as Parameters<AgentWalletRepository["saveTransfer"]>[0][],
    forgotten: [] as string[],
    broadcasts: [] as string[],
    prepared: [] as { from: string; to: string; amount: bigint }[],
    preparedNative: [] as { from: string; to: string; amount: bigint }[],
    forwards: [] as ForwardExpectations[],
    nonceReads: [] as string[],
    quote: { maxFeePerGas: 102n, maxPriorityFeePerGas: 2n },
    pendingNonce: 7,
    signedMismatch: false,
    verified: [] as { signedTransaction: string; unsignedTransaction: string; signer: string }[],
    saveFails: null as Error | null,
    unrecorded: [] as Parameters<AgentWalletRepository["saveTransfer"]>[0][],
    summaries: [] as AgentWalletSummary[],
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

  const agentWallets = {
    // Like the store: only a kind='agent' wallet of this person's, never the master.
    async findOwnedAgentWallet(userId: string, walletId: string) {
      return userId === state.walletOwner && walletId === "wal-agent"
        ? { walletId, address: AGENT_ADDRESS }
        : null;
    },
    async listAgentWallets(userId: string) {
      return userId === state.walletOwner ? state.summaries : [];
    },
    async saveTransfer(input: Parameters<AgentWalletRepository["saveTransfer"]>[0]) {
      if (state.saveFails) {
        throw state.saveFails;
      }
      state.transfers.push(input);
    },
    async transferRecorded(txHash: string) {
      return state.transfers.some((transfer) => transfer.txHash === txHash.toLowerCase());
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
        nonce: 7,
        to: TOKEN,
        value: 0n,
        gas: 60_000n,
        maxFeePerGas: 102n,
        maxPriorityFeePerGas: 2n,
        recipient: input.to,
        amount: input.amount,
      });
    },
    async prepareNativeTransfer(input) {
      state.preparedNative.push(input);
      return encode({
        chainId: 10143,
        nonce: 7,
        to: input.to,
        value: input.amount,
        gas: 21_000n,
        maxFeePerGas: 102n,
        maxPriorityFeePerGas: 2n,
      });
    },
    inspectTransfer: decode,
    inspectNativeTransfer: decodeNative,
    async quoteFees() {
      return state.quote;
    },
    async pendingNonce(address) {
      state.nonceReads.push(address);
      return state.pendingNonce;
    },
    async verifySignedTransfer(input) {
      state.verified.push(input);
      if (state.signedMismatch) {
        throw new SignedTransactionMismatchError("signer");
      }
    },
    transactionHash: () => HASH,
    async broadcast(signed) {
      state.broadcasts.push(signed);
      state.pendingNonce += 1;
      return HASH;
    },
    forgetBalance(address) {
      state.forgotten.push(address);
    },
  };

  return { state, repository, agentWallets, agentActivities, forwarder, chain };
}

function deps(f: ReturnType<typeof fakes>, options: { chain?: boolean; balances?: boolean } = {}) {
  return {
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
    ...(options.chain === false ? {} : { deposits: f.chain }),
    ...(options.balances === false
      ? {}
      : {
          balances: {
            read: async (address: string) =>
              f.state.balances[address] ?? { monWei: 0n, ausdMicro: 0n },
          },
        }),
    delegatedPublicKey: "02abc",
    venueContracts: [],
    rpId: "pickler.fun",
    appName: "Pickler",
    now: () => new Date("2026-09-25T12:00:00Z"),
    randomId: () => "r",
    reportUnrecordedTransfer: (transfer: Parameters<AgentWalletRepository["saveTransfer"]>[0]) =>
      f.state.unrecorded.push(transfer),
  };
}

function stamped(unsigned: UnsignedActivity, body: string = unsigned.body) {
  return {
    url: unsigned.url,
    body,
    stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "s" },
  };
}

/** The prepared activity with its transaction edited, as a tampering browser would stamp it. */
function withTransaction(
  unsigned: UnsignedActivity,
  edit: (fields: Record<string, unknown>) => void,
) {
  const body = JSON.parse(unsigned.body);
  const fields = parse(body.parameters.unsignedTransaction)!;
  edit(fields);
  body.parameters.unsignedTransaction = encode(fields as unknown as TransferInspection);
  return stamped(unsigned, JSON.stringify(body));
}

const FUND_MON = {
  from: "master",
  to: "wal-agent",
  token: "MON",
  amount: 5n * 10n ** 17n,
} as const;
const PULL_AUSD = { from: "wal-agent", to: "master", token: "AUSD", amount: 1_000_000n } as const;

function funded() {
  const f = fakes();
  f.state.balances[MASTER] = { monWei: 10n ** 18n, ausdMicro: 50_000_000n };
  f.state.balances[AGENT_ADDRESS] = { monWei: 10n ** 18n, ausdMicro: 5_000_000n };
  return f;
}

test("funding an agent with MON prepares a plain transfer from the master to its wallet", async () => {
  const f = funded();

  const unsigned = await createCustodyService(deps(f)).prepareTransfer(USER, FUND_MON);

  assert.deepEqual(f.state.preparedNative, [
    { from: MASTER, to: AGENT_ADDRESS, amount: 5n * 10n ** 17n },
  ]);
  assert.deepEqual(f.state.prepared, []);
  assert.equal(unsigned.organizationId, "sub-ana");
  assert.equal(JSON.parse(unsigned.body).parameters.signWith, MASTER);
});

test("pulling AUSD back prepares a token transfer to the master, signed with the agent wallet's address", async () => {
  const f = funded();

  const unsigned = await createCustodyService(deps(f)).prepareTransfer(USER, PULL_AUSD);

  assert.deepEqual(f.state.prepared, [{ from: AGENT_ADDRESS, to: MASTER, amount: 1_000_000n }]);
  assert.equal(JSON.parse(unsigned.body).parameters.signWith, AGENT_ADDRESS);
});

test("a transfer between two agent wallets, or between the master and itself, is refused", async () => {
  const service = createCustodyService(deps(funded()));

  await assert.rejects(
    service.prepareTransfer(USER, { ...FUND_MON, from: "wal-agent", to: "wal-agent" }),
    InvalidTransferError,
  );
  await assert.rejects(
    service.prepareTransfer(USER, { ...FUND_MON, from: "master", to: "master" }),
    InvalidTransferError,
  );
});

test("a zero or negative amount is refused", async () => {
  const service = createCustodyService(deps(funded()));

  for (const amount of [0n, -1n]) {
    await assert.rejects(
      service.prepareTransfer(USER, { ...FUND_MON, amount }),
      InvalidTransferError,
    );
  }
});

test("a token other than AUSD or MON is refused", async () => {
  const service = createCustodyService(deps(funded()));

  await assert.rejects(
    service.prepareTransfer(USER, { ...FUND_MON, token: "ETH" as "MON" }),
    InvalidTransferError,
  );
});

test("another person's agent wallet is AgentWalletNotFoundError, before anything is built", async () => {
  const f = fakes({ walletOwner: "someone-else" });
  f.state.balances[MASTER] = { monWei: 10n ** 18n, ausdMicro: 0n };

  await assert.rejects(
    createCustodyService(deps(f)).prepareTransfer(USER, FUND_MON),
    AgentWalletNotFoundError,
  );
  assert.deepEqual(f.state.preparedNative, []);
});

test("the master wallet's own id named as the agent side is refused: only kind='agent' wallets", async () => {
  const f = funded();

  await assert.rejects(
    createCustodyService(deps(f)).prepareTransfer(USER, { ...FUND_MON, to: "wal-master" }),
    AgentWalletNotFoundError,
  );
  assert.deepEqual(f.state.preparedNative, []);
});

test("without a custody account there is nothing to transfer from", async () => {
  await assert.rejects(
    createCustodyService(deps(funded())).prepareTransfer("no-account", FUND_MON),
    NoCustodyAccountError,
  );
});

test("without a composed chain or a balance reader, transfers are unavailable", async () => {
  await assert.rejects(
    createCustodyService(deps(funded(), { chain: false })).prepareTransfer(USER, FUND_MON),
    DepositsUnavailableError,
  );
  await assert.rejects(
    createCustodyService(deps(funded(), { balances: false })).prepareTransfer(USER, FUND_MON),
    DepositsUnavailableError,
  );
});

test("more than the source holds, or a balance that could not be read, is InsufficientFundsError", async () => {
  const f = fakes();
  f.state.balances[MASTER] = { monWei: 1n, ausdMicro: 0n };
  f.state.balances[AGENT_ADDRESS] = { monWei: 10n ** 18n, ausdMicro: null };
  const service = createCustodyService(deps(f));

  await assert.rejects(
    service.prepareTransfer(USER, { ...FUND_MON, amount: 2n }),
    InsufficientFundsError,
  );
  await assert.rejects(service.prepareTransfer(USER, PULL_AUSD), InsufficientFundsError);
  assert.deepEqual(f.state.preparedNative, []);
  assert.deepEqual(f.state.prepared, []);
});

test("a confirmed MON transfer is forwarded, broadcast, both balances forgotten, and recorded", async () => {
  const f = funded();
  const service = createCustodyService(deps(f));
  const unsigned = await service.prepareTransfer(USER, FUND_MON);

  const { txHash } = await service.confirmTransfer(USER, FUND_MON, stamped(unsigned));

  assert.equal(txHash, HASH);
  assert.deepEqual(f.state.forwards, [
    { organizationId: "sub-ana", allowedActivityTypes: ["ACTIVITY_TYPE_SIGN_TRANSACTION_V2"] },
  ]);
  assert.deepEqual(f.state.broadcasts, ["02signed"]);
  assert.deepEqual(f.state.forgotten.sort(), [AGENT_ADDRESS, MASTER].sort());
  assert.deepEqual(f.state.transfers, [
    {
      userId: USER,
      fromWalletId: "wal-master",
      toWalletId: "wal-agent",
      token: "mon",
      amount: FUND_MON.amount,
      txHash: HASH,
    },
  ]);
});

test("a confirmed AUSD pull-back checks the agent wallet's nonce and signer, and records it", async () => {
  const f = funded();
  const service = createCustodyService(deps(f));
  const unsigned = await service.prepareTransfer(USER, PULL_AUSD);
  const stampedTransaction = JSON.parse(unsigned.body).parameters.unsignedTransaction;

  await service.confirmTransfer(USER, PULL_AUSD, stamped(unsigned));

  assert.deepEqual(f.state.nonceReads, [AGENT_ADDRESS]);
  assert.deepEqual(f.state.verified, [
    {
      signedTransaction: "02signed",
      unsignedTransaction: stampedTransaction,
      signer: AGENT_ADDRESS,
    },
  ]);
  assert.deepEqual(f.state.transfers, [
    {
      userId: USER,
      fromWalletId: "wal-agent",
      toWalletId: "wal-master",
      token: "ausd",
      amount: 1_000_000n,
      txHash: HASH,
    },
  ]);
});

const nativeTampers: [string, (fields: Record<string, unknown>) => void][] = [
  ["to another address", (t) => (t.to = STRANGER)],
  ["of another amount", (t) => (t.value = 6n * 10n ** 17n)],
  ["on another chain", (t) => (t.chainId = 143)],
  ["with an inflated gas limit", (t) => (t.gas = 10_000_000n)],
  ["carrying calldata, so not a plain transfer", (t) => (t.recipient = STRANGER)],
];

for (const [name, edit] of nativeTampers) {
  test(`a stamped MON transfer ${name} is refused before forwarding`, async () => {
    const f = funded();
    const service = createCustodyService(deps(f));
    const unsigned = await service.prepareTransfer(USER, FUND_MON);

    await assert.rejects(
      service.confirmTransfer(USER, FUND_MON, withTransaction(unsigned, edit)),
      InvalidSignedActivityError,
    );

    assert.equal(f.state.forwards.length, 0);
    assert.equal(f.state.broadcasts.length, 0);
    assert.equal(f.state.transfers.length, 0);
  });
}

const tokenTampers: [string, (fields: Record<string, unknown>) => void][] = [
  ["to another recipient", (t) => (t.recipient = STRANGER)],
  ["of another token", (t) => (t.to = STRANGER)],
  ["of another amount", (t) => (t.amount = 2_000_000n)],
  ["sending native value", (t) => (t.value = 1n)],
  ["with an inflated gas limit", (t) => (t.gas = 10_000_000n)],
];

for (const [name, edit] of tokenTampers) {
  test(`a stamped AUSD transfer ${name} is refused before forwarding`, async () => {
    const f = funded();
    const service = createCustodyService(deps(f));
    const unsigned = await service.prepareTransfer(USER, PULL_AUSD);

    await assert.rejects(
      service.confirmTransfer(USER, PULL_AUSD, withTransaction(unsigned, edit)),
      InvalidSignedActivityError,
    );

    assert.equal(f.state.forwards.length, 0);
    assert.equal(f.state.broadcasts.length, 0);
  });
}

test("a stamped MON transfer confirmed as AUSD, or the reverse, is refused", async () => {
  const f = funded();
  f.state.balances[MASTER] = { monWei: 10n ** 30n, ausdMicro: 10n ** 30n };
  const service = createCustodyService(deps(f));
  const mon = await service.prepareTransfer(USER, FUND_MON);
  const ausd = await service.prepareTransfer(USER, {
    ...PULL_AUSD,
    from: "master",
    to: "wal-agent",
  });

  await assert.rejects(
    service.confirmTransfer(USER, { ...FUND_MON, token: "AUSD" }, stamped(mon)),
    InvalidSignedActivityError,
  );
  await assert.rejects(
    service.confirmTransfer(
      USER,
      { from: "master", to: "wal-agent", token: "MON", amount: 1_000_000n },
      stamped(ausd),
    ),
    InvalidSignedActivityError,
  );
  assert.equal(f.state.forwards.length, 0);
});

test("a stamp prepared for one direction is refused when confirmed for the other", async () => {
  const f = funded();
  const service = createCustodyService(deps(f));
  const unsigned = await service.prepareTransfer(USER, {
    ...PULL_AUSD,
    from: "master",
    to: "wal-agent",
  });

  await assert.rejects(
    service.confirmTransfer(USER, PULL_AUSD, stamped(unsigned)),
    InvalidSignedActivityError,
  );
  assert.equal(f.state.forwards.length, 0);
});

test("a body signed with another address than the source is refused", async () => {
  const f = funded();
  const service = createCustodyService(deps(f));
  const unsigned = await service.prepareTransfer(USER, FUND_MON);
  const body = JSON.parse(unsigned.body);
  body.parameters.signWith = AGENT_ADDRESS;

  await assert.rejects(
    service.confirmTransfer(USER, FUND_MON, stamped(unsigned, JSON.stringify(body))),
    InvalidSignedActivityError,
  );
  assert.equal(f.state.forwards.length, 0);
});

test("a stamped fee over twice the fresh quote is refused before forwarding", async () => {
  const f = funded();
  const service = createCustodyService(deps(f));
  const unsigned = await service.prepareTransfer(USER, FUND_MON);

  await assert.rejects(
    service.confirmTransfer(
      USER,
      FUND_MON,
      withTransaction(unsigned, (t) => (t.maxFeePerGas = 205n)),
    ),
    DepositFeeTooHighError,
  );
  assert.equal(f.state.forwards.length, 0);
});

test("a stamped nonce above the source's pending nonce is refused before forwarding", async () => {
  const f = funded();
  const service = createCustodyService(deps(f));
  const unsigned = await service.prepareTransfer(USER, FUND_MON);
  f.state.pendingNonce = 6;

  await assert.rejects(
    service.confirmTransfer(USER, FUND_MON, stamped(unsigned)),
    DepositNonceError,
  );
  assert.equal(f.state.forwards.length, 0);
});

test("a repeated confirm after the balance dropped is still TransferAlreadyRecordedError", async () => {
  const f = funded();
  const service = createCustodyService(deps(f));
  const unsigned = await service.prepareTransfer(USER, FUND_MON);
  await service.confirmTransfer(USER, FUND_MON, stamped(unsigned));
  // Sent: the master holds less now, as the chain would show.
  f.state.balances[MASTER] = { monWei: 1n, ausdMicro: 0n };

  await assert.rejects(
    service.confirmTransfer(USER, FUND_MON, stamped(unsigned)),
    TransferAlreadyRecordedError,
  );
  assert.equal(f.state.broadcasts.length, 1);
  assert.equal(f.state.transfers.length, 1);
});

test("a retry after a failed save records the transfer the node already holds", async () => {
  const f = funded();
  const service = createCustodyService(deps(f));
  const unsigned = await service.prepareTransfer(USER, FUND_MON);
  f.state.saveFails = new Error("connection terminated");
  await assert.rejects(service.confirmTransfer(USER, FUND_MON, stamped(unsigned)));
  f.state.saveFails = null;
  f.state.balances[MASTER] = { monWei: 1n, ausdMicro: 0n };

  // The fake answers the hash again, as broadcastTransaction does for a transaction it holds.
  const { txHash } = await service.confirmTransfer(USER, FUND_MON, stamped(unsigned));

  assert.equal(txHash, HASH);
  assert.equal(f.state.transfers.length, 1);
  assert.equal(f.state.transfers[0]?.txHash, HASH);
});

test("ownership is checked again at confirm: a pull-back from a wallet no longer the caller's is refused", async () => {
  const f = funded();
  const service = createCustodyService(deps(f));
  const unsigned = await service.prepareTransfer(USER, PULL_AUSD);
  f.state.walletOwner = "someone-else";

  await assert.rejects(
    service.confirmTransfer(USER, PULL_AUSD, stamped(unsigned)),
    AgentWalletNotFoundError,
  );
  assert.equal(f.state.forwards.length, 0);
});

/** The fake's fees: gas limit × max fee of what it builds. */
const NATIVE_FEE = 21_000n * 102n;
const TOKEN_FEE = 60_000n * 102n;

test("the full MON balance is refused at prepare: the fee has nothing left to come from", async () => {
  const f = funded();
  f.state.balances[MASTER] = { monWei: FUND_MON.amount, ausdMicro: 0n };

  await assert.rejects(
    createCustodyService(deps(f)).prepareTransfer(USER, FUND_MON),
    InsufficientGasError,
  );
});

test("the amount plus exactly the fee is enough", async () => {
  const f = funded();
  f.state.balances[MASTER] = { monWei: FUND_MON.amount + NATIVE_FEE, ausdMicro: 0n };

  await createCustodyService(deps(f)).prepareTransfer(USER, FUND_MON);
});

test("an AUSD transfer needs MON for its fee in the source wallet, agent or master", async () => {
  const f = funded();
  f.state.balances[AGENT_ADDRESS] = { monWei: TOKEN_FEE - 1n, ausdMicro: 5_000_000n };
  f.state.balances[MASTER] = { monWei: null, ausdMicro: 50_000_000n };
  const service = createCustodyService(deps(f));

  await assert.rejects(service.prepareTransfer(USER, PULL_AUSD), InsufficientGasError);
  await assert.rejects(
    service.prepareTransfer(USER, { ...PULL_AUSD, from: "master", to: "wal-agent" }),
    InsufficientGasError,
  );
  f.state.balances[AGENT_ADDRESS] = { monWei: TOKEN_FEE, ausdMicro: 5_000_000n };
  await service.prepareTransfer(USER, PULL_AUSD);
});

test("wallet ids that are not strings are refused", async () => {
  const service = createCustodyService(deps(funded()));

  await assert.rejects(
    service.prepareTransfer(USER, { ...FUND_MON, to: 7 as unknown as string }),
    InvalidTransferError,
  );
  await assert.rejects(
    service.prepareTransfer(USER, { ...PULL_AUSD, from: null as unknown as string }),
    InvalidTransferError,
  );
});

test("an AUSD chain whose token is not six decimals is unavailable", async () => {
  const f = funded();
  (f.chain as { decimals: number }).decimals = 18;

  await assert.rejects(
    createCustodyService(deps(f)).prepareTransfer(USER, PULL_AUSD),
    DepositsUnavailableError,
  );
});

test("a signed transaction that does not match is never broadcast or recorded", async () => {
  const f = funded();
  const service = createCustodyService(deps(f));
  const unsigned = await service.prepareTransfer(USER, FUND_MON);
  f.state.signedMismatch = true;

  await assert.rejects(
    service.confirmTransfer(USER, FUND_MON, stamped(unsigned)),
    SignedTransactionMismatchError,
  );
  assert.equal(f.state.broadcasts.length, 0);
  assert.equal(f.state.transfers.length, 0);
});

test("a repeated confirm is TransferAlreadyRecordedError and sends nothing", async () => {
  const f = funded();
  const service = createCustodyService(deps(f));
  const unsigned = await service.prepareTransfer(USER, FUND_MON);
  f.state.transfers.push({
    userId: USER,
    fromWalletId: "wal-master",
    toWalletId: "wal-agent",
    token: "mon",
    amount: FUND_MON.amount,
    txHash: HASH,
  });

  await assert.rejects(
    service.confirmTransfer(USER, FUND_MON, stamped(unsigned)),
    TransferAlreadyRecordedError,
  );
  assert.equal(f.state.broadcasts.length, 0);
});

test("a broadcast transfer that cannot be recorded is reported for reconciliation and rethrown", async () => {
  const f = funded();
  const service = createCustodyService(deps(f));
  const unsigned = await service.prepareTransfer(USER, FUND_MON);
  const outage = new Error("connection terminated");
  f.state.saveFails = outage;

  await assert.rejects(service.confirmTransfer(USER, FUND_MON, stamped(unsigned)), outage);

  assert.equal(f.state.broadcasts.length, 1);
  assert.deepEqual(f.state.unrecorded, [
    {
      userId: USER,
      fromWalletId: "wal-master",
      toWalletId: "wal-agent",
      token: "mon",
      amount: FUND_MON.amount,
      txHash: HASH,
    },
  ]);
});

test("a duplicate refused at save is not reported as unrecorded: its row exists", async () => {
  const f = funded();
  const service = createCustodyService(deps(f));
  const unsigned = await service.prepareTransfer(USER, FUND_MON);
  f.state.saveFails = new TransferAlreadyRecordedError();

  await assert.rejects(
    service.confirmTransfer(USER, FUND_MON, stamped(unsigned)),
    TransferAlreadyRecordedError,
  );
  assert.deepEqual(f.state.unrecorded, []);
});

test("the wallet list reads the master and each agent wallet's balances", async () => {
  const f = funded();
  const summary: AgentWalletSummary = {
    walletId: "wal-agent",
    address: AGENT_ADDRESS,
    agentId: null,
    agentName: null,
    policiesApproved: false,
    caps: null,
  };
  f.state.summaries = [summary];

  const list = await createCustodyService(deps(f)).listWallets(USER);

  assert.deepEqual(list, {
    master: { address: MASTER, monWei: 10n ** 18n, ausdMicro: 50_000_000n },
    agents: [{ ...summary, monWei: 10n ** 18n, ausdMicro: 5_000_000n }],
    readAt: new Date("2026-09-25T12:00:00Z").getTime(),
  });
});

test("the wallet list needs an account and a balance reader", async () => {
  await assert.rejects(
    createCustodyService(deps(funded())).listWallets("no-account"),
    NoCustodyAccountError,
  );
  await assert.rejects(
    createCustodyService(deps(funded(), { balances: false })).listWallets(USER),
    DepositsUnavailableError,
  );
});

test("an agent wallet's balance is read for its owner only, and needs the balance reader", async () => {
  const f = funded();

  assert.deepEqual(await createCustodyService(deps(f)).walletBalance(USER, "wal-agent"), {
    monWei: 10n ** 18n,
    ausdMicro: 5_000_000n,
  });
  await assert.rejects(
    createCustodyService(deps(f)).walletBalance("someone-else", "wal-agent"),
    AgentWalletNotFoundError,
  );
  await assert.rejects(
    createCustodyService(deps(f)).walletBalance(USER, "wal-master"),
    AgentWalletNotFoundError,
  );
  await assert.rejects(
    createCustodyService(deps(f, { balances: false })).walletBalance(USER, "wal-agent"),
    DepositsUnavailableError,
  );
});
