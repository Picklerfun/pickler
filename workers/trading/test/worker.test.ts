import assert from "node:assert/strict";
import test from "node:test";
import { createTradingWorker, type Env } from "../src/index.js";

test("closed admission rejects private preparation without loading signer", async () => {
  const worker = createTradingWorker(() => {
    throw new Error("must not compose");
  });
  const response = await worker.fetch!(
    new Request("https://internal/prepare", { method: "POST", body: "{}" }) as Request<
      unknown,
      IncomingRequestCfProperties
    >,
    { TRADING_ADMISSIONS_ENABLED: "false" } as Env,
    {} as ExecutionContext,
  );
  assert.equal(response.status, 409);
});
test("closed admission still reconciles and closes the invocation", async () => {
  const calls: unknown[] = [];
  const worker = createTradingWorker(
    () =>
      ({
        service: {
          async tick(enabled: boolean) {
            calls.push(enabled);
          },
        },
        async close() {
          calls.push("closed");
        },
      }) as never,
  );
  await worker.queue!(
    {
      messages: [
        {
          body: { kind: "trading-wakeup" },
          ack() {
            calls.push("ack");
          },
          retry() {
            calls.push("retry");
          },
        },
      ],
    } as unknown as MessageBatch<{ kind: "trading-wakeup" }>,
    { TRADING_ADMISSIONS_ENABLED: "false" } as Env,
    {} as ExecutionContext,
  );
  assert.deepEqual(calls, [false, "ack", "closed"]);
});
test("provider failures close the invocation and retry only the wakeup", async () => {
  const calls: string[] = [];
  const worker = createTradingWorker(
    () =>
      ({
        service: {
          async tick() {
            throw new Error("controlled");
          },
        },
        async close() {
          calls.push("closed");
        },
      }) as never,
  );
  await worker.queue!(
    {
      messages: [
        {
          body: { kind: "trading-wakeup" },
          ack() {
            calls.push("ack");
          },
          retry() {
            calls.push("retry");
          },
        },
      ],
    } as unknown as MessageBatch<{ kind: "trading-wakeup" }>,
    { TRADING_ADMISSIONS_ENABLED: "true" } as Env,
    {} as ExecutionContext,
  );
  assert.deepEqual(calls, ["retry", "closed"]);
});
