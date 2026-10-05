import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DRAFTS_PER_WORKSPACE,
  MIN_FUNDED_AUSD,
  canCreateAnother,
  canSchedule,
} from "../src/features/studio/locks.js";
import { assertCanSchedule, isReadyToSchedule } from "../src/features/research/policy.js";
import {
  DEFAULT_CONFIG,
  type AgentConfig,
  type AgentRecord,
} from "../src/features/research/types.js";

test("the schedule needs one successful run and ten AUSD", () => {
  assert.deepEqual(canSchedule({ ready: false, balanceAusd: 50 }), {
    ok: false,
    reason: "first_run",
  });
  assert.deepEqual(canSchedule({ ready: true, balanceAusd: 9.99 }), {
    ok: false,
    reason: "unfunded",
  });
  assert.deepEqual(canSchedule({ ready: true, balanceAusd: MIN_FUNDED_AUSD }), {
    ok: true,
    reason: null,
  });
});

test("another agent needs every existing one funded", () => {
  assert.deepEqual(canCreateAnother([]), { ok: true, reason: null });
  assert.deepEqual(canCreateAnother([12, 40]), { ok: true, reason: null });
  assert.deepEqual(canCreateAnother([12, 3]), { ok: false, reason: "unfunded_agent" });
});

test("drafts hold no funds, so they close the lock only at their own limit", () => {
  assert.equal(MAX_DRAFTS_PER_WORKSPACE, 3);
  assert.deepEqual(canCreateAnother([], 2), { ok: true, reason: null });
  assert.deepEqual(canCreateAnother([12], 3), { ok: false, reason: "draft_limit" });
  assert.deepEqual(canCreateAnother([3], 3), { ok: false, reason: "unfunded_agent" });
});

test("isReadyToSchedule agrees with the NOT_READY refusal in every combination", () => {
  const scoped = {
    ...DEFAULT_CONFIG,
    categoryIds: undefined,
    marketScope: {
      version: 1 as const,
      category: "sports",
      subcategories: ["american-football" as const],
    },
  };
  const unscoped = { ...DEFAULT_CONFIG, categoryIds: [] };
  const perpl: AgentConfig = {
    ...unscoped,
    perpl: { version: 1, network: "testnet", markets: ["BTC", "ETH"] },
  };
  const emptyPerpl: AgentConfig = { ...perpl, perpl: { ...perpl.perpl!, markets: [] } };
  let readyCount = 0;

  for (const paused of [false, true]) {
    for (const config of [scoped, unscoped, perpl, emptyPerpl]) {
      for (const connectionsChecked of [false, true]) {
        for (const manualSucceeded of [false, true]) {
          const agent: AgentRecord = {
            id: "a",
            tenantId: "t",
            version: 1,
            config,
            paused,
            scheduleEnabled: false,
            nextDueAt: null,
          };
          const facts = { connectionsChecked, manualSucceeded };
          const ready = isReadyToSchedule(agent, facts);
          readyCount += ready ? 1 : 0;

          if (ready) {
            assert.doesNotThrow(() =>
              assertCanSchedule(agent, connectionsChecked, manualSucceeded),
            );
          } else {
            assert.throws(() => assertCanSchedule(agent, connectionsChecked, manualSucceeded), {
              code: "NOT_READY",
            });
          }
        }
      }
    }
  }

  assert.equal(readyCount, 2);
});
