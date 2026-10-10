import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./token-launch.test.js";
import {
  createTokenOperationService,
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
