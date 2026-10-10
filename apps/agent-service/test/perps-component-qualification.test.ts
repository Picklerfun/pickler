import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalAudit, qualifyComponentPaperCapture } from "@pickler/trading/evaluation";
import {
  COMPONENT_PAPER_POLICY,
  UNIVERSE_COMPONENT_STREAM_POLICY,
  universeStreamValidation,
} from "@pickler/trading/perps";
import { config, evidence, at } from "./perps-reentry-fixtures.js";
import { adoptComponentQualification } from "../src/perps-study/component-qualification.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const captureConfig = { ...config, acquisitionPolicy: UNIVERSE_COMPONENT_STREAM_POLICY };
  const capture = {
    version: 4,
    protocol: "perps-universe-stability-v1",
    commit: "a".repeat(40),
    acquisitionPolicy: UNIVERSE_COMPONENT_STREAM_POLICY,
    config: captureConfig,
    configurationHash: hash(canonicalAudit(captureConfig)),
    catalogHash: hash(canonicalAudit(config.markets)),
    passed: true,
    readerClosed: true,
    error: null,
    adapterVersion: "public-universe-stream-v4",
    startedAt: at,
    endsAt: at + 1800000,
    ownershipFailures: 0,
    reconstructionErrors: 0,
    leaseReleased: true,
    strictValidCycles: 0,
    dataValidation: universeStreamValidation(UNIVERSE_COMPONENT_STREAM_POLICY),
    stream: {
      bytes: 1,
      hash: hash("\n"),
      truncated: false,
      socketClosed: true,
      connections: 1,
      disconnects: 0,
      messages: 1,
      errors: [] as unknown[],
    },
    cycles: Array.from({ length: 30 }, (_, slot) => {
      const now = at + slot * 60000;
      const frames = evidence(now).frames;
      for (const f of frames) {
        f.snapshot.ticker.provenance = {
          ...f.snapshot.ticker.provenance,
          providerTimestamp: now - 20000,
        };
        f.book.provenance = { ...f.book.provenance, providerTimestamp: now };
        f.hash = hash(JSON.stringify({ snapshot: f.snapshot, book: f.book }));
      }
      return {
        slot,
        at: now,
        scheduledAt: now,
        validatedAt: now,
        valid: true,
        missed: false,
        strictJointValid: false,
        financialExecutable: false,
        durationMs: 1,
        frames,
        markets: config.markets.map((m) => ({ ...m, valid: true, strictValid: false })),
        bufferGeneration: 1,
        bufferCopiedAt: now,
        bufferContinuity: {
          heartbeatSequence: slot + 1,
          headBlock: slot + 100,
          heartbeatReceivedAt: now,
        },
        requests: [],
        acquisition: [],
      };
    }),
  };
  const paper = {
    ...config,
    sessionId: "new-component-paper",
    acquisitionPolicy: COMPONENT_PAPER_POLICY,
    captureQualification: { commit: capture.commit, reportSha256: hash(JSON.stringify(capture)) },
  };
  return { capture, paper };
}

test("pinned capture is revalidated without reconstructing historical financial actions", () => {
  const { capture, paper } = fixture();
  const before = structuredClone(capture);
  const proof = qualifyComponentPaperCapture(capture, paper, hash);
  assert.equal(proof.validCycles, 30);
  assert.equal(proof.validatedMarkets, 330);
  assert.equal(proof.historicalFills, 0);
  assert.equal(proof.dataValidation.financialAdmission, true);
  assert.equal(capture.dataValidation.financialAdmission, false);
  assert.deepEqual(capture, before);
  assert.deepEqual(qualifyComponentPaperCapture(capture, paper, hash), proof);
});

test("qualification refuses altered native dates, frame hashes, configuration and missing closure", () => {
  for (const alter of [
    (f: ReturnType<typeof fixture>) => {
      f.capture.cycles[0]!.frames[0]!.hash = "b".repeat(64);
    },
    (f: ReturnType<typeof fixture>) => {
      f.capture.leaseReleased = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.capture.stream.truncated = true;
    },
    (f: ReturnType<typeof fixture>) => {
      f.capture.stream.errors.push("failure");
    },
    (f: ReturnType<typeof fixture>) => {
      f.capture.cycles[0]!.bufferContinuity.heartbeatReceivedAt -= 5001;
    },
    (f: ReturnType<typeof fixture>) => {
      f.capture.configurationHash = "c".repeat(64);
    },
    (f: ReturnType<typeof fixture>) => {
      f.paper.tenantId = "different-campaign";
    },
  ]) {
    const f = fixture();
    alter(f);
    assert.throws(() => qualifyComponentPaperCapture(f.capture, f.paper, hash));
  }
});

test("one missed cycle is retained as missed, never fabricated into an acquisition", () => {
  const { capture, paper } = fixture();
  const missed = capture.cycles[29]!;
  missed.valid = false;
  missed.missed = true;
  missed.frames = [];
  for (const market of missed.markets) {
    market.valid = false;
  }
  const proof = qualifyComponentPaperCapture(capture, paper, hash);
  assert.equal(proof.validCycles, 29);
  assert.equal(proof.observations[29]!.jointValid, false);
  assert.equal(proof.validatedMarkets, 319);
});

test("adoption rejects unpinned bytes before git, environment, database or providers", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "component-qualification-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = join(directory, "source.json");
  const { capture, paper } = fixture();
  await writeFile(state, JSON.stringify(capture) + "\n");
  await assert.rejects(
    adoptComponentQualification(
      state,
      paper,
      "a".repeat(40),
      directory,
      new AbortController().signal,
    ),
    { code: "QUALIFICATION_REQUIRED" },
  );
});
