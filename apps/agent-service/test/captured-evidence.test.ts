import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  prepareCapturedDataset,
  validateCapturedDataset,
} from "../src/evaluation/captured-evidence";
import { makePlan, rubricForState } from "../src/evaluation/decision-evaluation";

const runId = "6fc5831a-f05d-448c-bc7f-5a4845986652";
const source = {
  id: "source-1",
  url: "https://example.com/report",
  title: "Saved report",
  content: "The player is unavailable.",
  retrievedAt: "2026-09-17T12:00:00Z",
  publishedAt: "2026-09-17T11:00:00Z",
  truncated: false,
};
const capture = {
  run: {
    id: runId,
    finishedAt: Date.parse("2026-09-17T13:00:00Z"),
    decision: { marketId: "123", modelAssessment: { secret: "previous-model-label" } },
    tenantId: "private-tenant",
    config: { token: "private-key" },
  },
  events: {
    events: [
      { type: "runtime", data: { secret: "private-runtime" } },
      { type: "sources", data: { sources: [{ ...source, credential: "private-source-field" }] } },
    ],
  },
};
const selections = [
  {
    id: "player-availability",
    runId,
    split: "dev",
    claim: "The player is available.",
    sourceIds: ["source-1"],
    canResearch: true,
  },
];
function draft() {
  return prepareCapturedDataset([capture], selections);
}
function reviewed() {
  const dataset = draft();
  dataset.cases[0]!.expected = { evidence: "CONTRADICTED", next: "FINALIZE" };
  dataset.cases[0]!.review = {
    reviewer: "unit-test-reviewer",
    reviewedAt: "2026-09-22T12:00:00Z",
    rationale: "The saved source explicitly says the player is unavailable.",
  };
  return dataset;
}

test("capture preparation exports only selected evidence and never copies prior model labels", () => {
  const dataset = draft();
  const serialized = JSON.stringify(dataset);
  assert.equal(serialized.includes("private-"), false);
  assert.equal(serialized.includes("previous-model-label"), false);
  assert.equal(dataset.cases[0]!.expected, null);
  assert.equal(dataset.cases[0]!.review, null);
  assert.equal(dataset.cases[0]!.state.synthetic, false);
  assert.throws(() => validateCapturedDataset(dataset, true), { code: "HUMAN_REVIEW_REQUIRED" });
});

test("reviewed cases preserve provenance outside model inputs and use a separate rubric", () => {
  const dataset = validateCapturedDataset(reviewed(), true);
  const item = dataset.cases[0]!;
  const plan = makePlan("jev", item.state, { TYPESAFE_API_KEY: "test-key" });
  const input = JSON.parse(plan.body);
  assert.equal(input.state.synthetic, false);
  for (const field of ["review", "expected", "origin", "runId", "split"]) {
    assert.equal(field in input.state, false);
  }
  assert.equal(plan.body.includes("unit-test-reviewer"), false);
  assert.equal(rubricForState(item.state).version, "1.0.0-captured");
});

test("source hashes and snapshot boundaries reject modified or future evidence", () => {
  const changed = reviewed();
  changed.cases[0]!.state.documents[0]!.text = "The player is available.";
  assert.throws(() => validateCapturedDataset(changed, true), {
    code: "SOURCE_PROVENANCE_MISMATCH",
  });
  for (const field of ["retrievedAt", "publishedAt"] as const) {
    const future = reviewed();
    future.cases[0]!.origin.sources[0]![field] = "2026-09-18T12:00:00Z";
    assert.throws(() => validateCapturedDataset(future, true), { code: "EVIDENCE_AFTER_SNAPSHOT" });
  }
});

test("duplicate cases, leaked event partitions, and incoherent review labels are rejected", () => {
  const duplicate = reviewed();
  duplicate.cases.push(structuredClone(duplicate.cases[0]!));
  assert.throws(() => validateCapturedDataset(duplicate, true), { code: "DUPLICATE_CASE_ID" });
  duplicate.cases[1]!.id = "another-claim";
  duplicate.cases[1]!.split = "holdout";
  assert.throws(() => validateCapturedDataset(duplicate, true), { code: "CROSS_SPLIT_LEAKAGE" });
  const inconsistent = reviewed();
  inconsistent.cases[0]!.expected!.next = "RESEARCH";
  assert.throws(() => validateCapturedDataset(inconsistent, true), {
    code: "INCONSISTENT_REVIEW_LABELS",
  });
});

test("selection errors, credentials in URLs and ambiguous source revisions fail closed", () => {
  assert.throws(
    () => prepareCapturedDataset([capture], [{ ...selections[0], sourceIds: ["missing"] }]),
    { code: "SOURCE_NOT_FOUND" },
  );
  const unsafe = structuredClone(capture);
  unsafe.events.events.push({
    type: "source",
    data: { ...source, url: "https://example.com/report?api_key=secret" },
  } as never);
  assert.throws(() => prepareCapturedDataset([unsafe], selections), {
    code: "INVALID_SELECTED_SOURCE",
  });
  const ambiguous = structuredClone(capture);
  ambiguous.events.events.push({
    type: "source",
    data: { ...source, content: "Different version" },
  } as never);
  assert.throws(() => prepareCapturedDataset([ambiguous], selections), {
    code: "AMBIGUOUS_SOURCE_VERSION",
  });
});

test("captured CLI shadow mode never grades drafts or reviewed labels and retains the graded gate", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "captured-shadow-"));
  const script = fileURLToPath(new URL("../src/evaluate-decisions.ts", import.meta.url));
  const datasetPath = join(temporary, "dataset.json");
  const directories: URL[] = [];
  const run = (extra: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", script, "--limit", "1", ...extra], {
      encoding: "utf8",
    });
  try {
    const invalid = run(["--shadow"]);
    assert.match(invalid.stderr, /SHADOW_REQUIRES_CAPTURED_DATASET/);
    await writeFile(datasetPath, JSON.stringify(draft()));
    const denied = run(["--dataset", datasetPath]);
    assert.match(denied.stderr, /HUMAN_REVIEW_REQUIRED/);
    for (const dataset of [draft(), reviewed()]) {
      await writeFile(datasetPath, JSON.stringify(dataset));
      const attempt = `test-${randomUUID()}`;
      const directory = new URL(`../.data/decision-evaluation-v1/${attempt}/`, import.meta.url);
      directories.push(directory);
      const result = run(["--dataset", datasetPath, "--shadow", "--attempt", attempt]);
      assert.equal(result.status, 0, result.stderr);
      const summary = JSON.parse(await readFile(new URL("summary.json", directory), "utf8"));
      assert.equal(summary.mode, "shadow-unscored");
      assert.equal(summary.summary[0].graded, 0);
      assert.equal(summary.summary[0].exactMatches, null);
      assert.equal(summary.summary[0].unsafeFinalizations, null);
      assert.equal("grade" in summary.rows[0], false);
      const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8"));
      assert.equal(manifest.cases[0].expected, null);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
    for (const directory of directories) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("public excerpts retain collection provenance and explicit events prevent leakage across markets", async () => {
  const { preparePublicEvidence, capturedCoverage } =
    await import("../src/evaluation/captured-evidence");
  const collection = {
    kind: "public-excerpt-collection",
    snapshots: [
      {
        snapshotId: runId,
        eventId: "event-one",
        observedAt: "2026-09-17T13:00:00Z",
        split: "dev",
        sources: [source],
        claims: [
          {
            id: "public-claim",
            claim: "The player is available.",
            sourceIds: [source.id],
            canResearch: true,
          },
        ],
      },
    ],
  };
  const dataset = preparePublicEvidence(collection);
  assert.equal(dataset.cases[0]!.origin.runId, undefined);
  assert.equal(dataset.cases[0]!.origin.snapshotId, runId);
  assert.equal(capturedCoverage(dataset).explicitEvents, 1);
  assert.equal(capturedCoverage(dataset).reviewedCases, 0);
  assert.throws(() => validateCapturedDataset(dataset, true), { code: "HUMAN_REVIEW_REQUIRED" });
  const other = reviewed();
  other.cases[0]!.origin.eventId = "event-one";
  other.cases[0]!.split = "holdout";
  assert.throws(
    () => validateCapturedDataset({ ...dataset, cases: [...dataset.cases, ...other.cases] }, false),
    { code: "CROSS_SPLIT_LEAKAGE" },
  );
  const invalid = structuredClone(dataset);
  invalid.cases[0]!.origin.runId = runId;
  assert.throws(() => validateCapturedDataset(invalid, false), { code: "INVALID_CAPTURE_ORIGIN" });
  const future = structuredClone(collection);
  future.snapshots[0]!.observedAt = "2026-09-16T13:00:00Z";
  assert.throws(() => preparePublicEvidence(future), { code: "EVIDENCE_AFTER_SNAPSHOT" });
});
