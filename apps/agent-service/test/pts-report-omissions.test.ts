import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ptsReport } from "../src/pts-study/report.js";
import { bytesHash } from "../src/pts-study/files.js";

function htmlRows(html: string) {
  const body = html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(body);
  return JSON.parse(body) as Record<string, unknown>[];
}

test("stored data omissions are distinct from future slots and valid holds in every published format", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    throw Error("Offline report cannot access a provider");
  });
  const output = await mkdtemp(join(tmpdir(), "pts-omissions-"));
  const rows = [
    {
      slot: 0,
      symbol: "ZEC",
      variant: "pts-intraday",
      status: "NOT_RECORDED",
      reason: "NOT_VERIFIABLE",
    },
    {
      slot: 1,
      symbol: "ZEC",
      variant: "pts-intraday",
      status: "complete",
      action: "hold",
      reason: "PRIMARY_TREND",
    },
    {
      slot: 2,
      symbol: "ZEC",
      variant: "pts-intraday",
      status: "NOT_RECORDED",
      reason: "NOT_VERIFIABLE",
    },
  ];
  const original = structuredClone(rows);
  const financial = [{ variant: "pts-intraday", fundingPending: true, netRealizedAUSD: null }];
  const unknownCalls = [{ id: "controlled-historical-unknown", reservedUSD: "0.01" }];
  await ptsReport(
    output,
    {
      candidate: "pts-intraday@0.2.0-fast.2",
      processState: "active",
      omittedSlots: [{ slot: 0, phase: "initial-evidence", cause: "STALE_MARKET_DATA" }],
      financial,
      unknownCalls,
    },
    rows,
  );

  const report = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
  assert.equal(report.rows[0].status, "DATA_UNAVAILABLE");
  assert.equal(report.rowPresentation.protocol, "pts-omitted-row-presentation-v1");
  assert.equal(report.rows[0].sourceStatus, "NOT_RECORDED");
  assert.equal(report.rows[0].sourceReason, "NOT_VERIFIABLE");
  assert.equal(report.rows[0].action, undefined);
  assert.deepEqual(report.rows[0].omission, {
    phase: "initial-evidence",
    cause: "STALE_MARKET_DATA",
  });
  assert.deepEqual(report.rows[1], original[1]);
  assert.deepEqual(report.rows[2], original[2]);
  assert.deepEqual(report.financial, financial);
  assert.deepEqual(report.unknownCalls, unknownCalls);
  assert.deepEqual(rows, original);

  const html = await readFile(join(output, "report.html"), "utf8");
  const presented = htmlRows(html);
  assert.equal(presented[0]!.status, "DATA_UNAVAILABLE");
  assert.deepEqual(presented[0]!.omission, report.rows[0].omission);
  assert.equal(presented[1]!.action, "hold");
  assert.equal(presented[2]!.status, "NOT_RECORDED");
  const csv = await readFile(join(output, "report.csv"), "utf8");
  assert.ok(csv.split("\n")[0]!.includes("sourceStatus,sourceReason,omission"));
  assert.ok(csv.includes('"DATA_UNAVAILABLE"'));
  assert.ok(csv.includes("STALE_MARKET_DATA"));
  const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
  for (const name of ["report.json", "report.html", "report.csv"]) {
    assert.equal(manifest.files[name], bytesHash(await readFile(join(output, name), "utf8")));
  }
  assert.equal(requests, 0);
});

test("legacy missing evidence, partial decisions and completed decisions are never relabeled as omissions", async () => {
  const rows = [
    { slot: 0, status: "NOT_RECORDED", reason: "NOT_VERIFIABLE" },
    { slot: 1, status: "incomplete", action: "long", reason: "recorded-proposal" },
    { slot: 2, status: "complete", action: "hold", reason: "PRIMARY_TREND" },
    { slot: 3, status: "NOT_RECORDED", action: "short", reason: "partial-evidence" },
  ];
  const original = structuredClone(rows);
  const output = await mkdtemp(join(tmpdir(), "pts-omissions-legacy-"));
  await ptsReport(
    output,
    {
      omittedSlots: [
        { slot: 1, phase: "final-evidence", cause: "DATA_UNAVAILABLE" },
        { slot: 2, phase: "final-evidence", cause: "DATA_UNAVAILABLE" },
        { slot: 3, phase: "final-evidence", cause: "DATA_UNAVAILABLE" },
      ],
    },
    rows,
  );
  const report = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
  assert.deepEqual(report.rows, original);
  assert.deepEqual(rows, original);
});

test("omission fields keep missing provenance explicit and cannot inject HTML or CSV formulas", async () => {
  const output = await mkdtemp(join(tmpdir(), "pts-omission-safety-"));
  await ptsReport(output, { omittedSlots: [{ slot: 0, cause: "<script>alert(1)</script>" }] }, [
    { slot: 0, status: "NOT_RECORDED", reason: "=HYPERLINK(1)" },
  ]);

  const report = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
  assert.equal(report.rows[0].omission.phase, null);
  assert.equal(report.rows[0].sourceReason, "=HYPERLINK(1)");
  const html = await readFile(join(output, "report.html"), "utf8");
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.equal(htmlRows(html)[0]!.status, "DATA_UNAVAILABLE");
  const csv = await readFile(join(output, "report.csv"), "utf8");
  assert.ok(csv.includes('"\'=HYPERLINK(1)"'));
});
