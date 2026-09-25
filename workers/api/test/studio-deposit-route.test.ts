import test from "node:test";
import assert from "node:assert/strict";
import {
  AuthenticationRequiredError,
  buildUserPrincipal,
  createCustodyService,
  DepositAlreadyRecordedError,
  PilotError,
  type AgentWalletRepository,
  type CustodyRepository,
  type ForwardExpectations,
  type ResearchRepository,
  type SignedActivityForwarder,
  type StudioDirectory,
} from "@pickler/core";
import {
  buildTransferTx,
  createActivityBuilders,
  createAusdDepositChain,
  type Rpc,
} from "@pickler/infrastructure";
import { studioRoutes } from "../src/routes/studio.js";

const USER = "user";
const AGENT = "11111111-1111-4111-8111-111111111111";
const MASTER = "0x1111111111111111111111111111111111111111";
const AGENT_ADDRESS = "0x2222222222222222222222222222222222222222";
const STRANGER = "0x3333333333333333333333333333333333333333";
/** What Turnkey answers as the signed transaction (no 0x prefix, as it does today) and its hash. */
const SIGNED = `02${"ab".repeat(40)}`;
const HASH = "0xfeecccfa7b5096aa1f0fb2cfde57b2e763aee4d253e6cd3319e6949ff4009570";

const RPC_ANSWERS: Record<string, unknown> = {
  eth_getTransactionCount: "0x7",
  eth_maxPriorityFeePerGas: "0x77359400",
  eth_getBlockByNumber: { baseFeePerGas: "0xba43b7400" },
  eth_estimateGas: "0xc350",
  eth_sendRawTransaction: HASH,
};

function fixture(options: { signedIn?: boolean; custody?: boolean } = {}) {
  const sent: unknown[] = [];
  const forwards: ForwardExpectations[] = [];
  const deposits: { agentId: string; txHash: string; amountMicroUsd: bigint }[] = [];
  const forgotten: string[] = [];

  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const { method, params } = JSON.parse(String(init!.body)) as {
      method: string;
      params: unknown[];
    };
    if (method === "eth_sendRawTransaction") {
      sent.push(params[0]);
    }
    return Response.json({ jsonrpc: "2.0", id: 1, result: RPC_ANSWERS[method] });
  }) as typeof globalThis.fetch;

  const repository = {
    findByUserId: async (userId: string) =>
      userId === USER
        ? {
            userId,
            subOrganizationId: "sub-ana",
            masterWalletId: "wal-master",
            rootUserId: "root",
            address: MASTER,
          }
        : null,
  } as unknown as CustodyRepository;
  const agentWallets = {
    findAgentWallet: async (agentId: string) =>
      agentId === AGENT ? { walletId: "wal-agent", address: AGENT_ADDRESS } : null,
    findOwnedAgentWallet: async (userId: string, walletId: string) =>
      userId === USER && walletId === "wal-agent" ? { walletId, address: AGENT_ADDRESS } : null,
    saveDeposit: async (input: { agentId: string; txHash: string; amountMicroUsd: bigint }) => {
      if (deposits.some((deposit) => deposit.txHash === input.txHash)) {
        throw new DepositAlreadyRecordedError();
      }
      deposits.push(input);
    },
  } as unknown as AgentWalletRepository;
  const forwarder: SignedActivityForwarder = {
    async forward(_request, expectations) {
      forwards.push(expectations);
      return {
        id: "act",
        fingerprint: "f",
        status: "ACTIVITY_STATUS_COMPLETED",
        result: { signTransactionResult: { signedTransaction: SIGNED } },
      };
    },
  };

  const custody = createCustodyService({
    challenges: { put: async () => {}, consume: async () => null },
    repository,
    turnkey: { create: async () => Promise.reject(new Error("unused")) },
    activities: {
      build: () => {
        throw new Error("unused");
      },
    },
    forwarder,
    agentActivities: createActivityBuilders({ baseUrl: "https://api.turnkey.com" }),
    agentWallets,
    deposits: createAusdDepositChain({
      chainId: 10143,
      rpcUrl: "https://rpc.example",
      fetch,
      balances: { forget: (address) => forgotten.push(address) },
    }),
    delegatedPublicKey: null,
    venueContracts: [],
    rpId: "pickler.fun",
    appName: "Pickler",
    now: () => new Date(),
    randomId: () => "r",
  });

  const directory = {
    access: async () => ({
      workspaceId: "workspace",
      tenantId: "trusted",
      ownerUserId: USER,
      role: "admin",
      enabled: true,
    }),
    agentScope: async (_access: unknown, id: string) => {
      if (id !== AGENT) {
        throw new PilotError("NOT_FOUND", "Missing");
      }
      return { tenantId: "trusted", agentId: id };
    },
  } as unknown as StudioDirectory;

  const app = studioRoutes({
    directory,
    repository: {} as ResearchRepository,
    notifyQueued: async () => {},
    wallets: { findAgentWallet: async () => null },
    balances: { read: async () => 0 },
    ...(options.custody === false ? {} : { custody: () => custody }),
    authenticate: async () => {
      if (options.signedIn === false) {
        throw new AuthenticationRequiredError();
      }
      return {
        principal: buildUserPrincipal({
          user: { id: USER },
          integrator: { id: "workspace" },
          memberRole: "admin",
        }),
        workspace: null,
      };
    },
  });
  return { app, sent, forwards, deposits, forgotten };
}

const post = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** What the browser posts back after the passkey stamps the prepared activity. */
const stamp = (prepared: { url: string; body: string }, body = prepared.body) => ({
  url: prepared.url,
  body,
  stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "stamp" },
});

async function prepare(app: ReturnType<typeof fixture>["app"], amountAusd = 25) {
  const response = await app.request(`/agents/${AGENT}/deposit/prepare`, post({ amountAusd }));
  assert.equal(response.status, 200);
  return (await response.json()) as {
    url: string;
    body: string;
    timestampMs: string;
    organizationId: string;
    amountMicroUsd: number;
  };
}

test("prepare answers the sign_transaction activity for the master wallet, in the signing shape", async () => {
  const { app } = fixture();

  const prepared = await prepare(app, 25);

  assert.deepEqual(Object.keys(prepared).sort(), [
    "amountMicroUsd",
    "body",
    "organizationId",
    "timestampMs",
    "url",
  ]);
  assert.equal(prepared.url, "https://api.turnkey.com/public/v1/submit/sign_transaction");
  assert.equal(prepared.organizationId, "sub-ana");
  assert.equal(prepared.amountMicroUsd, 25_000_000);
  const body = JSON.parse(prepared.body);
  assert.equal(body.type, "ACTIVITY_TYPE_SIGN_TRANSACTION_V2");
  assert.equal(body.parameters.signWith, MASTER);
  assert.match(body.parameters.unsignedTransaction, /^0x02/);
});

test("confirm forwards, broadcasts, records the deposit and answers the hash", async () => {
  const { app, sent, forwards, deposits, forgotten } = fixture();
  const prepared = await prepare(app, 50);

  const response = await app.request(
    `/agents/${AGENT}/deposit/confirm`,
    post({ amountAusd: 50, signed: stamp(prepared) }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { txHash: HASH });
  assert.deepEqual(forwards, [
    { organizationId: "sub-ana", allowedActivityTypes: ["ACTIVITY_TYPE_SIGN_TRANSACTION_V2"] },
  ]);
  assert.deepEqual(sent, [`0x${SIGNED}`]);
  assert.deepEqual(deposits, [{ agentId: AGENT, txHash: HASH, amountMicroUsd: 50_000_000n }]);
  assert.deepEqual(forgotten, [AGENT_ADDRESS]);
});

test("a stamped transfer to another recipient is refused with 400 and nothing is broadcast", async () => {
  const { app, sent, forwards, deposits } = fixture();
  const prepared = await prepare(app, 25);
  const rpc: Rpc = { call: async (method) => RPC_ANSWERS[method] };
  const diverted = await buildTransferTx({
    rpc,
    chainId: 10143,
    token: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
    from: MASTER,
    to: STRANGER,
    amount: 25_000_000n,
  });
  const body = JSON.parse(prepared.body);
  body.parameters.unsignedTransaction = diverted.unsignedTransaction;

  const response = await app.request(
    `/agents/${AGENT}/deposit/confirm`,
    post({ amountAusd: 25, signed: stamp(prepared, JSON.stringify(body)) }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "INVALID_SIGNED_ACTIVITY" });
  assert.deepEqual(forwards, []);
  assert.deepEqual(sent, []);
  assert.deepEqual(deposits, []);
});

test("confirming the same transaction twice is 409, recorded once", async () => {
  const { app, deposits } = fixture();
  const prepared = await prepare(app, 10);
  const confirm = () =>
    app.request(
      `/agents/${AGENT}/deposit/confirm`,
      post({ amountAusd: 10, signed: stamp(prepared) }),
    );

  assert.equal((await confirm()).status, 200);
  const again = await confirm();

  assert.equal(again.status, 409);
  assert.deepEqual(await again.json(), { error: "DEPOSIT_ALREADY_RECORDED" });
  assert.equal(deposits.length, 1);
});

test("an amount outside the offered set, or a body that is not the contract, is 400", async () => {
  const { app } = fixture();

  for (const body of [{ amountAusd: 11 }, { amountAusd: "25" }, { amountAusd: 25, extra: 1 }, {}]) {
    const response = await app.request(`/agents/${AGENT}/deposit/prepare`, post(body));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(await response.json(), { error: "INVALID_INPUT" });
  }
});

test("someone else's agent is 404 and nothing is prepared", async () => {
  const { app } = fixture();

  const response = await app.request(
    "/agents/22222222-2222-4222-8222-222222222222/deposit/prepare",
    post({ amountAusd: 25 }),
  );

  assert.equal(response.status, 404);
});

test("unauthenticated is 401; without Turnkey composed deposits are 503", async () => {
  const anonymous = fixture({ signedIn: false });
  const refused = await anonymous.app.request(
    `/agents/${AGENT}/deposit/prepare`,
    post({ amountAusd: 25 }),
  );
  assert.equal(refused.status, 401);

  const bare = fixture({ custody: false });
  const unavailable = await bare.app.request(
    `/agents/${AGENT}/deposit/prepare`,
    post({ amountAusd: 25 }),
  );
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: "DEPOSITS_UNAVAILABLE" });
});
