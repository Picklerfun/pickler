import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunRecord } from "@pickler/core";
import { executeWithLease } from "../src/workers/lease";

test("heartbeat failure aborts active execution and cleans up its timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let renewals = 0;
  let aborted = false;
  const execution = executeWithLease(
    {
      renew: async () => {
        renewals++;
        throw new Error("offline");
      },
    },
    {} as RunRecord,
    async (_run, signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve();
          },
          { once: true },
        ),
      );
    },
  );
  t.mock.timers.tick(15000);
  await execution;
  assert.equal(aborted, true);
  assert.equal(renewals, 1);
  t.mock.timers.tick(60000);
  assert.equal(renewals, 1);
});

test("successful execution cancels heartbeat without waiting for its interval", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let renewals = 0;
  await executeWithLease(
    {
      renew: async () => {
        renewals++;
      },
    },
    {} as RunRecord,
    async () => {},
  );
  t.mock.timers.tick(60000);
  assert.equal(renewals, 0);
});
