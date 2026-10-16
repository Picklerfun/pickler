import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { flushPerplWakeups, tickPerplTrading } from "../src/perpl.js";
import { createTradingWorker, type Env, type TradingWakeup } from "../src/index.js";

const scope = { userId: randomUUID(), productAgentId: randomUUID() };
test("Perpl publication reserves before enqueue and acknowledges only a successful enqueue", async () => {
  const calls: string[] = [];
  const repo = {
    async reserveWakeups() {
      calls.push("reserved");
      return [{ scope, generation: 1, dueAt: Date.now() + 15000 }];
    },
    async acknowledgeWakeup() {
      calls.push("acknowledged");
    },
  };
  const env = {
    TRADING_QUEUE: {
      async send(message: TradingWakeup, options: { delaySeconds: number }) {
        assert.equal(message.kind, "perpl-wakeup");
        assert.ok(options.delaySeconds >= 14 && options.delaySeconds <= 15);
        calls.push("enqueued");
      },
    },
  } as unknown as Env;
  await flushPerplWakeups(env, repo as never);
  assert.deepEqual(calls, ["reserved", "enqueued", "acknowledged"]);
  calls.length = 0;
  const failed = {
    TRADING_QUEUE: {
      async send() {
        calls.push("enqueue-failed");
        throw new Error("controlled interruption");
      },
    },
  } as unknown as Env;
  await assert.rejects(flushPerplWakeups(failed, repo as never));
  assert.deepEqual(calls, ["reserved", "enqueue-failed"]);
});
test("a duplicated Perpl delivery is consumed once and never creates another chain", async () => {
  const calls: string[] = [];
  let consumed = false;
  const runtime = () =>
    ({
      repository: {
        async claimWakeup() {
          if (consumed) {
            return false;
          }
          consumed = true;
          return true;
        },
        async reserveWakeups() {
          return [];
        },
      },
      service: {
        async tick() {
          calls.push("tick");
        },
      },
      async close() {
        calls.push("closed");
      },
    }) as never;
  const message = {
    kind: "perpl-wakeup" as const,
    scope,
    generation: 1,
    owner: "private-reservation",
  };
  const env = {
    TRADING_QUEUE: {
      async send() {
        throw new Error("duplicate created a chain");
      },
    },
  } as unknown as Env;
  await tickPerplTrading(env, runtime, message);
  await tickPerplTrading(env, runtime, message);
  assert.deepEqual(calls, ["tick", "closed", "closed"]);
});
test("Perpl and Polymarket wakeups have independent execution and the existing Cron seeds both", async () => {
  let composed = 0;
  const sent: TradingWakeup[] = [];
  let acknowledged = 0;
  const worker = createTradingWorker(() => {
    composed++;
    throw new Error("Perpl cannot compose Polymarket");
  });
  const env = {
    TRADING_QUEUE: {
      async send(message: TradingWakeup) {
        sent.push(message);
      },
    },
  } as unknown as Env;
  await worker.queue!(
    {
      messages: [
        {
          body: { kind: "perpl-wakeup" },
          ack() {
            acknowledged++;
          },
          retry() {
            throw new Error("unexpected retry");
          },
        },
      ],
    } as unknown as MessageBatch<TradingWakeup>,
    env,
    {} as ExecutionContext,
  );
  assert.equal(composed, 0);
  assert.equal(acknowledged, 1);
  await worker.scheduled!({} as ScheduledController, env, {} as ExecutionContext);
  assert.deepEqual(sent, [{ kind: "trading-wakeup" }, { kind: "perpl-wakeup" }]);
});
