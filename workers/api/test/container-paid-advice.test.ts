import assert from "node:assert/strict";
import test from "node:test";
import {
  createAdviceService,
  PilotError,
  type AdviceJob,
  type AdviceRepository,
} from "@pickler/core";
import type {
  AusdAuthorizationGateway,
  AusdAuthorizationGatewayInput,
} from "@pickler/infrastructure";
import { paidAdviceFrom, reportUnrecordedSettlement } from "../src/container";

const KEY = `0x${"7a".repeat(32)}`;
const RPC = "https://rpc.example.test/secret-token";
const repository = {} as AdviceRepository;
const deps = {
  advice: createAdviceService(repository, { enabled: false, policy: null }),
  repository,
  pool: {} as Parameters<typeof paidAdviceFrom>[1]["pool"],
};

function compose(env: Parameters<typeof paidAdviceFrom>[0]) {
  const logged: string[] = [];
  const paid = paidAdviceFrom(env, deps, (message) => logged.push(message));
  return { paid, logged };
}

const SPLITTER = "0x4444444444444444444444444444444444444444";
const TREASURY = "0x55555555555555555555555555555555555abcde";
const ON = {
  ADVICE_X402_ENABLED: "true",
  X402_RELAYER_PRIVATE_KEY: KEY,
  MONAD_RPC_URL: RPC,
  ADVICE_SPLITTER_ADDRESS: SPLITTER,
  ADVICE_SPLITTER_TREASURY: TREASURY,
};
const user = { kind: "user", id: "user-1" } as Parameters<
  NonNullable<ReturnType<typeof paidAdviceFrom>>["request"]
>[0];

/** A gateway whose only live call is `treasury()`; every other call fails the test. */
function chain(treasury: () => Promise<string>) {
  const calls = { treasury: 0, inputs: [] as AusdAuthorizationGatewayInput[] };
  const unexpected = async (): Promise<never> => {
    throw new Error("the gateway is not used before the treasury is confirmed");
  };
  const gatewayFor = (input: AusdAuthorizationGatewayInput): AusdAuthorizationGateway => {
    calls.inputs.push(input);
    return {
      nonceFor: () => {
        throw new Error("not used");
      },
      signatureValid: unexpected,
      nonceUsed: unexpected,
      balance: unexpected,
      settle: unexpected,
      splitterTreasury: async () => {
        calls.treasury++;
        return treasury();
      },
    };
  };
  return { calls, gatewayFor };
}

const REPLAY = { id: "job-1", symbol: "BTC" } as AdviceJob;

/**
 * Composes with a fake chain and a repository that replays one earlier job: a served request
 * answers `accepted` with it, without touching the database or the chain beyond `treasury()`.
 */
function composeOnChain(
  env: Parameters<typeof paidAdviceFrom>[0],
  treasury: () => Promise<string>,
  confirmedTreasuries = new Set<string>(),
) {
  const logged: string[] = [];
  const fake = chain(treasury);
  const replaying = { requestReplay: async () => REPLAY } as unknown as AdviceRepository;
  const paid = paidAdviceFrom(
    env,
    {
      advice: createAdviceService(replaying, { enabled: false, policy: null }),
      repository: replaying,
      pool: deps.pool,
      gatewayFor: fake.gatewayFor,
      confirmedTreasuries,
    },
    (message) => logged.push(message),
  );
  return { paid, logged, calls: fake.calls };
}

async function served(paid: ReturnType<typeof paidAdviceFrom>) {
  const result = await paid!.request(user, "agent-1", "BTC", "key-1", undefined);
  assert.equal(result.kind, "accepted");
  assert.equal(result.kind === "accepted" ? result.job : null, REPLAY);
}

function isUnavailable(error: unknown): boolean {
  return error instanceof PilotError && error.code === "ADVICE_UNAVAILABLE";
}

function assertNoValue(logged: string[]) {
  for (const line of logged) {
    for (const value of [KEY, "7a".repeat(32), RPC, "secret-token", SPLITTER, TREASURY, "4444"]) {
      assert.equal(line.toLowerCase().includes(value.toLowerCase()), false, "no value is logged");
    }
  }
}

test("the flag with a relayer, RPC and a splitter whose treasury matches composes the sale", async () => {
  const on = composeOnChain(
    { ...ON, ADVICE_SPLITTER_TREASURY: TREASURY.toUpperCase().replace("0X", "0x") },
    async () => TREASURY,
  );

  assert.ok(on.paid, "a flag that is on never leaves the request free");
  assert.equal(on.calls.inputs.length, 1);
  assert.equal(on.calls.inputs[0]!.splitter, SPLITTER, "the gateway settles through the splitter");
  assert.equal(on.calls.inputs[0]!.rpcUrl, RPC);
  await served(on.paid);
  assert.equal(on.calls.treasury, 1, "the treasury is read before the request is served");
  assert.deepEqual(on.logged, []);

  for (const flag of [undefined, "false", "TRUE", "1"]) {
    const off = compose({
      ...ON,
      ...(flag === undefined ? { ADVICE_X402_ENABLED: undefined } : { ADVICE_X402_ENABLED: flag }),
    });

    assert.equal(off.paid, undefined, `flag ${String(flag)} keeps advice free`);
    assert.deepEqual(off.logged, [], "a flag that is off is not a misconfiguration");
  }
});

test("a splitter deployed with another treasury fails closed with 503 and logs no value", async () => {
  const other = "0x6666666666666666666666666666666666666666";
  const confirmed = new Set<string>();
  const on = composeOnChain(ON, async () => other, confirmed);

  assert.ok(on.paid);
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(
      on.paid.request(user, "agent-1", "BTC", "key-1", undefined),
      isUnavailable,
    );
  }

  assert.equal(on.calls.treasury, 2, "a mismatch is never cached as confirmed");
  assert.equal(confirmed.size, 0);
  assert.equal(on.logged.length, 2);
  assert.match(on.logged[0]!, /ADVICE_SPLITTER_TREASURY/);
  assert.match(on.logged[0]!, /ADVICE_SPLITTER_ADDRESS/);
  assertNoValue(on.logged);
  assert.equal(on.logged[0]!.includes("6666"), false, "the on-chain treasury is not logged");
});

test("a failed treasury read refuses that request only, and a match is cached per isolate", async () => {
  const confirmed = new Set<string>();
  let reads = 0;
  const on = composeOnChain(
    ON,
    async () => {
      reads++;
      if (reads === 1) {
        throw new Error(`rpc ${RPC} refused`);
      }
      return TREASURY;
    },
    confirmed,
  );

  assert.ok(on.paid);
  await assert.rejects(on.paid.request(user, "agent-1", "BTC", "key-1", undefined), isUnavailable);
  await served(on.paid);
  await served(on.paid);

  assert.equal(on.calls.treasury, 2, "one failed read, one successful read, then the cache");
  assert.equal(confirmed.size, 1);
  assert.equal(on.logged.length, 1);
  assert.match(on.logged[0]!, /could not be read/);
  assertNoValue(on.logged);

  const next = composeOnChain(ON, async () => TREASURY, confirmed);
  await served(next.paid);
  assert.equal(next.calls.treasury, 0, "a later invocation in the same isolate reads nothing");
});

test("the flag without a usable relayer, RPC or splitter fails closed with 503 and logs no value", async () => {
  const cases: Array<{ env: Parameters<typeof paidAdviceFrom>[0]; names: RegExp }> = [
    { env: { ...ON, X402_RELAYER_PRIVATE_KEY: undefined }, names: /relayer or RPC/ },
    { env: { ...ON, MONAD_RPC_URL: undefined }, names: /relayer or RPC/ },
    { env: { ...ON, X402_RELAYER_PRIVATE_KEY: "not-a-key" }, names: /X402_RELAYER_PRIVATE_KEY/ },
    { env: { ...ON, ADVICE_SPLITTER_ADDRESS: undefined }, names: /ADVICE_SPLITTER_ADDRESS/ },
    { env: { ...ON, ADVICE_SPLITTER_ADDRESS: "" }, names: /ADVICE_SPLITTER_ADDRESS/ },
    { env: { ...ON, ADVICE_SPLITTER_ADDRESS: "0x4444" }, names: /ADVICE_SPLITTER_ADDRESS/ },
    {
      env: { ...ON, ADVICE_SPLITTER_ADDRESS: `0x${"0".repeat(40)}` },
      names: /ADVICE_SPLITTER_ADDRESS/,
    },
    { env: { ...ON, ADVICE_SPLITTER_ADDRESS: `${SPLITTER}00` }, names: /ADVICE_SPLITTER_ADDRESS/ },
    { env: { ...ON, ADVICE_SPLITTER_TREASURY: undefined }, names: /ADVICE_SPLITTER_TREASURY/ },
    { env: { ...ON, ADVICE_SPLITTER_TREASURY: "treasury" }, names: /ADVICE_SPLITTER_TREASURY/ },
    {
      env: { ...ON, X402_RELAYER_PRIVATE_KEY: `0x${"00".repeat(32)}` },
      names: /X402_RELAYER_PRIVATE_KEY or MONAD_RPC_URL was refused/,
    },
  ];
  for (const { env, names } of cases) {
    const { paid, logged } = compose(env);

    assert.ok(paid, "a flag that is on never leaves the request free");
    await assert.rejects(paid.request(user, "agent-1", "BTC", "key-1", undefined), isUnavailable);
    assert.equal(logged.length, 1);
    assert.match(logged[0]!, /advice requests are refused/);
    assert.match(logged[0]!, names);
    assertNoValue(logged);
    for (const value of ["not-a-key", "00".repeat(32), "treasury"]) {
      assert.equal(logged[0]!.includes(value), false, "no value is ever logged");
    }
  }
});

test("an unrecorded settlement is logged with its ids, nonce and hash", () => {
  const logged: string[] = [];
  const report = reportUnrecordedSettlement((message) => logged.push(message));
  const trail = {
    paymentId: "payment-1",
    userId: "user-1",
    publicAgentId: "agent-1",
    key: "key-1",
    payer: `0x${"22".repeat(20)}`,
    nonce: `0x${"ab".repeat(32)}`,
  };
  const hash = `0x${"ef".repeat(32)}`;

  report({ ...trail, reason: "settled_not_recorded", txHash: hash });
  report({ ...trail, reason: "settlement_unknown", txHash: null });

  assert.equal(logged.length, 2);
  for (const value of [...Object.values(trail), "settled_not_recorded", hash]) {
    assert.ok(logged[0]!.includes(value), `the line names ${value}`);
  }
  assert.match(logged[1]!, /settlement_unknown/);
  assert.match(logged[1]!, /tx unknown/);
});
