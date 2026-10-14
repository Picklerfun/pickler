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

const existingCredentials = { apiKey: "controlled-existing-token", privateKeyHex: "07".repeat(32) };
function enableExistingKeys(f: ReturnType<typeof fixture>) {
  f.driver.connectExistingKey = async () => ({
    accountId: 7,
    publicKey: "controlled-public-key",
    encryptedKey: "new-encrypted-key",
    encryptedToken: "new-encrypted-token",
    snapshot: structuredClone(f.snapshot),
  });
}
test("connecting a verified existing key preserves admission closure and never starts or funds", async () => {
  const f = fixture();
  enableExistingKeys(f);
  const state = await f.service(false).connectExistingKey(f.scope, existingCredentials);
  assert.equal(state.admissionsEnabled, false);
  assert.equal(f.document().encryptedKey, "new-encrypted-key");
  assert.equal(f.document().encryptedToken, "new-encrypted-token");
  assert.equal(f.document().sessions.length, 0);
  assert.equal(f.document().setup.length, 0);
  assert.equal(f.submissions.length, 0);
  assert.ok(f.document().keyExpiresAt! <= Date.now() + 86401000);
});
test("ownership and active-session fences apply before existing-key validation", async () => {
  const f = fixture();
  let validations = 0;
  f.driver.connectExistingKey = async () => {
    validations++;
    throw new Error("Must not validate");
  };
  await assert.rejects(
    f.service().connectExistingKey({ ...f.scope, userId: randomUUID() }, existingCredentials),
    { code: "NOT_FOUND" },
  );
  await f.service().start(f.scope, f.terms, randomUUID());
  await assert.rejects(f.service().connectExistingKey(f.scope, existingCredentials), {
    code: "PERPL_SESSION_PENDING",
  });
  assert.equal(validations, 0);
});
test("an owner change during key validation cannot persist credentials", async () => {
  const f = fixture();
  enableExistingKeys(f);
  const validate = f.driver.connectExistingKey!;
  f.driver.connectExistingKey = async (...args) => {
    const connected = await validate(...args);
    f.authority.paused = true;
    return connected;
  };
  await assert.rejects(f.service().connectExistingKey(f.scope, existingCredentials), {
    code: "PERPL_ENTRIES_PAUSED",
  });
  assert.equal(f.document().encryptedToken, "test-only");
});
test("concurrent key replacement cannot overwrite the winning credential", async () => {
  const f = fixture();
  enableExistingKeys(f);
  const validate = f.driver.connectExistingKey!;
  f.driver.connectExistingKey = async (...args) => {
    const connected = await validate(...args);
    await f.repository.transact(f.scope, (document) => {
      document.encryptedToken = "other-connection";
    });
    return connected;
  };
  await assert.rejects(f.service().connectExistingKey(f.scope, existingCredentials), {
    code: "CONFLICT",
  });
  assert.equal(f.document().encryptedToken, "other-connection");
});

test("existing-key sessions can run while automatic setup and funding remain closed", async () => {
  const f = fixture();
  const service = createPerplLiveService({
    repository: f.repository,
    driver: f.driver,
    admissions: true,
    setupAdmissions: false,
    randomId: randomUUID,
  });
  const state = await service.state(f.scope);
  assert.equal(state.admissionsEnabled, true);
  assert.equal(state.setupAdmissionsEnabled, false);
  await assert.rejects(service.prepareSetup(f.scope, "100000000", randomUUID()), {
    code: "PERPL_ADMISSIONS_PAUSED",
  });
  await service.start(f.scope, f.terms, randomUUID());
  assert.equal(f.document().sessions.length, 1);
  assert.equal(f.document().setup.length, 0);
  assert.equal(f.submissions.length, 0);
});

test("closed account setup permits receipt reads but prevents funding redrive", async () => {
  const f = fixture();
  await f.repository.transact(f.scope, (document) => {
    document.setup.push({
      id: randomUUID(),
      key: randomUUID(),
      kind: "deposit",
      status: "submitted",
      amountMicros: "10000000",
      createdAt: Date.now(),
      activity: null,
      privatePreparation: null,
      activityId: "completed-owner-activity",
      txHash: "0x" + "22".repeat(32),
      error: null,
    });
  });
  let receiptReads = 0;
  let fundingRedrives = 0;
  let refusal = "";
  f.driver.reconcileSetup = async (_authority, _document, _setup, guard) => {
    receiptReads++;
    try {
      await guard();
      fundingRedrives++;
    } catch (error) {
      refusal = error instanceof PilotError ? error.code : "unexpected";
      throw error;
    }
    return { confirmed: false };
  };
  const service = createPerplLiveService({
    repository: f.repository,
    driver: f.driver,
    admissions: true,
    setupAdmissions: false,
    randomId: randomUUID,
  });
  await service.tick(f.scope);
  assert.equal(receiptReads, 1);
  assert.equal(fundingRedrives, 0);
  assert.equal(refusal, "PERPL_ADMISSIONS_PAUSED");
  assert.equal(f.document().setup[0]!.status, "submitted");
  assert.equal(f.submissions.length, 0);
});

for (const foreignChange of ["size", "leverage"] as const) {
  test(`a foreign position ${foreignChange} change cannot be closed by the session`, async () => {
    const f = fixture();
    const service = f.service();
    await service.start(f.scope, f.terms, randomUUID());
    await service.tick(f.scope);
    f.fill();
    f.snapshot.positions[0]![foreignChange]++;
    await service.tick(f.scope);
    assert.equal(f.document().sessions[0]!.status, "frozen");
    assert.equal(f.document().sessions[0]!.error, "PERPL_UNEXPECTED_POSITION");
    assert.equal(f.submissions.length, 1);
  });
}

test("a stale zero-size active snapshot cannot cause a zero-size closing order", async () => {
  const f = fixture();
  const service = f.service();
  await service.start(f.scope, f.terms, randomUUID());
  await service.tick(f.scope);
  f.fill();
  await service.tick(f.scope);
  f.advance(31000);
  await service.tick(f.scope);
  f.fill();
  f.snapshot.positions[0]!.closed = false;
  await service.tick(f.scope);
  assert.equal(f.document().sessions[0]!.status, "frozen");
  assert.equal(f.document().sessions[0]!.error, "PERPL_UNEXPECTED_POSITION");
  assert.equal(f.submissions.length, 2);
});

function existingPosition(marketId = 32) {
  return {
    requestId: 0,
    id: 900,
    marketId,
    side: "long" as const,
    size: 200,
    entryPrice: 2000,
    collateralMicros: "10000000",
    leverage: 1200,
    feeMicros: "3000",
    realizedPnlMicros: null,
    fundingMicros: null,
    exitPrice: null,
    closed: false,
  };
}

test("an isolated session preserves existing positions in other markets through its complete cycle", async () => {
  const f = fixture();
  const prior = existingPosition();
  f.snapshot.positions.push(structuredClone(prior));
  const service = f.service();

  await service.start(f.scope, f.terms, randomUUID());
  await service.tick(f.scope);
  assert.deepEqual(f.document().sessions[0]!.preservedPositions, [{ id: prior.id, marketId: 32 }]);
  f.fill();
  f.snapshot.positions.push(structuredClone(prior));
  await service.tick(f.scope);
  f.advance(31_000);
  await service.tick(f.scope);
  f.fill();
  await service.tick(f.scope);

  assert.deepEqual(
    f.submissions.map((order) => order.t),
    [1, 3],
  );
  assert.ok(f.submissions.every((order) => order.mkt === 16));
  assert.equal(f.document().sessions[0]!.status, "completed");
  assert.equal(f.document().sessions[0]!.completedCycles, 1);
  assert.deepEqual(
    f.snapshot.positions.find((p) => p.id === prior.id),
    prior,
  );
});

test("an existing position in the selected market prevents any opening or closing", async () => {
  const f = fixture();
  f.snapshot.positions.push(existingPosition(16));
  const service = f.service();

  await service.start(f.scope, f.terms, randomUUID());
  await service.tick(f.scope);
  await service.control(f.scope, "stop");
  await service.tick(f.scope);

  assert.equal(f.submissions.length, 0);
  assert.equal(f.document().sessions[0]!.error, "PERPL_MARKET_OCCUPIED");
  assert.equal(f.document().sessions[0]!.status, "stopped");
  await service.start(f.scope, f.terms, randomUUID());
  assert.equal(f.document().sessions.length, 2);
});

test("positions added after the preserved baseline cannot be silently adopted", async () => {
  const f = fixture();
  const service = f.service();
  await service.start(f.scope, f.terms, randomUUID());
  await service.tick(f.scope);
  f.fill();
  f.snapshot.positions.push(existingPosition());
  f.advance(31_000);

  await service.tick(f.scope);

  assert.equal(f.submissions.length, 1);
  assert.equal(f.document().sessions[0]!.status, "frozen");
  assert.equal(f.document().sessions[0]!.error, "PERPL_UNEXPECTED_POSITION");
});

test("explicit key-wallet connection records verified identity and closes custody setup", async () => {
  const f = fixture();
  enableExistingKeys(f);
  const original = f.driver.connectExistingKey!;
  const address = "0x" + "22".repeat(20);
  f.driver.connectExistingKey = async (...args) => ({ ...(await original(...args)), address });
  const service = f.service();

  const state = await service.connectExistingKey(f.scope, {
    ...existingCredentials,
    useKeyWallet: true,
  });

  assert.equal(f.document().address, address);
  assert.deepEqual(f.document().connection, {
    kind: "key_wallet",
    custodyAddress: f.authority.address,
  });
  assert.equal(state.setupAdmissionsEnabled, false);
  await assert.rejects(service.prepareSetup(f.scope, "10000000", randomUUID()), {
    code: "PERPL_EXTERNAL_WALLET_SETUP",
  });
  assert.equal(f.submissions.length, 0);
});

test("existing sessions and historical orders cannot move to another key wallet", async () => {
  const f = fixture();
  const service = f.service();
  await service.start(f.scope, f.terms, randomUUID());
  await service.control(f.scope, "stop");
  await service.tick(f.scope);
  enableExistingKeys(f);
  const original = f.driver.connectExistingKey!;
  f.driver.connectExistingKey = async (...args) => ({
    ...(await original(...args)),
    address: "0x" + "22".repeat(20),
  });

  await assert.rejects(
    service.connectExistingKey(f.scope, { ...existingCredentials, useKeyWallet: true }),
    { code: "PERPL_ACCOUNT_CHANGED" },
  );
  assert.equal(f.document().address, f.authority.address);
});
