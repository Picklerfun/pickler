import { test } from "node:test";
import assert from "node:assert/strict";
import type { RunRecord } from "@pickler/core";
import { consumeWakeup } from "../src/workers/background.js";

const run = (id: string) => ({ id }) as RunRecord;

function fakes(research: RunRecord | null, preview: RunRecord | null) {
  const calls: string[] = [];
  const repository = {
    recover: async () => {
      calls.push("research.recover");
    },
    claim: async () => {
      calls.push("research.claim");
      return research;
    },
    tick: async () => {},
    renew: async () => {},
    close: async () => {
      calls.push("close");
    },
  };
  const previews = {
    repository: {
      recover: async () => {
        calls.push("preview.recover");
      },
      claim: async () => {
        calls.push("preview.claim");
        return preview;
      },
      renew: async () => {},
    },
    execute: async (claimed: RunRecord) => {
      calls.push(`preview.execute:${claimed.id}`);
    },
  };
  const execute = async (claimed: RunRecord) => {
    calls.push(`research.execute:${claimed.id}`);
  };
  const queue = { send: async () => {} };
  return { calls, repository, previews, execute, queue };
}

test("with no research run waiting, a preview is claimed and executed", async () => {
  const f = fakes(null, run("p1"));
  await consumeWakeup(f.repository, f.execute, f.queue, Date.now, f.previews);
  assert.deepEqual(f.calls, [
    "research.recover",
    "preview.recover",
    "research.claim",
    "preview.claim",
    "preview.execute:p1",
    "close",
  ]);
});

test("a research run goes first; the preview waits for the next wakeup", async () => {
  const f = fakes(run("r1"), run("p1"));
  await consumeWakeup(f.repository, f.execute, f.queue, Date.now, f.previews);
  assert.ok(f.calls.includes("research.execute:r1"));
  assert.ok(!f.calls.includes("preview.claim"));
});

test("without previews composed, nothing changes", async () => {
  const f = fakes(null, run("p1"));
  await consumeWakeup(f.repository, f.execute, f.queue);
  assert.deepEqual(f.calls, ["research.recover", "research.claim", "close"]);
});
