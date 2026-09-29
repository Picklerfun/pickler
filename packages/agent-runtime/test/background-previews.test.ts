import { test } from "node:test";
import assert from "node:assert/strict";
import { PREVIEW_PRIORITY_AFTER_MS, type RunRecord } from "@pickler/core";
import { consumeWakeup } from "../src/workers/background.js";

const NOW = 10_000_000;
const run = (id: string) => ({ id }) as RunRecord;

function fakes(
  research: RunRecord | null,
  preview: RunRecord | null,
  overdue: RunRecord | null = null,
) {
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
      claim: async (_now: number, queuedBefore?: number) => {
        if (queuedBefore !== undefined) {
          assert.equal(queuedBefore, NOW - PREVIEW_PRIORITY_AFTER_MS);
          calls.push("preview.claim:overdue");
          return overdue;
        }
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
  await consumeWakeup(f.repository, f.execute, f.queue, () => NOW, f.previews);
  assert.deepEqual(f.calls, [
    "research.recover",
    "preview.recover",
    "preview.claim:overdue",
    "research.claim",
    "preview.claim",
    "preview.execute:p1",
    "close",
  ]);
});

test("a research run goes ahead of a recent preview", async () => {
  const f = fakes(run("r1"), run("p1"));
  await consumeWakeup(f.repository, f.execute, f.queue, () => NOW, f.previews);
  assert.ok(f.calls.includes("research.execute:r1"));
  assert.ok(!f.calls.includes("preview.claim"));
  assert.ok(!f.calls.some((call) => call.startsWith("preview.execute")));
});

test("a preview queued past the priority window goes ahead of research", async () => {
  const f = fakes(run("r1"), null, run("p-old"));
  await consumeWakeup(f.repository, f.execute, f.queue, () => NOW, f.previews);
  assert.ok(f.calls.includes("preview.execute:p-old"));
  assert.ok(!f.calls.includes("research.claim"));
});

test("without previews composed, nothing changes", async () => {
  const f = fakes(null, run("p1"));
  await consumeWakeup(f.repository, f.execute, f.queue);
  assert.deepEqual(f.calls, ["research.recover", "research.claim", "close"]);
});
