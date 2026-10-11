import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Ajv from "ajv/dist/2020.js";
import { runPtsCommand } from "../src/pts-study/index.js";
import { ptsReport } from "../src/pts-study/report.js";
import { digest, bytesHash } from "../src/pts-study/files.js";
import { intradayFixture, intradayTime } from "@pickler/trading/testing/pts-intraday";
import { PTS_INTRADAY_POLICY, assertPtsConfig } from "@pickler/trading/pts";

test("independent intraday descriptor pins untouched course and native policy; basic template remains separate", async () => {
  const root = new URL("../../../knowledge/trading/", import.meta.url).pathname;
  const descriptor = JSON.parse(
    await readFile(join(root, "pts-versions/pts-intraday/0.1.0.json"), "utf8"),
  );
  const schema = JSON.parse(
    await readFile(join(root, "pts-versions/schemas/candidate-v3.schema.json"), "utf8"),
  );
  const validate = new Ajv({ strict: true }).compile(schema);
  assert.equal(validate(descriptor), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...descriptor, studioSelectable: true }), false);
  assert.equal(validate({ ...descriptor, id: "pts-trend-reversal" }), false);
  const policy = await readFile(join(root, "pts-versions/pts-intraday/0.1.0/policy.json"), "utf8");
  assert.equal(descriptor.policy.sha256, bytesHash(policy));
  assert.deepEqual(JSON.parse(policy), PTS_INTRADAY_POLICY);
  assert.equal(
    descriptor.reference.sha256,
    bytesHash(await readFile(join(root, "pts/bundle.json"), "utf8")),
  );
  const intraday = JSON.parse(
    await readFile(new URL("../src/pts-study/pts-intraday-template.json", import.meta.url), "utf8"),
  );
  const basic = JSON.parse(
    await readFile(new URL("../src/pts-study/pts-basic-template.json", import.meta.url), "utf8"),
  );
  assertPtsConfig(intraday);
  assertPtsConfig(basic);
  assert.equal(basic.hours, 336);
  assert.equal(intraday.hours, 24);
  assert.throws(() => assertPtsConfig({ ...intraday, candidate: basic.candidate }), {
    code: "INVALID_INPUT",
  });
});

test("offline native intraday replay emits deterministic safe evidence, no network, credentials or invented profit", async (t) => {
  let network = 0;
  t.mock.method(globalThis, "fetch", async () => {
    network++;
    throw Error("offline network forbidden");
  });
  const root = await mkdtemp(join(tmpdir(), "pts-intraday-offline-"));
  const history = {
    format: "perps-pts-history-v1" as const,
    candidate: "pts-intraday@0.1.0" as const,
    capturedAt: intradayTime + 600000,
    from: intradayTime,
    to: intradayTime + 600000,
    commit: "controlled-native",
    markets: [intradayFixture()],
  };
  const state = join(root, "history.json");
  await writeFile(state, JSON.stringify({ history, historyHash: digest(history) }));
  for (const name of ["a", "b"]) {
    await runPtsCommand({
      command: "replay",
      state,
      output: join(root, name),
      signal: new AbortController().signal,
    });
  }
  for (const file of ["report.json", "report.html", "report.csv", "manifest.json"]) {
    assert.equal(
      await readFile(join(root, "a", file), "utf8"),
      await readFile(join(root, "b", file), "utf8"),
    );
  }
  const html = await readFile(join(root, "a/report.html"), "utf8");
  assert.ok(html.includes("PTS intraday 0.1.0"));
  assert.ok(!html.includes("PTS basic 0.2.0"));
  assert.ok(html.includes("twenty-four-hour public comparison has not started"));
  const report = JSON.parse(await readFile(join(root, "a/report.json"), "utf8"));
  assert.equal(report.financial.status, "NOT_VERIFIABLE");
  assert.equal(report.rows.length, 2);
  assert.equal(report.publicTrialStarted, false);
  const manifest = JSON.parse(await readFile(join(root, "a/manifest.json"), "utf8"));
  assert.equal(manifest.policyHash, digest(PTS_INTRADAY_POLICY));
  await assert.rejects(
    runPtsCommand({
      command: "replay",
      state,
      envFile: "must-not-read",
      output: join(root, "rejected"),
      signal: new AbortController().signal,
    }),
    { code: "INVALID_INPUT" },
  );
  await ptsReport(
    join(root, "b"),
    { protocol: "perps-pts-intraday-sma-v1", processState: "closing" },
    [{ symbol: "<img onerror=bad>", reason: "=evil" }],
  );
  assert.ok(!(await readFile(join(root, "b/report.html"), "utf8")).includes("<img onerror=bad>"));
  assert.equal(network, 0);
});
