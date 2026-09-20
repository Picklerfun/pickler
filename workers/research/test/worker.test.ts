import test from "node:test";
import assert from "node:assert/strict";
import type { PostgresResearchStore } from "@pickler/infrastructure";
import type { Env } from "../src/index.js";
import { createResearchWorker } from "../src/worker.js";

test("Queue duplicates without eligible work acknowledge and close each invocation", async () => {
  let closes = 0;
  let acknowledgements = 0;
  let creations = 0;
  const make = () => {
    creations++;
    return {
      recover: async () => {},
      claim: async () => null,
      close: async () => {
        closes++;
      },
    } as unknown as PostgresResearchStore;
  };
  const worker = createResearchWorker({
    repository: make,
    runtime: () => ({
      repository: make(),
      execute: async () => {
        throw new Error("No run expected");
      },
    }),
  });
  const env = {
    ADMISSIONS_ENABLED: "true",
    RESEARCH_QUEUE: {
      send: async () => {
        throw new Error("No wakeup loop expected");
      },
    },
  } as unknown as Env;
  for (let i = 0; i < 2; i++) {
    await worker.queue!(
      {
        messages: [
          {
            body: { kind: "research-wakeup" },
            ack: () => {
              acknowledgements++;
            },
            retry: () => assert.fail("Unexpected retry"),
          },
        ],
      } as never,
      env,
      {} as never,
    );
  }
  assert.equal(creations, 2);
  assert.equal(closes, 2);
  assert.equal(acknowledgements, 2);
});

test("Queue database failure closes the pool and retries only the generic notification", async (t) => {
  let closed = false;
  let retried = false;
  t.mock.method(console, "error", () => {});
  const repository = {
    recover: async () => {
      throw new Error("Database unavailable");
    },
    close: async () => {
      closed = true;
    },
  } as unknown as PostgresResearchStore;
  const worker = createResearchWorker({
    repository: () => repository,
    runtime: () => ({ repository, execute: async () => assert.fail("No execution expected") }),
  });
  await worker.queue!(
    {
      messages: [
        {
          body: { kind: "research-wakeup" },
          ack: () => assert.fail("Should retry wakeup"),
          retry: () => {
            retried = true;
          },
        },
      ],
    } as never,
    { ADMISSIONS_ENABLED: "true" } as Env,
    {} as never,
  );
  assert.equal(closed, true);
  assert.equal(retried, true);
});

test("closed admissions recover expired leases without scheduling and always close", async () => {
  let recovered = false;
  let closed = false;
  const repository = {
    recover: async () => {
      recovered = true;
    },
    close: async () => {
      closed = true;
    },
    tick: async () => assert.fail("No scheduling when disabled"),
  } as unknown as PostgresResearchStore;
  const worker = createResearchWorker({
    repository: () => repository,
    runtime: () => {
      throw new Error("No model needed for Cron");
    },
  });
  await worker.scheduled!({} as never, { ADMISSIONS_ENABLED: "false" } as Env, {} as never);
  assert.equal(recovered, true);
  assert.equal(closed, true);
});
