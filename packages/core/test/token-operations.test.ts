import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./token-launch.test.js";
import {
  createTokenOperationService,
  TokenTradeError,
  tokenTradeMinimumOutput,
  type TokenOperationDriver,
} from "../src/features/launch/token-operations.js";
const scope = { userId: "owner", workspaceId: "workspace", agentId: "agent" };
const signed = {
  url: "https://api.turnkey.com/public/v1/submit/sign_transaction",
  body: "controlled",
  stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "controlled" },
};
function controlled() {
  const f = fixture();
  let signs = 0,
    sends = 0,
    preflights = 0,
    pending = false,
    uncertain = false;
  let receipt: Awaited<ReturnType<TokenOperationDriver["receipt"]>> = null;
  const driver: TokenOperationDriver = {
    ready: true,
    async prepare(_scope, i) {
      return {
        operationId: i.id,
        chainId: 10143,
        sender: f.context.masterAddress!,
        destination: f.issuer.factory,
        unsignedTransaction: "0x02",
        transactionNonce: 0,
        gas: "1",
        maxFeePerGas: "1",
        maximumGasCost: "1",
        deadline: i.deadline,
        activity: { ...signed, organizationId: "org", timestampMs: "1" },
      };
    },
    async sign() {
      signs++;
      return {
        activityId: "activity",
        status: pending ? "pending" : "completed",
        rawTransaction: pending ? undefined : "0x02aa",
      };
    },
    async activity() {
      return { activityId: "activity", status: "completed", rawTransaction: "0x02aa" };
    },
    async verify() {
      return "0x" + "a".repeat(64);
    },
    async preflight() {
      preflights++;
    },
    async broadcast() {
      sends++;
      if (uncertain) {
        throw new Error("UNCERTAIN");
      }
      return "0x" + "a".repeat(64);
    },
    async receipt() {
      return receipt;
    },
  };
  const ops = createTokenOperationService({
    repository: f.repository,
    tokens: f.service,
    chainId: 10143,
    driver,
  });
  return {
    ...f,
    driver,
    ops,
    counts: () => ({ signs, sends, preflights }),
    pending: () => {
      pending = true;
    },
    uncertain: () => {
      uncertain = true;
    },
    receipt: (r: typeof receipt) => {
      receipt = r;
    },
  };
}
test("launch signs once, revalidates after passkey, sends once and finalizes canonically", async () => {
  const f = controlled();
  const p = await f.ops.prepare(
    scope,
    { action: "launch", expectedVersion: 1 },
    "controlled_operation_001",
  );
  const confirmed = await f.ops.confirm(scope, p.operation.id, p.operation.version, signed);
  assert.equal(confirmed.status, "confirming");
  assert.deepEqual(f.counts(), { signs: 1, sends: 1, preflights: 2 });
  const again = await f.ops.confirm(scope, confirmed.id, confirmed.version, signed);
  assert.equal(again.status, "confirming");
  assert.equal(f.counts().sends, 1);
  f.receipt({ status: "included", blockHash: "0x" + "b".repeat(64) });
  assert.equal((await f.ops.status(scope, confirmed.id)).status, "included");
  f.receipt(null);
  assert.equal((await f.ops.status(scope, confirmed.id)).status, "confirming");
  f.receipt({ status: "finalized", blockHash: "0x" + "c".repeat(64) });
  assert.equal((await f.ops.status(scope, confirmed.id)).status, "finalized");
  assert.equal(await f.tx.intents!.active(), false);
});
test("lost Turnkey response is read explicitly and the same signed bytes can be submitted", async () => {
  const f = controlled();
  f.pending();
  const p = await f.ops.prepare(
    scope,
    { action: "launch", expectedVersion: 1 },
    "controlled_operation_001",
  );
  const unknown = await f.ops.confirm(scope, p.operation.id, p.operation.version, signed);
  assert.equal(unknown.status, "unknown");
  const retained = await f.ops.status(scope, unknown.id);
  assert.equal(retained.status, "signed");
  assert.equal(f.counts().sends, 0);
  const sent = await f.ops.confirm(scope, retained.id, retained.version);
  assert.equal(sent.status, "confirming");
  assert.equal(f.counts().signs, 1);
  assert.equal(f.counts().sends, 1);
});
test("uncertain broadcast never signs or sends again", async () => {
  const f = controlled();
  f.uncertain();
  const p = await f.ops.prepare(
    scope,
    { action: "launch", expectedVersion: 1 },
    "controlled_operation_001",
  );
  const unknown = await f.ops.confirm(scope, p.operation.id, p.operation.version, signed);
  assert.equal(unknown.status, "unknown");
  await f.ops.confirm(scope, unknown.id, unknown.version, signed);
  await f.ops.status(scope, unknown.id);
  assert.equal(f.counts().sends, 1);
  assert.equal(f.counts().signs, 1);
});
test("cancel, stale versions, altered activity and permission revocation cannot send", async () => {
  for (const kind of ["cancel", "stale", "activity", "revoked"]) {
    const f = controlled();
    const p = await f.ops.prepare(
      scope,
      { action: "launch", expectedVersion: 1 },
      "controlled_operation_001",
    );
    if (kind === "cancel") {
      const c = await f.ops.cancel(scope, p.operation.id, p.operation.version);
      assert.equal(c.status, "cancelled");
      await f.ops.confirm(scope, c.id, c.version, signed);
    } else if (kind === "revoked") {
      f.context.enabled = false;
      await assert.rejects(f.ops.confirm(scope, p.operation.id, p.operation.version, signed));
    } else {
      await assert.rejects(
        f.ops.confirm(
          scope,
          p.operation.id,
          kind === "stale" ? 0 : p.operation.version,
          kind === "activity" ? { ...signed, body: "altered" } : signed,
        ),
      );
    }
    assert.equal(f.counts().signs, 0);
    assert.equal(f.counts().sends, 0);
  }
});
test("a changed context after signing retains bytes but blocks submission", async () => {
  const f = controlled();
  const original = f.driver.sign;
  f.driver.sign = async (...args) => {
    const r = await original(...args);
    f.context.enabled = false;
    return r;
  };
  const p = await f.ops.prepare(
    scope,
    { action: "launch", expectedVersion: 1 },
    "controlled_operation_001",
  );
  await assert.rejects(f.ops.confirm(scope, p.operation.id, p.operation.version, signed));
  assert.equal([...f.intents.values()][0]!.status, "signed");
  assert.equal(f.counts().sends, 0);
});

test("pre-sign preflight refusal is recoverable and performs no signing or send", async () => {
  const f = controlled();
  const p = await f.ops.prepare(
    scope,
    { action: "launch", expectedVersion: 1 },
    "controlled_operation_001",
  );
  f.driver.preflight = async () => {
    throw new Error("CHAIN_CHECK_REFUSED");
  };
  const rejected = await f.ops.confirm(scope, p.operation.id, p.operation.version, signed);
  assert.equal(rejected.status, "failed");
  assert.equal(rejected.error, "PREFLIGHT_REJECTED");
  assert.equal((await f.ops.status(scope, rejected.id)).status, "failed");
  assert.equal(await f.tx.intents!.active(), false);
  assert.equal(f.counts().signs, 0);
  assert.equal(f.counts().sends, 0);
});
test("status expires only preparations that were never forwarded", async () => {
  const f = controlled();
  const p = await f.ops.prepare(
    scope,
    { action: "launch", expectedVersion: 1 },
    "controlled_operation_001",
  );
  const intent = f.intents.get(p.operation.id)!;
  intent.deadline = "1";
  const expired = await f.ops.status(scope, p.operation.id);
  assert.equal(expired.status, "failed");
  assert.equal(expired.error, "AUTHORIZATION_EXPIRED");
  assert.equal(f.counts().signs, 0);
});

function tradingFixture() {
  const f = controlled();
  f.context.token = {
    name: "Agent",
    ticker: "AGENT",
    address: "0x" + "9".repeat(40),
    chainId: 10143,
    imageUri: null,
    avatar: { accent: "lime", pattern: 1 },
  };
  return f;
}
test("trade inputs, tolerance and idempotency bind the exact intent before provider work", async () => {
  const f = tradingFixture();
  const trade = { amount: "1000000", slippageBps: 50 };
  const p = await f.ops.prepare(
    scope,
    { action: "buy", trade, expectedVersion: 1 },
    "controlled_trade_001",
  );
  const again = await f.ops.prepare(
    scope,
    { action: "buy", trade, expectedVersion: 1 },
    "controlled_trade_001",
  );
  assert.equal(again.operation.id, p.operation.id);
  for (const input of [
    { action: "buy" as const, expectedVersion: 1 },
    { action: "launch" as const, trade, expectedVersion: 1 },
    { action: "buy" as const, asset: "agent" as const, trade, expectedVersion: 1 },
    ...["0", "01", "-1", "1.2", (2n ** 256n).toString()].map((amount) => ({
      action: "buy" as const,
      trade: { ...trade, amount },
      expectedVersion: 1,
    })),
    ...[0, 101, 1.5].map((slippageBps) => ({
      action: "sell" as const,
      trade: { ...trade, slippageBps },
      expectedVersion: 1,
    })),
  ]) {
    await assert.rejects(
      f.ops.prepare(scope, input, "controlled_invalid_001"),
      /TOKEN_DRAFT_INVALID/,
    );
  }
  for (const altered of [
    { ...trade, amount: "2000000" },
    { ...trade, slippageBps: 100 },
  ]) {
    await assert.rejects(
      f.ops.prepare(
        scope,
        { action: "buy", trade: altered, expectedVersion: 1 },
        "controlled_trade_001",
      ),
      /TOKEN_IDEMPOTENCY_CONFLICT/,
    );
  }
  assert.deepEqual(f.counts(), { signs: 0, sends: 0, preflights: 0 });
  assert.equal(
    tokenTradeMinimumOutput(101n, 50),
    101n,
    "round up the minimum; never widen tolerance",
  );
  assert.equal(tokenTradeMinimumOutput(10000n, 100), 9900n);
});
test("missing approval is explicit, releases the unsent intent and never signs", async () => {
  const f = tradingFixture();
  f.driver.prepare = async () => {
    throw new TokenTradeError("APPROVAL_REQUIRED");
  };
  const p = await f.ops.prepare(
    scope,
    { action: "buy", expectedVersion: 1, trade: { amount: "1000000", slippageBps: 50 } },
    "controlled_trade_001",
  );
  assert.equal(p.operation.status, "failed");
  assert.equal(p.operation.error, "APPROVAL_REQUIRED");
  assert.equal(p.activity, null);
  assert.equal(await f.tx.intents!.active(), false);
  assert.deepEqual(f.counts(), { signs: 0, sends: 0, preflights: 0 });
});
test("a changed confirmed token during preparation or signing cannot receive a trade", async () => {
  for (const stage of ["prepare", "sign"]) {
    const f = tradingFixture();
    const original = f.driver.prepare;
    if (stage === "prepare") {
      f.driver.prepare = async (...args) => {
        const p = await original(...args);
        f.context.token = { ...f.context.token!, address: "0x" + "8".repeat(40) };
        return p;
      };
      await assert.rejects(
        f.ops.prepare(
          scope,
          { action: "buy", expectedVersion: 1, trade: { amount: "1000000", slippageBps: 50 } },
          "controlled_trade_001",
        ),
      );
    } else {
      const p = await f.ops.prepare(
        scope,
        { action: "sell", expectedVersion: 1, trade: { amount: "1000", slippageBps: 50 } },
        "controlled_trade_001",
      );
      f.context.token = { ...f.context.token!, chainId: 143 };
      await assert.rejects(f.ops.confirm(scope, p.operation.id, p.operation.version, signed));
    }
    assert.equal(f.counts().signs, 0);
    assert.equal(f.counts().sends, 0);
  }
});
