import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import { runPtsCommand } from "../src/pts-study/index.js";
import { ptsReport, csvCell } from "../src/pts-study/report.js";
import { digest, bytesHash, refuseSecrets } from "../src/pts-study/files.js";
import { ptsFixture, ptsTime } from "@pickler/trading/testing/pts";
import { PTS_POLICY } from "@pickler/trading/pts";
test("offline replay rejects env, secrets, changed hashes and existing output; deterministic safe artifacts without fetch", async (t) => {
  let network = 0;
  t.mock.method(globalThis, "fetch", async () => {
    network++;
    throw Error("offline network forbidden");
  });
  const root = await mkdtemp(join(tmpdir(), "pts-offline-")),
    state = join(root, "history.json");
  const history = {
    format: "perps-pts-history-v1" as const,
    capturedAt: ptsTime,
    from: ptsTime - 3600000,
    to: ptsTime,
    commit: "controlled",
    markets: [ptsFixture()],
  };
  const packet = { format: "pts-preparation-v1", history, historyHash: digest(history) };
  await writeFile(state, JSON.stringify(packet));
  const a = join(root, "a"),
    b = join(root, "b"),
    signal = new AbortController().signal;
  await runPtsCommand({ command: "replay", state, output: a, signal });
  await runPtsCommand({ command: "replay", state, output: b, signal });
  for (const file of ["report.json", "report.html", "report.csv", "manifest.json"]) {
    assert.equal(await readFile(join(a, file), "utf8"), await readFile(join(b, file), "utf8"));
  }
  const result = JSON.parse(await readFile(join(a, "report.json"), "utf8"));
  assert.equal(result.financial.status, "NOT_VERIFIABLE");
  assert.equal(result.publicTrialStarted, false);
  const manifest = JSON.parse(await readFile(join(a, "manifest.json"), "utf8"));
  assert.equal(
    manifest.files["report.json"],
    bytesHash(await readFile(join(a, "report.json"), "utf8")),
  );
  await assert.rejects(
    runPtsCommand({
      command: "replay",
      state,
      envFile: "must-not-be-read",
      output: join(root, "env"),
      signal,
    }),
    { code: "INVALID_INPUT" },
  );
  await assert.rejects(runPtsCommand({ command: "replay", state, output: a, signal }), {
    code: "EEXIST",
  });
  await writeFile(state, JSON.stringify({ ...packet, historyHash: "b".repeat(64) }));
  await assert.rejects(
    runPtsCommand({ command: "replay", state, output: join(root, "bad"), signal }),
    { code: "AUDIT_HASH_MISMATCH" },
  );
  assert.throws(() => refuseSecrets({ apiKey: "private" }), { code: "AUDIT_SENSITIVE_INPUT" });
  assert.throws(() => refuseSecrets("postgresql://user:password@localhost/db"), {
    code: "AUDIT_SENSITIVE_INPUT",
  });
  assert.equal(network, 0);
  assert.equal(csvCell("=HYPERLINK(1)"), '"\'=HYPERLINK(1)"');
  await ptsReport(root, { processState: "closing" }, [
    { symbol: "<script>alert(1)</script>", action: "hold", reason: "=bad" },
  ]);
  const html = await readFile(join(root, "report.html"), "utf8");
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("Decisions stopped"));
});
test("new descriptor validates independently and hashes exact unchanged knowledge, policy and all eleven decisions", async () => {
  const root = new URL("../../../knowledge/trading/", import.meta.url).pathname;
  const descriptor = JSON.parse(
    await readFile(join(root, "pts-versions/pts-trend-reversal/0.2.0.json"), "utf8"),
  );
  const schema = JSON.parse(
    await readFile(join(root, "pts-versions/schemas/candidate-v2.schema.json"), "utf8"),
  );
  const ajv = new Ajv({ strict: true }),
    validate = ajv.compile(schema);
  assert.equal(validate(descriptor), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...descriptor, studioSelectable: true }), false);
  assert.equal(validate({ ...descriptor, candidateVersion: "9.9.9" }), false);
  const policy = await readFile(
    join(root, "pts-versions/pts-trend-reversal/0.2.0/policy.json"),
    "utf8",
  );
  assert.equal(descriptor.policy.sha256, bytesHash(policy));
  assert.deepEqual(JSON.parse(policy), PTS_POLICY);
  assert.equal(
    descriptor.reference.sha256,
    bytesHash(await readFile(join(root, "pts/bundle.json"), "utf8")),
  );
  const old = JSON.parse(
    await readFile(join(root, "pts-versions/pts-trend-reversal/0.1.0.json"), "utf8"),
  );
  assert.equal(old.executionEnabled, false);
  const decisions = await readFile(
    join(root, "pts-versions/pts-trend-reversal/0.2.0/DECISIONS.md"),
    "utf8",
  );
  for (const id of [
    "timeframes",
    "trend-direction",
    "risk-account",
    "leverage-exposure",
    "retracement",
    "basic-setup",
    "entry-trigger",
    "structural-stop",
    "breakeven",
    "targets",
    "rupture-confirmation",
  ]) {
    assert.ok(decisions.includes(id));
  }
});

test("public PTS composition remains importable when every model SDK and signing module is forbidden", () => {
  const code = `
 import {registerHooks} from "node:module";
 registerHooks({resolve(specifier,context,next){
 if(/@ai-sdk|@mastra|@turnkey|model-providers|polymarket\\/trading/.test(specifier)){
 throw Error("Forbidden paid or signing module: "+specifier);
 }
 return next(specifier,context);
 }});
 await import("@pickler/agent-runtime/plugins/perps-paper/public-study");
 await import("@pickler/infrastructure/perps-lab");
 `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", code], {
    cwd: new URL("../../../", import.meta.url),
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 0, result.stderr);
});
