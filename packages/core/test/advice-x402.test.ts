import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  AUSD_TESTNET,
  X402_NETWORK,
  buildUserPrincipal,
  createAdviceService,
  createPaidAdvice,
  DEFAULT_CONFIG,
  PilotError,
  SettlementRejected,
  type AdviceAgent,
  type AdviceJob,
  type AdvicePaymentGateway,
  type AdvicePaymentRecord,
  type AdvicePaymentStore,
  type AdvicePolicy,
  type AdviceRepository,
  type Authorization,
  type PaidAdviceResult,
  type SaleTerms,
} from "../src/index.js";

const id = randomUUID();
const jobId = randomUUID();
const userId = randomUUID();
const policy: AdvicePolicy = {
  version: 1,
  jevModel: "jev-1.13.0",
  deepseekModel: "deepseek-chat",
  inputRates: { jev: "0.1", deepseek: "0.1" },
  outputRates: { jev: "0", deepseek: "0.2" },
  webSearchUsd: "0.01",
  requestLimitUsd: "0.1",
  dailyLimitUsd: "1",
  pricingVerifiedAt: "2026-10-02T00:00:00Z",
  pricingSources: ["https://example.test/pricing"],
};
const config = {
  ...DEFAULT_CONFIG,
  tools: ["getPerpSnapshot", "getPerpOrderBook", "getPerpCandles"] as const,
  plugins: { version: 1 as const, enabled: ["perpl"] as const },
  perpl: { version: 1 as const, network: "testnet" as const, markets: ["BTC"] as const },
};
const PAY_TO = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2222222222222222222222222222222222222222";
const NONCE = `0x${"ab".repeat(32)}`;
const SIGNATURE = `0x${"cd".repeat(65)}`;
const TX = `0x${"ef".repeat(32)}`;
const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;
const RESOURCE_BASE = "https://pickler.fun/api";
const principal = buildUserPrincipal({ user: { id: userId } });

function paymentRow(overrides: Partial<AdvicePaymentRecord> = {}): AdvicePaymentRecord {
  return {
    id: "payment-0",
    jobId: null,
    status: "pending",
    txHash: null,
    payer: PAYER,
    nonce: NONCE,
    validBefore: String(NOW_S + 240),
    ...overrides,
  };
}

function fixture(options: { enabled?: boolean } = {}) {
  const calls: string[] = [];
  const agent: AdviceAgent = {
    publicId: id,
    tenantId: "private-tenant",
    agentId: "private-runtime",
    version: 1,
    config: structuredClone(config) as unknown as AdviceAgent["config"],
    published: true,
    enabled: true,
  };
  const job: AdviceJob = {
    id: jobId,
    publicAgentId: id,
    userId,
    tenantId: agent.tenantId,
    agentId: agent.agentId,
    symbol: "BTC",
    status: "queued",
    createdAt: NOW_MS,
    startedAt: null,
    finishedAt: null,
    configVersion: 1,
    config: agent.config,
    policy,
    result: null,
    error: null,
  };
  const state = {
    replay: null as AdviceJob | null,
    enqueueError: null as Error | null,
    terms: { priceMicro: 1_500_000n, payTo: PAY_TO, handle: "trader" } as SaleTerms | null,
    linked: true,
    record: null as AdvicePaymentRecord | null,
    signatureValid: true,
    nonceUsed: false,
    balance: 10_000_000n,
    settleError: null as Error | null,
  };
  const repository: AdviceRepository = {
    requestReplay: async () => {
      calls.push("requestReplay");
      return state.replay;
    },
    resolve: async () => {
      calls.push("resolve");
      return agent;
    },
    enqueue: async () => {
      calls.push("enqueue");
      if (state.enqueueError) {
        throw state.enqueueError;
      }
      return job;
    },
    get: async (jobIdArg) => {
      calls.push(`get:${jobIdArg}`);
      return job;
    },
    history: async () => ({ items: [], nextCursor: null }),
  };
  const store: AdvicePaymentStore = {
    saleTerms: async () => {
      calls.push("saleTerms");
      return state.terms;
    },
    payerLinked: async () => {
      calls.push("payerLinked");
      return state.linked;
    },
    byKey: async () => {
      calls.push("byKey");
      return state.record;
    },
    insertPending: async (input) => {
      calls.push("insertPending");
      state.record = paymentRow({
        id: "payment-1",
        payer: input.authorization.from,
        nonce: input.authorization.nonce,
        validBefore: input.authorization.validBefore,
      });
      return state.record;
    },
    settled: async (paymentId, txHash, blockNumber) => {
      calls.push(`settled:${paymentId}:${txHash}:${blockNumber}`);
      state.record = paymentRow({ ...state.record, id: paymentId, status: "settled", txHash });
    },
    failed: async (paymentId, error) => {
      calls.push(`failed:${paymentId}:${error}`);
      state.record = paymentRow({ ...state.record, id: paymentId, status: "failed" });
    },
    attachJob: async (paymentId, jobIdArg) => {
      calls.push(`attachJob:${paymentId}:${jobIdArg}`);
    },
    refundOwed: async (paymentId, error) => {
      calls.push(`refundOwed:${paymentId}:${error}`);
    },
  };
  const gateway: AdvicePaymentGateway = {
    signatureValid: async () => {
      calls.push("signatureValid");
      return state.signatureValid;
    },
    nonceUsed: async (from, nonce) => {
      calls.push(`nonceUsed:${from}:${nonce}`);
      return state.nonceUsed;
    },
    balance: async () => {
      calls.push("balance");
      return state.balance;
    },
    settle: async () => {
      calls.push("settle");
      if (state.settleError) {
        throw state.settleError;
      }
      return { txHash: TX, blockNumber: 42n };
    },
  };
  const advice = createAdviceService(repository, { enabled: options.enabled ?? true, policy });
  const paid = createPaidAdvice({
    advice,
    repository,
    store,
    gateway,
    now: () => NOW_MS,
    resourceBase: RESOURCE_BASE,
  });
  return { paid, state, calls, job };
}

function authorization(overrides: Partial<Authorization> = {}): Authorization {
  return {
    from: PAYER,
    to: PAY_TO,
    value: "1500000",
    validAfter: String(NOW_S - 10),
    validBefore: String(NOW_S + 240),
    nonce: NONCE,
    ...overrides,
  };
}

function encode(value: unknown): string {
  return btoa(JSON.stringify(value));
}

function header(overrides: Partial<Authorization> = {}, envelope: Record<string, unknown> = {}) {
  return encode({
    x402Version: 1,
    scheme: "exact",
    network: X402_NETWORK,
    payload: { signature: SIGNATURE, authorization: authorization(overrides) },
    ...envelope,
  });
}

function refused(result: PaidAdviceResult, error: string) {
  assert.equal(result.kind, "payment_required");
  assert.equal(result.kind === "payment_required" ? result.error : null, error);
}

test("1. without X-PAYMENT the buyer gets the payment requirements and nothing is enqueued", async () => {
  const f = fixture();
  const result = await f.paid.request(principal, id, "BTC", "key-1", undefined);
  assert.equal(result.kind, "payment_required");
  if (result.kind !== "payment_required") {
    return;
  }
  assert.equal(result.error, null);
  assert.equal(result.requirements.maxAmountRequired, "1500000");
  assert.equal(result.requirements.payTo, PAY_TO);
  assert.equal(result.requirements.asset, AUSD_TESTNET);
  assert.equal(result.requirements.network, "monad-testnet");
  assert.equal(result.requirements.scheme, "exact");
  assert.equal(result.requirements.maxTimeoutSeconds, 300);
  assert.deepEqual(result.requirements.extra, {
    name: "Agora Dollar",
    version: "1",
    chainId: 10143,
  });
  assert.equal(
    result.requirements.resource,
    `${RESOURCE_BASE}/v1/agent-advice/agents/${id}/recommendations`,
  );
  assert.match(result.requirements.description, /BTC/);
  assert.match(result.requirements.description, /@trader/);
  assert.ok(!f.calls.includes("enqueue"));
  assert.ok(!f.calls.includes("settle"));
});

test("2. an agent without sale terms is not for sale", async () => {
  const f = fixture();
  f.state.terms = null;
  await assert.rejects(
    f.paid.request(principal, id, "BTC", "key-1", header()),
    (error: unknown) =>
      error instanceof PilotError &&
      error.code === "NOT_FOUND" &&
      error.message === "ADVICE_NOT_FOR_SALE",
  );
  assert.ok(!f.calls.includes("settle"));
});

test("3. disabled advice is refused by admit before the sale terms are read", async () => {
  const f = fixture({ enabled: false });
  await assert.rejects(
    f.paid.request(principal, id, "BTC", "key-1", header()),
    (error: unknown) => error instanceof PilotError && error.code === "ADVICE_UNAVAILABLE",
  );
  assert.ok(!f.calls.includes("saleTerms"));
  assert.ok(!f.calls.includes("settle"));
});

test("4. a valid payment is settled once, then enqueued and linked to the job", async () => {
  const f = fixture();
  const result = await f.paid.request(principal, id, "BTC", "key-1", header());
  assert.equal(result.kind, "accepted");
  if (result.kind !== "accepted") {
    return;
  }
  assert.equal(result.job.id, jobId);
  assert.equal(f.calls.filter((call) => call === "settle").length, 1);
  const settledAt = f.calls.indexOf(`settled:payment-1:${TX}:42`);
  const enqueuedAt = f.calls.indexOf("enqueue");
  assert.ok(settledAt >= 0);
  assert.ok(enqueuedAt > settledAt);
  assert.ok(f.calls.indexOf(`attachJob:payment-1:${jobId}`) > enqueuedAt);
  assert.ok(result.settlement);
  assert.deepEqual(JSON.parse(atob(result.settlement)), {
    success: true,
    transaction: TX,
    network: "monad-testnet",
    payer: PAYER,
  });
});

test("5. every refused payment answers 402 with its reason and never settles", async () => {
  const cases: {
    name: string;
    error: string;
    header?: () => string;
    setup?: (f: ReturnType<typeof fixture>) => void;
  }[] = [
    { name: "value below price", error: "wrong_amount", header: () => header({ value: "1" }) },
    {
      name: "price changed after the 402",
      error: "wrong_amount",
      setup: (f) => {
        f.state.terms = { priceMicro: 2_000_000n, payTo: PAY_TO, handle: "trader" };
      },
    },
    {
      name: "other recipient",
      error: "wrong_recipient",
      header: () => header({ to: "0x3333333333333333333333333333333333333333" }),
    },
    {
      name: "already expired",
      error: "expired",
      header: () => header({ validBefore: String(NOW_S) }),
    },
    {
      name: "window too long",
      error: "expired",
      header: () => header({ validBefore: String(NOW_S + 301) }),
    },
    {
      name: "not valid yet",
      error: "expired",
      header: () => header({ validAfter: String(NOW_S + 1) }),
    },
    {
      name: "bad signature",
      error: "invalid_signature",
      setup: (f) => {
        f.state.signatureValid = false;
      },
    },
    {
      name: "payer not linked",
      error: "payer_not_linked",
      setup: (f) => {
        f.state.linked = false;
      },
    },
    {
      name: "nonce used",
      error: "nonce_used",
      setup: (f) => {
        f.state.nonceUsed = true;
      },
    },
    {
      name: "insufficient funds",
      error: "insufficient_funds",
      setup: (f) => {
        f.state.balance = 1_499_999n;
      },
    },
    { name: "not base64", error: "invalid_payment", header: () => "%%%not-base64%%%" },
    { name: "not json", error: "invalid_payment", header: () => btoa("{nope") },
    {
      name: "wrong version",
      error: "invalid_payment",
      header: () => header({}, { x402Version: 2 }),
    },
    {
      name: "wrong scheme",
      error: "invalid_payment",
      header: () => header({}, { scheme: "upto" }),
    },
    {
      name: "wrong network",
      error: "invalid_payment",
      header: () => header({}, { network: "base-sepolia" }),
    },
  ];
  for (const item of cases) {
    const f = fixture();
    item.setup?.(f);
    const result = await f.paid.request(
      principal,
      id,
      "BTC",
      "key-1",
      item.header ? item.header() : header(),
    );
    refused(result, item.error);
    assert.ok(!f.calls.includes("settle"), item.name);
    assert.ok(!f.calls.includes("insertPending"), item.name);
    assert.ok(!f.calls.includes("enqueue"), item.name);
  }
});

test("5b. recipient comparison ignores address case", async () => {
  const f = fixture();
  const result = await f.paid.request(
    principal,
    id,
    "BTC",
    "key-1",
    header({ to: PAY_TO.toUpperCase().replace("0X", "0x") }),
  );
  assert.equal(result.kind, "accepted");
});

test("6. a rejected settlement marks the payment failed and enqueues nothing", async () => {
  const f = fixture();
  f.state.settleError = new SettlementRejected("reverted");
  const result = await f.paid.request(principal, id, "BTC", "key-1", header());
  refused(result, "settlement_failed");
  assert.ok(f.calls.includes("failed:payment-1:settlement_failed"));
  assert.ok(!f.calls.some((call) => call.startsWith("settled:")));
  assert.ok(!f.calls.includes("enqueue"));
});

test("7. a replayed key returns its job and never settles, even with a fresh valid header", async () => {
  const f = fixture();
  f.state.replay = f.job;
  const result = await f.paid.request(principal, id, "BTC", "key-1", header());
  assert.deepEqual(result, { kind: "accepted", job: f.job, settlement: null });
  assert.ok(!f.calls.includes("settle"));
  assert.ok(!f.calls.includes("enqueue"));
});

test("8. a settled payment without a job is enqueued without a new settlement", async () => {
  const f = fixture();
  f.state.record = paymentRow({ status: "settled", txHash: TX });
  const result = await f.paid.request(principal, id, "BTC", "key-1", undefined);
  assert.equal(result.kind, "accepted");
  assert.ok(!f.calls.includes("settle"));
  assert.ok(!f.calls.includes("insertPending"));
  assert.ok(f.calls.includes("enqueue"));
  assert.ok(f.calls.includes(`attachJob:payment-0:${jobId}`));
});

test("9. a busy enqueue after settlement keeps the payment settled for the same key", async () => {
  const f = fixture();
  f.state.enqueueError = new PilotError("ADVICE_BUSY", "Busy");
  await assert.rejects(
    f.paid.request(principal, id, "BTC", "key-1", header()),
    (error: unknown) => error instanceof PilotError && error.code === "ADVICE_BUSY",
  );
  assert.ok(f.calls.includes(`settled:payment-1:${TX}:42`));
  assert.ok(!f.calls.some((call) => call.startsWith("refundOwed")));
  assert.ok(!f.calls.some((call) => call.startsWith("attachJob")));
  assert.equal(f.calls.filter((call) => call === "settle").length, 1);
  f.state.enqueueError = null;
  f.calls.length = 0;
  const retried = await f.paid.request(
    principal,
    id,
    "BTC",
    "key-1",
    header({ nonce: `0x${"12".repeat(32)}` }),
  );
  assert.equal(retried.kind, "accepted");
  assert.ok(!f.calls.includes("settle"));
  assert.ok(!f.calls.includes("insertPending"));
  assert.ok(f.calls.includes("enqueue"));
  assert.ok(f.calls.includes(`attachJob:payment-1:${jobId}`));
});

test("10. stored payment states for the key: in flight or owed refuse, settled with a job returns it", async () => {
  for (const status of ["pending", "refund_owed"] as const) {
    const f = fixture();
    f.state.record = paymentRow({ status });
    const result = await f.paid.request(principal, id, "BTC", "key-1", header());
    refused(result, "invalid_payment");
    assert.ok(!f.calls.includes("settle"), status);
  }
  const failed = fixture();
  failed.state.record = paymentRow({ status: "failed" });
  const retried = await failed.paid.request(principal, id, "BTC", "key-1", header());
  assert.equal(retried.kind, "accepted");
  assert.equal(failed.calls.filter((call) => call === "settle").length, 1);
  const linked = fixture();
  linked.state.record = paymentRow({ jobId, status: "settled", txHash: TX });
  const existing = await linked.paid.request(principal, id, "BTC", "key-1", header());
  assert.deepEqual(existing, { kind: "accepted", job: linked.job, settlement: null });
  assert.ok(linked.calls.includes(`get:${jobId}`));
  assert.ok(!linked.calls.includes("settle"));
});

const FRESH_NONCE = `0x${"34".repeat(32)}`;

test("11a. an ambiguous settlement error leaves the payment pending and blocks a second charge", async () => {
  const f = fixture();
  f.state.settleError = new Error("receipt timeout");
  const first = await f.paid.request(principal, id, "BTC", "key-1", header());
  refused(first, "settlement_failed");
  assert.ok(!f.calls.some((call) => call.startsWith("failed:")));
  assert.equal(f.state.record?.status, "pending");
  f.state.settleError = null;
  f.calls.length = 0;
  const second = await f.paid.request(
    principal,
    id,
    "BTC",
    "key-1",
    header({ nonce: FRESH_NONCE }),
  );
  refused(second, "invalid_payment");
  assert.ok(!f.calls.includes("settle"));
  assert.ok(!f.calls.includes("insertPending"));
});

test("11b. a proven rejection marks the payment failed and the same key may pay once more", async () => {
  const f = fixture();
  f.state.settleError = new SettlementRejected("simulation reverted");
  const first = await f.paid.request(principal, id, "BTC", "key-1", header());
  refused(first, "settlement_failed");
  assert.ok(f.calls.includes("failed:payment-1:settlement_failed"));
  f.state.settleError = null;
  f.calls.length = 0;
  const second = await f.paid.request(
    principal,
    id,
    "BTC",
    "key-1",
    header({ nonce: FRESH_NONCE }),
  );
  assert.equal(second.kind, "accepted");
  assert.equal(f.calls.filter((call) => call === "settle").length, 1);
});

test("11c. an expired pending payment whose nonce is unused is failed and the flow continues", async () => {
  const f = fixture();
  f.state.record = paymentRow({ validBefore: String(NOW_S - 1) });
  const result = await f.paid.request(
    principal,
    id,
    "BTC",
    "key-1",
    header({ nonce: FRESH_NONCE }),
  );
  assert.equal(result.kind, "accepted");
  assert.ok(f.calls.includes(`nonceUsed:${PAYER}:${NONCE}`));
  assert.ok(f.calls.includes("failed:payment-0:expired_unsettled"));
  assert.equal(f.calls.filter((call) => call === "settle").length, 1);
  const used = fixture();
  used.state.record = paymentRow({ validBefore: String(NOW_S - 1) });
  used.state.nonceUsed = true;
  const refusedResult = await used.paid.request(
    principal,
    id,
    "BTC",
    "key-1",
    header({ nonce: FRESH_NONCE }),
  );
  refused(refusedResult, "invalid_payment");
  assert.ok(!used.calls.includes("settle"));
  assert.ok(!used.calls.some((call) => call.startsWith("failed:")));
  const live = fixture();
  live.state.record = paymentRow({ validBefore: String(NOW_S + 1) });
  const liveResult = await live.paid.request(
    principal,
    id,
    "BTC",
    "key-1",
    header({ nonce: FRESH_NONCE }),
  );
  refused(liveResult, "invalid_payment");
  assert.ok(!live.calls.includes("settle"));
});

test("11d. a replay returns its job even while advice is disabled", async () => {
  const f = fixture({ enabled: false });
  f.state.replay = f.job;
  const result = await f.paid.request(principal, id, "BTC", "key-1", header());
  assert.deepEqual(result, { kind: "accepted", job: f.job, settlement: null });
  assert.ok(!f.calls.includes("settle"));
  f.state.replay = { ...f.job, symbol: "ETH" };
  await assert.rejects(
    f.paid.request(principal, id, "BTC", "key-1", header()),
    (error: unknown) => error instanceof PilotError && error.code === "CONFLICT",
  );
});

test("11e. a signature that is not 65 bytes is an invalid payment", async () => {
  for (const signature of [`0x${"cd".repeat(64)}`, `0x${"cd".repeat(66)}`, "0xcd"]) {
    const f = fixture();
    const value = encode({
      x402Version: 1,
      scheme: "exact",
      network: X402_NETWORK,
      payload: { signature, authorization: authorization() },
    });
    const result = await f.paid.request(principal, id, "BTC", "key-1", value);
    refused(result, "invalid_payment");
    assert.ok(!f.calls.includes("signatureValid"), signature);
    assert.ok(!f.calls.includes("settle"), signature);
  }
});
