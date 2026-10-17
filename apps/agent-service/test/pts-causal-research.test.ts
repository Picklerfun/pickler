import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { profileProposals, type PerpsStudyView } from "@pickler/trading/evaluation";
import {
  PTS_INTRADAY_RESPONSIVE_POLICY,
  PTS_RESEARCH_CANDIDATES,
  ptsProposals,
  ptsTemporalProfile,
  type PerpsPtsConfig,
} from "@pickler/trading/pts";
import { initialPaperAccount, type PerpsPaperView } from "@pickler/trading/perps";
import {
  responsiveEvidence,
  responsiveFixture,
  responsiveTime,
} from "@pickler/trading/testing/pts-intraday-responsive";
import { bytesHash, digest } from "../src/pts-study/files.js";
import { createPtsPartsExport } from "../src/pts-study/parts.js";
import { runPtsResearch } from "../src/pts-study/research.js";
import { assertPtsResearchInput, type PtsResearchInput } from "../src/pts-study/research-input.js";
import {
  publishPtsResearchReport,
  publishResearchArtifact,
  researchCsv,
} from "../src/pts-study/research-report.js";

async function fixture(segmented: boolean, missingHistory = false) {
  const root = await mkdtemp(join(tmpdir(), "pts-causal-host-"));
  const lastClosed5m = Math.floor(responsiveTime / 300000) * 300000;
  const config = JSON.parse(
    await readFile(
      new URL("../src/pts-study/pts-intraday-responsive-template.json", import.meta.url),
      "utf8",
    ),
  ) as PerpsPtsConfig;
  const history = {
    format: "perps-pts-history-v1" as const,
    candidate: "pts-intraday@0.2.0-fast.2" as const,
    capturedAt: responsiveTime,
    from: lastClosed5m - 300000,
    to: lastClosed5m,
    commit: "controlled-causal-history",
    markets: config.markets.map((market) => responsiveFixture(market.symbol)),
  };
  if (missingHistory) {
    history.markets[0]!.series = [];
  }
  const savedHistory = {
    format: "pts-preparation-v1",
    history,
    historyHash: digest(history),
    policyHash: digest(PTS_INTRADAY_RESPONSIVE_POLICY),
  };
  const historyText = JSON.stringify(savedHistory) + "\n";
  config.history.sha256 = bytesHash(historyText);
  await writeFile(join(root, "history.json"), historyText);
  const accounts: Record<string, PerpsPaperView> = {};
  for (const variant of ["sma-reference", "pts-intraday"]) {
    const account = initialPaperAccount({ ...config, agentId: variant }, 1, responsiveTime);
    account.riskManagement = "buffered-selective-1x-v1";
    if (variant === "pts-intraday") {
      account.positionPolicy = ptsTemporalProfile("0.2.0-fast.2").accountPolicy;
      account.consumedPtsSetups = [];
    }
    accounts[variant] = { account, attempts: [], movements: [] };
  }
  const evidence = responsiveEvidence(responsiveTime, false, "0.40", digest);
  const proposals = {
    "sma-reference": profileProposals(
      { evidence, account: accounts["sma-reference"]!.account },
      config,
      "sma-reference",
    ),
    "pts-intraday": ptsProposals({ evidence, account: accounts["pts-intraday"]!.account }, config),
  };
  const study: PerpsStudyView = {
    record: {
      config,
      metadata: { commit: "controlled-causal-study" },
      agentIds: { "sma-reference": "sma", "pts-intraday": "pts" },
      agentVersions: { "sma-reference": 1, "pts-intraday": 1 },
      createdAt: responsiveTime,
      startedAt: responsiveTime,
      endsAt: responsiveTime + 86400000,
      graceUntil: responsiveTime + 87300000,
      status: "interrupted",
      decisionStopReason: "CONTROLLED_STOP",
      stopRequested: false,
      lastObservationAt: responsiveTime,
      lastRoundSlot: 0,
    },
    rounds: [
      {
        key: "round-000",
        slot: 0,
        status: "completed",
        executionStatus: "complete",
        createdAt: responsiveTime,
        finishedAt: responsiveTime,
        evidence,
        accounts: Object.fromEntries(
          Object.entries(accounts).map(([variant, view]) => [variant, view.account]),
        ),
        proposals,
        calls: {},
      },
    ],
    events: [
      {
        key: "round-000:execution-input",
        at: responsiveTime,
        kind: "execution-input",
        data: { evidence },
      },
      ...Object.entries(proposals).map(([variant, initial]) => ({
        key: "round-000:" + variant + ":final-gate",
        at: responsiveTime,
        kind: "final-gate",
        data: { initial, final: initial },
      })),
    ],
  };
  let auditFile: string;
  let payloadHash: string;
  if (segmented) {
    const exporter = await createPtsPartsExport(root, "controlled-causal-export");
    await exporter.emit({ kind: "record", value: study.record });
    for (const value of study.rounds) {
      await exporter.emit({ kind: "round", value });
    }
    for (const value of study.events) {
      await exporter.emit({ kind: "event", value });
    }
    for (const [variant, value] of Object.entries(accounts)) {
      await exporter.emit({ kind: "account", variant, value });
    }
    const packet = await exporter.finish();
    auditFile = "export.json";
    payloadHash = packet.payloadHash;
  } else {
    const payload = { study, accounts };
    payloadHash = digest(JSON.parse(JSON.stringify(payload)));
    auditFile = "audit-v1.json";
    await writeFile(
      join(root, auditFile),
      JSON.stringify({
        version: 1,
        protocol: "perps-decision-audit-export-v1",
        exportCommit: "controlled-causal-export",
        payloadHash,
        payload,
      }),
    );
  }
  const policyFile = async (name: string, value: unknown) => {
    const text = JSON.stringify(value) + "\n";
    await writeFile(join(root, name), text);
    return { file: name, sha256: bytesHash(text) };
  };
  const reference = await policyFile("reference.json", PTS_INTRADAY_RESPONSIVE_POLICY);
  const candidates: PtsResearchInput["candidates"] = [];
  for (const candidate of PTS_RESEARCH_CANDIDATES) {
    candidates.push({
      id: candidate.id,
      version: "0.1.0",
      ...(await policyFile(candidate.id + ".json", candidate)),
    });
  }
  const manifest: PtsResearchInput = {
    format: "pts-research-input-v1",
    version: 1,
    reference: { id: "pts-intraday", version: "0.2.0-fast.2", ...reference },
    candidates,
    sources: {
      audit: {
        file: auditFile,
        sha256: bytesHash(await readFile(join(root, auditFile), "utf8")),
        payloadHash,
      },
      history: {
        file: "history.json",
        sha256: config.history.sha256,
        historyHash: digest(history),
      },
    },
    dataUse: "examined-development",
    historyWindow: { from: history.from, to: history.to, stepSeconds: 300 },
  };
  const state = join(root, "research.json");
  await writeFile(state, JSON.stringify(manifest));
  return { root, state, manifest, study, accounts };
}

const signal = () => new AbortController().signal;

test("offline research reuses original accounts, separates unrecorded slots and publishes reproducible canonical JSON", async (t) => {
  let network = 0;
  t.mock.method(globalThis, "fetch", async () => {
    network++;
    throw Error("Offline network forbidden");
  });
  const source = await fixture(true);
  for (const directory of ["first", "second"]) {
    await runPtsResearch({
      command: "audit",
      state: source.state,
      output: join(source.root, directory),
      signal: signal(),
    });
  }
  const output = join(source.root, "first");
  const report = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));

  assert.deepEqual(report.counts, {
    completeSlots: 1,
    forensicRows: 55,
    historyRows: 55,
    historyWindowsPerMarket: 1,
    markets: 11,
    notRecordedSlots: 287,
    originalProposalRows: 22,
    recordedSlots: 1,
    scheduledSlots: 288,
  });
  assert.equal(report.originalReproduction.reproduced, 22);
  assert.equal(report.originalReproduction.divergence, 0);
  assert.equal(report.originalReproduction.originalAccountPtsFullTrace.fullTraceMatches, 11);
  assert.equal(report.originalReproduction.independentSignalPtsFullTrace.fullTraceMatches, 11);
  assert.equal(
    report.coverage.filter((row: { status: string }) => row.status === "NOT_RECORDED").length,
    287,
  );
  assert.ok(report.forensicRows.every((row: { slot: number }) => row.slot === 0));
  assert.ok(
    report.forensicRows.every(
      (row: { financialStatus: string }) => row.financialStatus === "NOT_VERIFIABLE",
    ),
  );
  assert.equal(report.scope.dataUse, "examined-development");
  assert.equal(report.financial.candidateCounterfactual.hypotheticalPnl, null);
  assert.equal(report.scope.publicTrialStarted, false);
  assert.equal(manifest.format, "pts-report-manifest-v3");
  assert.equal(manifest.reportHash, digest(report));
  for (const [name, hash] of Object.entries(manifest.files)) {
    const body = await readFile(join(output, name), "utf8");
    assert.equal(bytesHash(body), hash, name);
    assert.equal(Buffer.byteLength(body), manifest.fileBytes[name]);
    assert.equal(body, await readFile(join(source.root, "second", name), "utf8"), name);
  }
  assert.equal(
    await readFile(join(output, "manifest.json"), "utf8"),
    await readFile(join(source.root, "second/manifest.json"), "utf8"),
  );
  assert.ok((await readFile(join(output, "report.html"), "utf8")).length < 350000);
  const future = JSON.parse(await readFile(join(output, "protocol-future.json"), "utf8"));
  assert.equal(future.executionEnabled, false);
  assert.equal(future.maximumCandidates, 2);
  assert.deepEqual(future.selectedCandidates, []);
  assert.ok(future.conditions.join(" ").includes("multiplicity"));
  assert.equal(network, 0);
});

test("v1 compatibility and missing native data remain explicitly not verifiable", async () => {
  const source = await fixture(false, true);
  await runPtsResearch({
    command: "audit",
    state: source.state,
    output: join(source.root, "result"),
    signal: signal(),
  });
  const report = JSON.parse(await readFile(join(source.root, "result/report.json"), "utf8"));
  const history = JSON.parse(
    await readFile(join(source.root, "result/history-decisions.json"), "utf8"),
  );
  assert.equal(report.source.exportVersion, 1);
  assert.equal(report.historicalAudit[0].source.sha256, source.manifest.sources.audit.sha256);
  assert.equal(report.historicalAudit[0].source.semanticHash, digest(source.study.rounds[0]));
  assert.equal(
    report.historicalAudit[0].source.semanticHashPolicy,
    "sha256-canonical-audit-projection-v1",
  );
  assert.equal(report.originalReproduction.reproduced, 22);
  assert.equal(
    history.filter(
      (row: { symbol: string; status: string }) =>
        row.symbol === "BTC" && row.status === "NOT_VERIFIABLE",
    ).length,
    5,
  );
});

test("full trace divergence stays separate from existing action/financial proposal reproduction", async () => {
  const source = await fixture(false);
  const path = join(source.root, "audit-v1.json");
  const packet = JSON.parse(await readFile(path, "utf8"));
  packet.payload.study.rounds[0].proposals["pts-intraday"][0].trace.checks.push({
    code: "CONTROLLED_TRACE_ONLY_DIFFERENCE",
    passed: false,
    values: null,
  });
  packet.payloadHash = digest(packet.payload);
  const body = JSON.stringify(packet);
  await writeFile(path, body);
  source.manifest.sources.audit.sha256 = bytesHash(body);
  source.manifest.sources.audit.payloadHash = packet.payloadHash;
  await writeFile(source.state, JSON.stringify(source.manifest));

  await runPtsResearch({
    command: "audit",
    state: source.state,
    output: join(source.root, "trace"),
    signal: signal(),
  });

  const report = JSON.parse(await readFile(join(source.root, "trace/report.json"), "utf8"));
  assert.equal(report.originalReproduction.reproduced, 22);
  assert.equal(report.originalReproduction.originalAccountPtsFullTrace.fullTraceMatches, 10);
  assert.equal(report.originalReproduction.originalAccountPtsFullTrace.fullTraceDivergences, 1);
  assert.equal(report.originalReproduction.independentSignalPtsFullTrace.fullTraceDivergences, 1);
});

test("changed source parts, semantic source hashes, policies and unknown identities cannot publish a valid manifest", async () => {
  const source = await fixture(true);
  const exportPacket = JSON.parse(await readFile(join(source.root, "export.json"), "utf8"));
  const part = join(source.root, exportPacket.rounds[0].file);
  await writeFile(part, "{}");
  await assert.rejects(
    runPtsResearch({
      command: "audit",
      state: source.state,
      output: join(source.root, "corrupt"),
      signal: signal(),
    }),
    { code: "AUDIT_HASH_MISMATCH" },
  );
  await assert.rejects(access(join(source.root, "corrupt/manifest.json")));
  const version = { ...source.manifest, version: 2 };
  assert.throws(() => assertPtsResearchInput(version), { code: "INVALID_INPUT" });
  assert.throws(() => assertPtsResearchInput({ ...source.manifest, executionEnabled: true }), {
    code: "INVALID_INPUT",
  });
  assert.throws(
    () =>
      assertPtsResearchInput({
        ...source.manifest,
        candidates: source.manifest.candidates.map((item) => ({ ...item, version: "9.9.9" })),
      }),
    { code: "INVALID_INPUT" },
  );
  const clean = await fixture(false);
  clean.manifest.sources.history.historyHash = "b".repeat(64);
  await writeFile(clean.state, JSON.stringify(clean.manifest));
  await assert.rejects(
    runPtsResearch({
      command: "audit",
      state: clean.state,
      output: join(clean.root, "bad-hash"),
      signal: signal(),
    }),
    { code: "AUDIT_HASH_MISMATCH" },
  );
  await assert.rejects(access(join(clean.root, "bad-hash/manifest.json")));
});

test("unknown preparation envelopes and explicitly invalid optional policy hashes fail before source audit", async () => {
  const source = await fixture(false);
  const path = join(source.root, "history.json");
  const original = JSON.parse(await readFile(path, "utf8"));
  for (const [index, mutation] of [
    { policyHash: null },
    { policyHash: false },
    { policyHash: 0 },
    { policyHash: "" },
    { format: "pts-preparation-v99" },
    { version: 99 },
  ].entries()) {
    const body = JSON.stringify({ ...original, ...mutation });
    await writeFile(path, body);
    source.manifest.sources.history.sha256 = bytesHash(body);
    await writeFile(source.state, JSON.stringify(source.manifest));
    await assert.rejects(
      runPtsResearch({
        command: "audit",
        state: source.state,
        output: join(source.root, "invalid-envelope-" + index),
        signal: signal(),
      }),
      Object.hasOwn(mutation, "policyHash")
        ? { code: "AUDIT_HASH_MISMATCH", message: "Frozen responsive history identity differs" }
        : { code: "INVALID_INPUT", message: "Unknown frozen history packet format or version" },
    );
    await assert.rejects(access(join(source.root, "invalid-envelope-" + index, "manifest.json")));
  }
});

test("offline options, cancellation, duplicate output and symlinked files fail closed", async () => {
  const source = await fixture(false);
  for (const forbidden of [
    { envFile: "must-not-read" },
    { configPath: "must-not-read" },
    { allowPaid: true },
    { command: "run" },
  ]) {
    await assert.rejects(
      runPtsResearch({
        command: "audit",
        state: source.state,
        output: join(source.root, "forbidden"),
        signal: signal(),
        ...forbidden,
      }),
      { code: "INVALID_INPUT" },
    );
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runPtsResearch({
      command: "audit",
      state: source.state,
      output: join(source.root, "cancelled"),
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
  await assert.rejects(access(join(source.root, "cancelled/manifest.json")));
  const during = new AbortController();
  const check = during.signal.throwIfAborted.bind(during.signal);
  let checks = 0;
  during.signal.throwIfAborted = () => {
    if (++checks === 35) {
      during.abort();
    }
    check();
  };
  await assert.rejects(
    runPtsResearch({
      command: "audit",
      state: source.state,
      output: join(source.root, "cancelled-during"),
      signal: during.signal,
    }),
    { name: "AbortError" },
  );
  await assert.rejects(access(join(source.root, "cancelled-during/manifest.json")));
  await assert.rejects(
    runPtsResearch({
      command: "audit",
      state: source.state,
      output: source.root,
      signal: signal(),
    }),
    { code: "EEXIST" },
  );
  await symlink(join(source.root, "history.json"), join(source.root, "linked-history.json"));
  source.manifest.sources.history.file = "linked-history.json";
  await writeFile(source.state, JSON.stringify(source.manifest));
  await assert.rejects(
    runPtsResearch({
      command: "audit",
      state: source.state,
      output: join(source.root, "link"),
      signal: signal(),
    }),
    { code: "INVALID_INPUT" },
  );
  await symlink(source.root, join(source.root, "safe-parent"));
  source.manifest.sources.history.file = "safe-parent/history.json";
  await writeFile(source.state, JSON.stringify(source.manifest));
  await assert.rejects(
    runPtsResearch({
      command: "audit",
      state: source.state,
      output: join(source.root, "parent-link"),
      signal: signal(),
    }),
    { code: "INVALID_INPUT" },
  );
});

test("report security escapes source text, CSV formulas, and interrupted publication leaves no valid manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "pts-research-security-"));
  const hostile = "</script><img src=x onerror=alert(1)>\u2028";
  const report = {
    sourceHash: "a".repeat(64),
    policyHashes: {},
    forensicRows: [
      {
        id: hostile,
        at: responsiveTime,
        slot: 0,
        symbol: hostile,
        candidate: "=formula",
        status: "HOLD",
        reason: "+formula",
      },
    ],
    episodes: [],
  };
  await publishPtsResearchReport(root, report, {}, signal());
  const html = await readFile(join(root, "report.html"), "utf8");
  assert.equal(html.includes(hostile), false);
  assert.ok(html.includes("connect-src 'none'"));
  const csv = [...researchCsv([{ value: " \t=SUM(A1)" }, { value: "@formula" }], ["value"])].join(
    "",
  );
  assert.ok(csv.includes('"\' \t=SUM(A1)"'));
  assert.ok(csv.includes('"\'@formula"'));
  const controller = new AbortController();
  async function* cancelled() {
    yield "partial";
    controller.abort();
    yield "never";
  }
  await assert.rejects(
    publishResearchArtifact(root, "cancelled.json", cancelled(), controller.signal),
  );
  await assert.rejects(access(join(root, "cancelled.json")));
  assert.ok((await readdir(root)).every((name) => !name.endsWith(".tmp")));
});

test("unified CLI research dispatch cannot load env, database, transport, model or signing composition", async () => {
  const source = await fixture(false);
  const code = `
    import {registerHooks, syncBuiltinESMExports} from "node:module";
    import fs from "node:fs";
    import fsp from "node:fs/promises";
    for (const owner of [fs, fsp]) {
      for (const name of ["readFile", "readFileSync", "open", "openSync"]) {
        if (typeof owner[name] !== "function") continue;
        const original = owner[name];
        owner[name] = function(path, ...args) {
          if (/(^|[/\\\\])(?:\\.env|credentials|secrets?)(?:[./\\\\]|$)/i.test(String(path))) throw Error("Forbidden secret-file read");
          return Reflect.apply(original, this, [path, ...args]);
        };
      }
    }
    syncBuiltinESMExports();
    process.env = new Proxy(process.env, {get(target, key) {
      if (/DATABASE|MODEL_|JEV|EXA_|PRIVATE_KEY|API_KEY|SECRET/i.test(String(key))) throw Error("Forbidden credential environment read");
      return Reflect.get(target, key);
    }});
    registerHooks({resolve(specifier, context, next) {
      if (/dotenv|@ai-sdk|@mastra|@turnkey|postgres|^pg$|@pickler\\/infrastructure|@pickler\\/agent-runtime|pts-study\\/host|evaluation-host|^\\.\\/perps-study\\/audit\\.js$/.test(specifier)) {
        throw Error("Forbidden offline import: " + specifier);
      }
      return next(specifier, context);
    }});
    globalThis.fetch = () => { throw Error("Offline network forbidden"); };
    process.argv = [process.execPath, "audit", "--state", ${JSON.stringify(source.state)}, "--output", ${JSON.stringify(join(source.root, "cli"))}];
    await import("./apps/agent-service/src/evaluate.ts");
  `;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", code],
    {
      cwd: new URL("../../../", import.meta.url),
      encoding: "utf8",
      env: {},
      timeout: 60000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(await readFile(join(source.root, "cli/manifest.json"), "utf8"));
  assert.equal(manifest.reportProtocol, "pts-causal-research-report-v1");
  for (const flag of [
    "--config",
    "--env-file",
    "--diagnostics",
    "--inventory",
    "--restore-target",
    "--acquisition-choice",
  ]) {
    const rejected = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--",
        "apps/agent-service/src/evaluate.ts",
        "audit",
        "--state",
        source.state,
        "--output",
        join(source.root, "forbidden-cli"),
        flag,
        "must-not-read",
      ],
      { cwd: new URL("../../../", import.meta.url), encoding: "utf8", env: {}, timeout: 60000 },
    );
    assert.equal(rejected.status, 1, flag);
    assert.ok(rejected.stderr.includes("INVALID_INPUT"), rejected.stderr);
  }
  await assert.rejects(access(join(source.root, "forbidden-cli/manifest.json")));
  await symlink(source.state, join(source.root, "linked-state.json"));
  for (const args of [
    ["audit", "extra-command", "--state", source.state],
    ["audit", "--state", join(source.root, ".env.json")],
    ["audit", "--state", join(source.root, "linked-state.json")],
  ]) {
    const rejected = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--",
        "apps/agent-service/src/evaluate.ts",
        ...args,
        "--output",
        join(source.root, "forbidden-state"),
      ],
      { cwd: new URL("../../../", import.meta.url), encoding: "utf8", env: {}, timeout: 60000 },
    );
    assert.equal(rejected.status, 1);
    assert.ok(rejected.stderr.includes("INVALID_INPUT"), rejected.stderr);
  }
  await assert.rejects(access(join(source.root, "forbidden-state/manifest.json")));
});
