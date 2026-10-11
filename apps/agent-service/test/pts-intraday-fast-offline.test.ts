import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Ajv from "ajv/dist/2020.js";
import { PTS_INTRADAY_FAST_POLICY, assertPtsConfig } from "@pickler/trading/pts";
import { fastFixture, fastTime } from "@pickler/trading/testing/pts-intraday-fast";
import { runPtsCommand } from "../src/pts-study/index.js";
import { digest, bytesHash } from "../src/pts-study/files.js";

test("new immutable fast descriptor, policy and template remain experimental and pin the original course", async () => {
  const root = new URL("../../../knowledge/trading/", import.meta.url).pathname;
  const descriptor = JSON.parse(
    await readFile(join(root, "pts-versions/pts-intraday/0.2.0-fast.1.json"), "utf8"),
  );
  const schema = JSON.parse(
    await readFile(join(root, "pts-versions/schemas/candidate-v4.schema.json"), "utf8"),
  );
  const validate = new Ajv({ strict: true }).compile(schema);
  assert.equal(validate(descriptor), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...descriptor, candidateVersion: "0.1.0" }), false);
  assert.equal(validate({ ...descriptor, studioSelectable: true }), false);
  assert.equal(validate({ ...descriptor, publicTrialStarted: true }), false);
  const policy = await readFile(
    join(root, "pts-versions/pts-intraday/0.2.0-fast.1/policy.json"),
    "utf8",
  );
  assert.equal(descriptor.policy.sha256, bytesHash(policy));
  assert.deepEqual(JSON.parse(policy), PTS_INTRADAY_FAST_POLICY);
  assert.equal(
    descriptor.reference.sha256,
    bytesHash(await readFile(join(root, "pts/bundle.json"), "utf8")),
  );
  const config = JSON.parse(
    await readFile(
      new URL("../src/pts-study/pts-intraday-fast-template.json", import.meta.url),
      "utf8",
    ),
  );
  assertPtsConfig(config);
  assert.equal(config.candidate, "pts-intraday@0.2.0-fast.1");
  assert.equal(config.hours, 24);
});
test("unified offline fast replay is deterministic, identifies its own policy and never loads credentials or calls a provider", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("Offline provider calls forbidden");
  });
  const root = await mkdtemp(join(tmpdir(), "pts-fast-offline-"));
  const history = {
    format: "perps-pts-history-v1" as const,
    candidate: "pts-intraday@0.2.0-fast.1" as const,
    capturedAt: fastTime + 600000,
    from: fastTime,
    to: fastTime + 600000,
    commit: "controlled-fast",
    markets: [fastFixture()],
  };
  const source = join(root, "history.json");
  await writeFile(source, JSON.stringify({ history, historyHash: digest(history) }));
  for (const name of ["a", "b"]) {
    await runPtsCommand({
      command: "replay",
      state: source,
      output: join(root, name),
      signal: new AbortController().signal,
    });
  }
  for (const file of ["report.html", "report.json", "report.csv", "manifest.json"]) {
    assert.equal(
      await readFile(join(root, "a", file), "utf8"),
      await readFile(join(root, "b", file), "utf8"),
    );
  }
  const report = JSON.parse(await readFile(join(root, "a/report.json"), "utf8"));
  assert.equal(report.policy, history.candidate);
  assert.equal(report.financial.status, "NOT_VERIFIABLE");
  assert.equal(report.policyHash, digest(PTS_INTRADAY_FAST_POLICY));
  assert.equal(report.publicTrialStarted, false);
  const html = await readFile(join(root, "a/report.html"), "utf8");
  assert.ok(html.includes("PTS intraday 0.2.0-fast.1"));
  assert.ok(html.includes("twenty-four-hour public comparison has not started"));
  assert.equal(html.includes("PTS intraday 0.1.0"), false);
  await assert.rejects(
    runPtsCommand({
      command: "replay",
      state: source,
      envFile: "must-not-read",
      output: join(root, "reject"),
      signal: new AbortController().signal,
    }),
    { code: "INVALID_INPUT" },
  );
  assert.equal(calls, 0);
});
