import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, PERP_TOOLS, type AgentRecord } from "@pickler/core";
import { createPriorityPerplStudyData } from "@pickler/agent-runtime/plugins/perps-paper";
import { PerplRequestSchedule } from "@pickler/infrastructure";
import type { PerpsStudyRecord } from "@pickler/trading/evaluation";
import { config, at } from "./perps-reentry-fixtures.js";

function context(time: number) {
  return {
    chain: { chain_id: 143, gas: { h: 100 } },
    instances: [{ id: 1, address: "0x" + "1".repeat(40), collateral_token_id: 1 }],
    tokens: [{ id: 1, address: "0x" + "2".repeat(40), symbol: "AUSD", decimals: 6 }],
    markets: config.markets.map((m) => ({
      ver: 1,
      id: m.marketId,
      instance_id: 1,
      perpetual_id: m.marketId,
      symbol: "",
      name: m.symbol,
      size_units: m.symbol,
      funding_interval_sec: 3600,
      funding_interval_blocks: 100,
      config: {
        at: { t: time - 86400000, b: 1 },
        is_open: true,
        price_decimals: 1,
        size_decimals: 2,
        initial_margin: 1000,
        maintenance_margin: 2000,
        maker_fee: 45,
        taker_fee: 345,
      },
      funding: { at: { t: time, b: 100 }, feb: 100, rate: 0 },
    })),
  };
}

test("priority public reader observes without candles, caches guarded closed windows and refreshes boundaries", async () => {
  let time = at,
    revoked = false;
  const paths: string[] = [],
    diagnostics: unknown[] = [];
  const schedule = new PerplRequestSchedule();
  const agent: AgentRecord = {
    id: "public",
    tenantId: "alpha",
    version: 1,
    paused: false,
    scheduleEnabled: false,
    nextDueAt: null,
    config: {
      ...structuredClone(DEFAULT_CONFIG),
      plugins: { version: 1, enabled: ["perpl"] },
      tools: [...PERP_TOOLS],
      perpl: { version: 2, network: "mainnet", markets: config.markets.map((m) => m.symbol) },
    },
  };
  const reader = createPriorityPerplStudyData(
    { agent: async () => ({ ...agent, paused: revoked }) },
    {
      now: () => time,
      schedule,
      onDiagnostic: (v) => diagnostics.push(v),
      transport: async (input, options) => {
        assert.equal(options?.method, "GET");
        assert.equal(options?.headers, undefined);
        schedule.lastStart = -Infinity; // Controlled transport only: no real-time provider pacing wait.
        const path = new URL(String(input)).pathname;
        paths.push(path);
        if (path.endsWith("context")) {
          return Response.json(context(time));
        }
        if (path.endsWith("ticker")) {
          return Response.json({
            mt: 9,
            sn: 1,
            d: Object.fromEntries(
              config.markets.map((m) => [
                m.marketId,
                {
                  at: { t: time, b: 100 },
                  mrk: 1000,
                  orl: 1000,
                  lst: 1000,
                  bid: 999,
                  ask: 1001,
                  oi: 100,
                },
              ]),
            ),
          });
        }
        if (path.endsWith("book")) {
          return Response.json({
            mt: 15,
            sn: 1,
            at: { t: time, b: 100 },
            bid: [{ p: 999, s: 10000, o: 1 }],
            ask: [{ p: 1001, s: 10000, o: 1 }],
          });
        }
        const match = /candles\/(\d+)\/(\d+)-(\d+)/.exec(path);
        assert.ok(match, "Only public price and candle routes expected");
        const resolution = Number(match[1]),
          from = Number(match[2]);
        return Response.json({
          at: { t: time, b: 100 },
          r: resolution,
          d: Array.from({ length: 60 }, (_, i) => ({
            t: from + i * resolution * 1000,
            o: 1000,
            c: i >= 40 ? 1010 : 1000,
            h: 1020,
            l: 990,
            v: "1000000",
            n: 10,
          })),
        });
      },
    },
  );
  const record = {
    config,
    agentIds: { "sma-reference": agent.id, "sma-once-bar": "other" },
  } as PerpsStudyRecord;
  const signal = new AbortController().signal;
  let guards = 0;
  const guard = async () => {
    guards++;
  };
  const observation = await reader.observe(record, signal, guard);
  assert.equal(observation.frames.length, 11);
  assert.equal(observation.marksOnly, true);
  assert.ok(paths.every((p) => !p.includes("candles")));
  const initial = await reader.prepareEvidence!(record, signal, guard);
  assert.equal(initial.frames.length, 11);
  assert.equal(initial.candles.length, 33);
  const reads = paths.filter((p) => p.includes("candles")).length;
  await reader.finalEvidence(record, signal, guard);
  assert.equal(paths.filter((p) => p.includes("candles")).length, reads);
  time += 300000;
  await reader.finalEvidence(record, signal, guard);
  assert.equal(paths.filter((p) => p.includes("candles")).length, reads + 11);
  assert.ok(guards > paths.length);
  assert.ok(diagnostics.every((d) => (d as { version: number }).version === 2));
  revoked = true;
  await assert.rejects(reader.finalEvidence(record, signal, guard), { code: "CONFIG_CHANGED" });
  await reader.close();
  await assert.rejects(reader.observe(record, signal, guard), { code: "DATA_READER_CLOSED" });
});
