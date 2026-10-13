import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PilotError } from "@pickler/core";
import {
  createPerplLiveService,
  emptyPerplLiveDocument,
  type PerplLiveAuthority,
  type PerplLiveDocument,
  type PerplLiveDriver,
  type PerplLiveRepository,
  type PerplLiveScope,
  type PerplLiveSnapshot,
  type PerplLiveOrderSpec,
} from "../src/perpl-live.js";

function fixture() {
  const scope = { userId: randomUUID(), productAgentId: randomUUID() };
  let now = Date.now();
  const authority: PerplLiveAuthority = {
    scope,
    tenantId: "tenant",
    agentId: "agent",
    address: "0x" + "11".repeat(20),
    organizationId: "org",
    configVersion: 1,
    enabled: true,
    paused: false,
    killed: false,
    network: "testnet",
    markets: ["BTC"],
    perCallMicros: "25000000",
    perDayMicros: "100000000",
  };
  let document: PerplLiveDocument = {
    ...emptyPerplLiveDocument(authority.address, scope.productAgentId),
    accountId: 7,
    publicKey: "test-only",
    encryptedKey: "test-only",
    encryptedToken: "test-only",
    keyExpiresAt: now + 90_000_000,
  };
  const check = (s: PerplLiveScope) => {
    if (s.userId !== scope.userId || s.productAgentId !== scope.productAgentId) {
      throw new PilotError("NOT_FOUND", "Not found");
    }
  };
  const repository: PerplLiveRepository = {
    async read(s) {
      check(s);
      return { authority: structuredClone(authority), document: structuredClone(document) };
    },
    async transact(s, change) {
      check(s);
      const copy = structuredClone(document);
      const result = change(copy, structuredClone(authority), now);
      document = copy;
      return structuredClone(result);
    },
    async due() {
      return [scope];
    },
  };
  const snapshot: PerplLiveSnapshot = {
    instanceId: 1,
    lockedMicros: "0",
    unmanagedOrders: false,
    accountId: 7,
    forwarding: true,
    frozen: false,
    balanceMicros: "100000000",
    lastRequestId: 0,
    head: 100,
    at: now,
    markets: [
      {
        id: 16,
        symbol: "BTC",
        mark: 1000000,
        priceDecimals: 1,
        sizeDecimals: 5,
        maxLeverage: 15,
        maxSlippageBps: 100,
        ttlBlocks: 20,
        takerFeeMicros: 345,
      },
    ],
    positions: [],
    orders: [],
  };
  const submissions: PerplLiveOrderSpec[] = [];
  const driver: PerplLiveDriver = {
    async prepareSetup() {
      throw new Error("Not needed");
    },
    async confirmSetup() {
      throw new Error("Not needed");
    },
    async reconcileSetup() {
      return { confirmed: false };
    },
    async snapshot() {
      return structuredClone(snapshot);
    },
    async submit(_d, order, guard) {
      await guard();
      submissions.push(structuredClone(order));
      return "accepted";
    },
    async verifyTransaction() {
      return false;
    },
  };
  const service = (admissions = true) =>
    createPerplLiveService({ repository, driver, admissions, randomId: randomUUID });
  const terms = { symbol: "BTC", marginMicros: "5000000", leverage: 1, cycles: 1, holdSeconds: 30 };
  function advance(ms: number) {
    now += ms;
    snapshot.at = now;
    snapshot.head += Math.ceil(ms / 400);
  }
  function fill(order = submissions.at(-1)!, size = order.s) {
    snapshot.lastRequestId = order.rq;
    snapshot.orders.push({
      originalSize: order.s,
      leverage: order.lv,
      requestId: order.rq,
      accountId: order.acc,
      marketId: order.mkt,
      orderId: order.rq + 100,
      type: order.t,
      status: size === order.s ? "filled" : "partial",
      filledSize: size,
      fillPrice: 1000000,
      feeMicros: "1000",
      txHashes: [],
    });
    if (order.t <= 2) {
      snapshot.positions = [
        {
          requestId: order.rq,
          id: 8,
          marketId: 16,
          side: "long",
          size,
          entryPrice: 1000000,
          collateralMicros: "5000000",
          leverage: 100,
          feeMicros: "1000",
          realizedPnlMicros: null,
          fundingMicros: null,
          exitPrice: null,
          closed: false,
        },
      ];
    } else {
      const position = snapshot.positions[0]!;
      position.size -= size;
      position.requestId = order.rq;
      position.closed = position.size === 0;
      position.realizedPnlMicros = "1000";
    }
  }
  return {
    scope,
    authority,
    repository,
    snapshot,
    driver,
    submissions,
    terms,
    service,
    advance,
    fill,
    document: () => document,
  };
}
test("one durable opening, confirmed position, closing and completed cycle", async () => {
  const f = fixture();
  const service = f.service();
  const key = randomUUID();
  const started = await service.start(f.scope, f.terms, key);
  assert.equal((await service.start(f.scope, f.terms, key)).id, started.id);

  await Promise.all([service.tick(f.scope), service.tick(f.scope)]);
  assert.equal(f.submissions.length, 1);
  assert.equal(f.submissions[0]!.t, 1);
  assert.equal(f.document().orders[0]!.status, "accepted");
  f.fill();
  await service.tick(f.scope);
  assert.equal(f.submissions.length, 1);

  f.advance(31_000);
  await service.tick(f.scope);
  assert.equal(f.submissions.length, 2);
  assert.equal(f.submissions[1]!.t, 3);
  f.fill();
  await service.tick(f.scope);
  assert.equal(f.document().sessions[0]!.status, "completed");
  assert.equal(f.document().sessions[0]!.completedCycles, 1);
  await service.tick(f.scope);
  assert.equal(f.submissions.length, 2);
});
test("unavailable public requirements preserve the owner's account and session state", async () => {
  const f = fixture();
  f.driver.requirements = async () => {
    throw new Error("Controlled public transport failure");
  };
  const state = await f.service(false).state(f.scope);

  assert.equal(state.requirements, null);
  assert.equal(state.admissionsEnabled, false);
  assert.equal(state.document?.accountId, 7);
  assert.equal(state.authority.perDayMicros, "100000000");
  assert.equal(f.submissions.length, 0);
});
test("a lost submission response is reconciled without sending another opening", async () => {
  const f = fixture();
  const base = f.driver.submit;
  f.driver.submit = async (d, order, guard) => {
    await base(d, order, guard);
    throw new PilotError("PERPL_TRANSPORT_UNKNOWN", "Unknown");
  };
  const service = f.service();
  await service.start(f.scope, f.terms, randomUUID());
  await service.tick(f.scope);
  assert.equal(f.document().orders[0]!.status, "unknown");
  await service.tick(f.scope);
  assert.equal(f.submissions.length, 1);
  f.fill();
  await service.tick(f.scope);
  assert.equal(f.document().orders[0]!.status, "filled");
  assert.equal(f.submissions.length, 1);
});
test("a fill that precedes its position snapshot cannot open a second position", async () => {
  const f = fixture();
  const service = f.service();
  await service.start(f.scope, f.terms, randomUUID());
  await service.tick(f.scope);
  f.fill();
  const position = f.snapshot.positions.pop()!;
  await service.tick(f.scope);
  assert.equal(f.submissions.length, 1);
  f.snapshot.positions.push(position);
  await service.tick(f.scope);
  assert.equal(f.submissions.length, 1);
});
test("partial fills close the actual remaining position and count one cycle", async () => {
  const f = fixture();
  const service = f.service();
  await service.start(f.scope, f.terms, randomUUID());
  await service.tick(f.scope);
  f.fill(undefined, 3);
  await service.tick(f.scope);
  f.advance(31_000);
  await service.tick(f.scope);
  assert.equal(f.submissions[1]!.s, 3);
  f.fill(undefined, 1);
  await service.tick(f.scope);
  assert.equal(f.submissions[2]!.s, 2);
  f.fill();
  await service.tick(f.scope);
  assert.equal(f.document().sessions[0]!.completedCycles, 1);
  assert.equal(f.document().sessions[0]!.status, "completed");
});
test("required exits remain available after admissions, access and selected network change", async () => {
  const f = fixture();
  const initial = f.service();
  await initial.start(f.scope, f.terms, randomUUID());
  await initial.tick(f.scope);
  f.fill();
  await initial.tick(f.scope);
  f.authority.enabled = false;
  f.authority.paused = true;
  f.authority.network = "mainnet";
  f.advance(31_000);
  await f.service(false).tick(f.scope);
  assert.equal(f.submissions.at(-1)!.t, 3);
});
test("ownership, leverage, margin, daily limits and request-key terms are enforced", async () => {
  const f = fixture();
  const service = f.service();
  await assert.rejects(service.start({ ...f.scope, userId: randomUUID() }, f.terms, randomUUID()), {
    code: "NOT_FOUND",
  });
  await assert.rejects(service.start(f.scope, { ...f.terms, leverage: 2 }, randomUUID()), {
    code: "INVALID_INPUT",
  });
  await assert.rejects(
    service.start(f.scope, { ...f.terms, marginMicros: "26000000" }, randomUUID()),
    { code: "PERPL_MARGIN_LIMIT" },
  );
  f.authority.perDayMicros = "10000000";
  await assert.rejects(service.start(f.scope, { ...f.terms, cycles: 3 }, randomUUID()), {
    code: "PERPL_DAY_LIMIT",
  });
  const key = randomUUID();
  await service.start(f.scope, f.terms, key);
  await assert.rejects(service.start(f.scope, { ...f.terms, holdSeconds: 60 }, key), {
    code: "CONFLICT",
  });
});
test("lease expiry prevents a prepared opening from reaching the venue", async () => {
  const f = fixture();
  f.driver.snapshot = async () => {
    f.advance(61_000);
    return structuredClone(f.snapshot);
  };
  const service = f.service();
  await service.start(f.scope, f.terms, randomUUID());
  await service.tick(f.scope);
  assert.equal(f.submissions.length, 0);
  assert.equal(f.document().sessions[0]!.error, "PERPL_LEASE_LOST");
});
test("an unexplained position, including another BTC opening, freezes the session", async () => {
  const f = fixture();
  const service = f.service();
  await service.start(f.scope, f.terms, randomUUID());
  await service.tick(f.scope);
  f.fill();
  f.snapshot.positions[0]!.requestId = 999;
  await service.tick(f.scope);
  assert.equal(f.document().sessions[0]!.status, "frozen");
  assert.equal(f.submissions.length, 1);
});
test("disabled admissions cannot prepare or start an account", async () => {
  const f = fixture();
  await assert.rejects(f.service(false).start(f.scope, f.terms, randomUUID()), {
    code: "PERPL_ADMISSIONS_PAUSED",
  });
  await assert.rejects(f.service(false).prepareSetup(f.scope, "100000000", randomUUID()), {
    code: "PERPL_ADMISSIONS_PAUSED",
  });
  assert.equal(f.submissions.length, 0);
});
test("locked collateral and outstanding foreign orders cannot fund a new opening", async () => {
  const f = fixture();
  const service = f.service();
  await service.start(f.scope, f.terms, randomUUID());
  f.snapshot.lockedMicros = "99000000";
  await service.tick(f.scope);
  assert.equal(f.submissions.length, 0);
  assert.equal(f.document().sessions[0]!.error, "PERPL_INSUFFICIENT_COLLATERAL");
  const other = fixture();
  const otherService = other.service();
  await otherService.start(other.scope, other.terms, randomUUID());
  other.snapshot.unmanagedOrders = true;
  await otherService.tick(other.scope);
  assert.equal(other.submissions.length, 0);
  assert.equal(other.document().sessions[0]!.status, "frozen");
});
test("a request ID collision with different venue quantity or leverage is refused", async () => {
  const f = fixture();
  const service = f.service();
  await service.start(f.scope, f.terms, randomUUID());
  await service.tick(f.scope);
  f.fill();
  f.snapshot.orders[0]!.originalSize++;
  await service.tick(f.scope);
  assert.equal(f.document().sessions[0]!.error, "PERPL_EVIDENCE_MISMATCH");
  assert.equal(f.submissions.length, 1);
  assert.equal(f.document().orders[0]!.status, "accepted");
});
