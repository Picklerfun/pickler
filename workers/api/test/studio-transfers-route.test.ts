import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  AgentWalletNotFoundError,
  DepositFeeTooHighError,
  DepositNonceError,
  DepositNotSendableError,
  DepositsUnavailableError,
  InsufficientFundsError,
  InsufficientGasError,
  InvalidTransferError,
  TransferAlreadyRecordedError,
  InvalidSignedActivityError,
  SignedActivityRejectedError,
  SigningServiceUnavailableError,
  NoCustodyAccountError,
  SignedTransactionMismatchError,
  buildUserPrincipal,
  type ResearchRepository,
  type StudioDirectory,
  type TransferRequest,
} from "@pickler/core";
import type { AppEnv } from "../src/env.js";
import { studioRoutes } from "../src/routes/studio.js";
import { reportUnrecordedTransfer, walletBalances } from "../src/container.js";

const MASTER = "0x1111111111111111111111111111111111111111";
const AGENT_ADDRESS = "0x2222222222222222222222222222222222222222";
const SIGNED = {
  url: "https://api.turnkey.com/public/v1/submit/sign_transaction",
  body: '{"type":"ACTIVITY_TYPE_SIGN_TRANSACTION_V2"}',
  stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "c3RhbXA" },
};
const UNSIGNED = {
  url: SIGNED.url,
  body: SIGNED.body,
  timestampMs: "1758542400000",
  organizationId: "sub-ana",
};

function app({
  fail,
  custody = true,
  chainId = 10143,
}: { fail?: Error; custody?: boolean; chainId?: number | null } = {}) {
  const calls: { method: string; userId: string; request?: TransferRequest; signed?: unknown }[] =
    [];
  const directory = {
    access: async () => ({
      workspaceId: "workspace",
      tenantId: "trusted",
      ownerUserId: "user",
      role: "admin",
      enabled: true,
    }),
  } as Partial<StudioDirectory> as StudioDirectory;
  const fake = {
    async listWallets(userId: string) {
      calls.push({ method: "listWallets", userId });
      if (fail) {
        throw fail;
      }
      return {
        master: { address: MASTER, monWei: 2_000_000_000_000_000_000n, ausdMicro: 25_000_000n },
        agents: [
          {
            walletId: "wal-agent",
            address: AGENT_ADDRESS,
            agentId: "agent-1",
            agentName: "Halftime",
            policiesApproved: true,
            caps: { perTradeAusd: 5, perDayAusd: 20, maxLeverage: 1 },
            monWei: null,
            ausdMicro: 10_000_000n,
          },
        ],
        readAt: 1_758_542_400_000,
      };
    },
    async prepareTransfer(userId: string, request: TransferRequest) {
      calls.push({ method: "prepareTransfer", userId, request });
      if (fail) {
        throw fail;
      }
      return UNSIGNED;
    },
    async confirmTransfer(userId: string, request: TransferRequest, signed: unknown) {
      calls.push({ method: "confirmTransfer", userId, request, signed });
      if (fail) {
        throw fail;
      }
      return { txHash: "0xabc" };
    },
  };
  const studio = studioRoutes({
    directory,
    repository: {} as ResearchRepository,
    notifyQueued: async () => {},
    wallets: { findAgentWallet: async () => null },
    walletChainId: chainId,
    balances: { read: async () => 0 },
    ...(custody ? { custody: () => fake as never } : {}),
    authenticate: async () => ({
      principal: buildUserPrincipal({
        user: { id: "user" },
        integrator: { id: "workspace" },
        memberRole: "admin",
      }),
      workspace: null,
    }),
  });
  const root = new Hono<AppEnv>();
  root.use("*", async (c, next) => {
    c.set("requestId", "request-1");
    await next();
  });
  root.route("/", studio);
  return { root, calls };
}

const post = (payload: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
  body: JSON.stringify(payload),
});
const transfer = { from: "master", to: "wal-agent", token: "AUSD", amount: "1.5" };

test("GET /wallets answers master and agents with base units as strings", async () => {
  const f = app();
  const response = await f.root.request("/wallets", { headers: { Authorization: "Bearer t" } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    chainId: 10143,
    master: { address: MASTER, ausdMicro: "25000000", monWei: "2000000000000000000" },
    agents: [
      {
        walletId: "wal-agent",
        address: AGENT_ADDRESS,
        ausdMicro: "10000000",
        monWei: null,
        agentId: "agent-1",
        agentName: "Halftime",
        caps: { perTradeAusd: 5, perDayAusd: 20, maxLeverage: 1 },
        policiesApproved: true,
      },
    ],
    readAt: 1_758_542_400_000,
  });
  assert.deepEqual(f.calls, [{ method: "listWallets", userId: "user" }]);
});

test("wallets report the custody chain without selecting it from request parameters", async () => {
  for (const chainId of [10143, 143, null]) {
    const f = app({ chainId });
    const response = await f.root.request("/wallets?chainId=143&network=mainnet", {
      headers: { Authorization: "Bearer t" },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).chainId, chainId);
    assert.deepEqual(f.calls, [{ method: "listWallets", userId: "user" }]);
  }
});

test("a transfer prepare passes the amount in base units: 1.5 AUSD is 1500000", async () => {
  const f = app();
  const response = await f.root.request("/wallets/transfers/prepare", post(transfer));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ...UNSIGNED, baseUnits: "1500000" });
  assert.deepEqual(f.calls[0]!.request, {
    from: "master",
    to: "wal-agent",
    token: "AUSD",
    amount: 1_500_000n,
  });
});

test("a transfer of MON passes wei: 0.5 is 500000000000000000", async () => {
  const f = app();
  const response = await f.root.request(
    "/wallets/transfers/prepare",
    post({ from: "wal-agent", to: "master", token: "MON", amount: "0.5" }),
  );
  assert.equal(response.status, 200);
  assert.equal(f.calls[0]!.request!.amount, 500_000_000_000_000_000n);
  assert.equal((await response.json()).baseUnits, "500000000000000000");
});

test("a confirm passes the same request and the stamp, and answers the hash", async () => {
  const f = app();
  const response = await f.root.request(
    "/wallets/transfers/confirm",
    post({ ...transfer, amount: "10", signed: SIGNED }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { txHash: "0xabc" });
  assert.equal(f.calls[0]!.request!.amount, 10_000_000n);
  assert.deepEqual(f.calls[0]!.signed, SIGNED);
});

test("an amount with more decimals than the token has is 400", async () => {
  const f = app();
  const response = await f.root.request(
    "/wallets/transfers/prepare",
    post({ ...transfer, amount: "0.0000001" }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "INVALID_TRANSFER");
  assert.deepEqual(f.calls, []);
});

test("every malformed amount is 400 INVALID_TRANSFER before custody", async () => {
  const f = app();
  for (const amount of ["0", "0.000", "0x10", "+1", "-1", "1e6", "", " 1", "1."]) {
    const response = await f.root.request(
      "/wallets/transfers/prepare",
      post({ ...transfer, amount }),
    );
    assert.equal(response.status, 400, amount);
    assert.equal((await response.json()).error, "INVALID_TRANSFER", amount);
  }
  assert.deepEqual(f.calls, []);
});

test("an unknown token or a field too many is 400 before custody", async () => {
  const f = app();
  for (const payload of [
    { ...transfer, token: "USDC" },
    { ...transfer, extra: true },
  ]) {
    const response = await f.root.request("/wallets/transfers/prepare", post(payload));
    assert.equal(response.status, 400, JSON.stringify(payload));
  }
  const unstamped = await f.root.request("/wallets/transfers/confirm", post(transfer));
  assert.equal(unstamped.status, 400);
  assert.deepEqual(f.calls, []);
});

const refusals: [string, Error, number, string][] = [
  ["InsufficientFundsError", new InsufficientFundsError(), 409, "INSUFFICIENT_FUNDS"],
  ["InsufficientGasError", new InsufficientGasError(), 409, "INSUFFICIENT_GAS"],
  ["InvalidTransferError", new InvalidTransferError("No"), 400, "INVALID_TRANSFER"],
  [
    "TransferAlreadyRecordedError",
    new TransferAlreadyRecordedError(),
    409,
    "TRANSFER_ALREADY_RECORDED",
  ],
  ["AgentWalletNotFoundError", new AgentWalletNotFoundError(), 404, "WALLET_NOT_FOUND"],
  [
    "InvalidSignedActivityError",
    new InvalidSignedActivityError("The stamped transaction pays another wallet"),
    400,
    "INVALID_SIGNED_ACTIVITY",
  ],
  [
    "SignedActivityRejectedError",
    new SignedActivityRejectedError("policy denied"),
    400,
    "SIGNED_ACTIVITY_REJECTED",
  ],
  [
    "SigningServiceUnavailableError",
    new SigningServiceUnavailableError("upstream said 503"),
    502,
    "SIGNING_UNAVAILABLE",
  ],
  ["NoCustodyAccountError", new NoCustodyAccountError(), 409, "NO_CUSTODY_ACCOUNT"],
];
for (const [name, error, status, code] of refusals) {
  test(`${name} is ${status} ${code}`, async () => {
    const f = app({ fail: error });
    const response = await f.root.request(
      "/wallets/transfers/confirm",
      post({ ...transfer, signed: SIGNED }),
    );
    assert.equal(response.status, status);
    const json = await response.json();
    assert.equal(json.error, code);
    assert.equal(typeof json.message, "string");
  });
}

// The deposit's errors, reused by transfers, answer in words about transfers, not deposits.
const neutral: [string, Error, number, string][] = [
  ["DepositFeeTooHighError", new DepositFeeTooHighError(), 400, "FEE_TOO_HIGH"],
  ["DepositNonceError", new DepositNonceError(), 400, "NONCE_GAP"],
  ["DepositNotSendableError", new DepositNotSendableError(), 409, "NOT_SENDABLE"],
  ["DepositsUnavailableError", new DepositsUnavailableError(), 503, "WALLETS_UNAVAILABLE"],
];
for (const [name, error, status, code] of neutral) {
  test(`a transfer's ${name} is ${status} ${code}, with no deposit wording`, async () => {
    const f = app({ fail: error });
    const response = await f.root.request("/wallets/transfers/prepare", post(transfer));
    assert.equal(response.status, status);
    const json = await response.json();
    assert.equal(json.error, code);
    assert.doesNotMatch(JSON.stringify(json), /deposit/i);
  });
}

test("a signed transaction mismatch is 500 SIGNED_TX_MISMATCH, logged without deposit wording", async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  const f = app({ fail: new SignedTransactionMismatchError("signer") });
  const response = await f.root.request(
    "/wallets/transfers/confirm",
    post({ ...transfer, signed: SIGNED }),
  );
  assert.equal(response.status, 500);
  const answer = await response.json();
  assert.equal(answer.error, "SIGNED_TX_MISMATCH");
  assert.equal(logged[0]![0], "Signed transaction mismatch");
  assert.doesNotMatch(JSON.stringify([logged, answer]), /deposit/i);
});

test("without custody the wallet routes are 503 WALLETS_UNAVAILABLE", async () => {
  const f = app({ custody: false });
  const listed = await f.root.request("/wallets", { headers: { Authorization: "Bearer t" } });
  assert.equal(listed.status, 503);
  assert.equal((await listed.json()).error, "WALLETS_UNAVAILABLE");
  const prepared = await f.root.request("/wallets/transfers/prepare", post(transfer));
  assert.equal(prepared.status, 503);
});

test("the unrecorded-transfer line names the request, hash, token, amount and both wallets", () => {
  const lines: string[] = [];

  reportUnrecordedTransfer("req-1", (line) => lines.push(line))({
    userId: "user",
    fromWalletId: "wal-master",
    toWalletId: "wal-agent",
    token: "mon",
    amount: 500_000_000_000_000_000n,
    txHash: "0xabc",
  });

  assert.deepEqual(lines, [
    "[req-1] unrecorded transfer 0xabc of 500000000000000000 mon base units from wallet wal-master to wallet wal-agent for user user; it was broadcast, record it out of band",
  ]);
});

test("the custody balances are base units from the chain reader, null where a read failed", async () => {
  const balances = walletBalances({
    read: async () => ({
      native: { symbol: "MON", decimals: 18, raw: "500000000000000000" },
      token: { symbol: "AUSD", decimals: 6, raw: null },
    }),
  });

  assert.deepEqual(await balances.read(MASTER), {
    monWei: 500_000_000_000_000_000n,
    ausdMicro: null,
  });
});

test("an AUSD that is not 6 decimals is refused rather than read as micro-AUSD", async () => {
  const balances = walletBalances({
    read: async () => ({
      native: { symbol: "MON", decimals: 18, raw: "1" },
      token: { symbol: "AUSD", decimals: 18, raw: "1" },
    }),
  });

  await assert.rejects(balances.read(MASTER));
});
