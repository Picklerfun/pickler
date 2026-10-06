import { readFile, writeFile, mkdir, rename, appendFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parse } from "dotenv";
import { z } from "zod";
import { PilotError } from "@pickler/core";
import {
  PostgresResearchStore,
  PostgresPerpsPaperStore,
  PostgresPerpsStudyStore,
  exportPerpsAudit,
} from "@pickler/infrastructure";
import {
  createPerpsStudyRunner,
  createEvaluationCoordinator,
  smaStudyReport,
  PERPS_SMA_STRATEGIES,
  canonicalAudit,
  assertPerpsStudyConfig,
  type SmaStudyConfig,
} from "@pickler/trading/evaluation";
import type { EvaluationHostRequest } from "../evaluation-host/local.js";
import { createStudyData } from "./data.js";
import { keepAwake } from "../paper-study/comparison-host.js";
import { writeSupervisionJson } from "./sma-supervision.js";

const schema = z
  .object({
    version: z.literal(3),
    protocol: z.literal("perps-sma-ablation-v1"),
    tenantId: z.string(),
    sessionId: z.string(),
    network: z.enum(["mainnet", "testnet"]),
    hours: z.literal(6),
    acquisitionPolicy: z.literal("rest-paced-20s-v1"),
    strategyVersion: z.literal("sma-ablation-v1"),
    entryPolicyVersion: z.literal("sma-ablation-entries-v1"),
    exitPolicyVersion: z.literal("multiframe-common-exits-v1"),
  })
  .strict();
const digest = (v: unknown) => createHash("sha256").update(canonicalAudit(v)).digest("hex");
const head = () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const csv = (v: unknown) => {
  const text = typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
  return `"${(/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`;
};

export async function writeSmaReport(directory: string, report: ReturnType<typeof smaStudyReport>) {
  const keys = [
    "slot",
    "symbol",
    "variant",
    "scheduledAt",
    "status",
    "phase",
    "initial",
    "final",
    "execution",
    "evidenceAt",
  ] as const;
  const table = report.rows
    .map(
      (r) =>
        `<tr><td>${r.slot} / ${escape(r.symbol)}</td><td>${escape(r.variant)}</td><td>${escape(r.status)}</td><td>${escape(r.initial?.proposal.action)}<br>${escape(r.initial?.proposal.reason)}</td><td><details><summary>Filters and execution</summary><pre>${escape(JSON.stringify(r, null, 2))}</pre></details></td></tr>`,
    )
    .join("");
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SMA entry comparison</title><style>body{font:16px system-ui;margin:24px;background:#111827;color:#e5e7eb}table{border-collapse:collapse;width:100%}td,th{border:1px solid #64748b;padding:10px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin:8px 0}</style><h1>SMA entry comparison</h1><p>${escape(report.sessionId)} — ${escape(report.status)}. ${report.commonSlots.length}/24 common complete rounds.</p><p>Zero model calls or API spend. Virtual AUSD only; no profitability claim.</p><h2>Portfolios</h2><table><tr><th>Variant</th><th>Opens / closes</th><th>Net realized cash P&amp;L</th><th>Fees / reconciled funding</th><th>Equity / observed drawdown</th><th>Pending</th></tr>${report.metrics.map((m) => `<tr><td>${escape(m.variant)}</td><td>${m.opens} / ${m.closes}</td><td>${escape(m.netRealizedCashPnlAUSD ?? "UNKNOWN")} AUSD</td><td>${escape(m.feesAUSD)} / ${escape(m.reconciledFundingAUSD)} AUSD</td><td>${escape(m.equityAUSD ?? "UNKNOWN")} AUSD / ${escape(m.observedMarkedDrawdownPct ?? "UNKNOWN")}%</td><td>${m.pendingPositions.length} positions; funding ${m.fundingPending ? "PENDING" : "reconciled"}</td></tr>`).join("")}</table><ul>${report.limitations.map((l) => `<li>${escape(l)}</li>`).join("")}</ul><h2>Decisions</h2><table><tr><th>Slot / asset</th><th>Variant</th><th>Status</th><th>Initial proposal</th><th>Details</th></tr>${table}</table><details><summary>Observations, closures and provenance</summary><pre>${escape(JSON.stringify({ ...report, rows: undefined }, null, 2))}</pre></details></html>`;
  for (const [name, content] of [
    ["report.json", JSON.stringify(report, null, 2) + "\n"],
    [
      "report.csv",
      [keys.join(","), ...report.rows.map((r) => keys.map((k) => csv(r[k])).join(","))].join("\n") +
        "\n",
    ],
    ["report.html", html],
  ]) {
    const temp = join(directory, `${name}.${process.pid}.tmp`);
    await writeFile(temp, content!, { mode: 0o600 });
    await rename(temp, join(directory, name!));
  }
}

export async function runSmaStudy(input: EvaluationHostRequest) {
  if (input.allowPaid || input.acquisitionChoice || input.states) {
    throw new PilotError("INVALID_INPUT", "SMA comparison has no paid or transport overrides");
  }
  const configPath = resolve(input.configPath);
  const frozenText = await readFile(configPath, "utf8");
  const config: SmaStudyConfig = schema.parse(JSON.parse(frozenText));
  assertPerpsStudyConfig(config);
  const signal = input.signal ?? new AbortController().signal;
  const coordinator = createEvaluationCoordinator({
    "perps-sma-ablation-v1": { execute: async () => execute() },
  });
  return coordinator.execute({
    command: input.command,
    configuration: config,
    allowPaid: false,
    signal,
  });

  async function execute() {
    if (!input.envFile) {
      throw new PilotError("INVALID_INPUT", "Explicit database-only environment file required");
    }
    const environment = parse(await readFile(resolve(input.envFile), "utf8"));
    if (Object.keys(environment).some((k) => k !== "DATABASE_URL")) {
      throw new PilotError(
        "INVALID_INPUT",
        "Database-only environment required; model/signing fields are forbidden",
      );
    }
    const databaseUrl = environment.DATABASE_URL;
    if (
      !databaseUrl ||
      !["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl).hostname)
    ) {
      throw new PilotError("INVALID_INPUT", "Explicit loopback PostgreSQL required");
    }
    const research = new PostgresResearchStore(databaseUrl);
    const paper = new PostgresPerpsPaperStore(research.pool);
    const study = new PostgresPerpsStudyStore(research.pool);
    const output = resolve(input.output ?? dirname(configPath));
    const commit = head();
    const configHash = digest(config);
    const metadata = {
      commit,
      configurationHash: configHash,
      acquisitionPolicy: "rest-paced-20s-v1",
      entryPolicyVersion: config.entryPolicyVersion,
      exitPolicyVersion: config.exitPolicyVersion,
      virtualCapitalPerVariant: "1000",
      modelCallsAllowed: 0,
      dataDiagnosticVersion: "safe-phase-predicate-native-v2",
    };
    let releaseAwake = () => {};
    let data: ReturnType<typeof createStudyData> | undefined;
    let diagnostics = Promise.resolve();
    let failed = false;
    const diagnostic = (event: unknown) => {
      diagnostics = diagnostics.then(async () => {
        await appendFile(join(output, "diagnostics.jsonl"), JSON.stringify(event) + "\n", {
          mode: 0o600,
        });
        if (
          (event as { kind?: string }).kind === "renewed" &&
          process.env.PICKLER_SMA_SUPERVISION_TOKEN
        ) {
          await writeSupervisionJson(join(output, "runner-health.json"), {
            token: process.env.PICKLER_SMA_SUPERVISION_TOKEN,
            pid: process.pid,
            at: Date.now(),
            renewal: event,
          });
        }
      });
      void diagnostics.catch(() =>
        controller.abort(new PilotError("PERSISTENCE_FAILED", "Local diagnostics unavailable")),
      );
    };
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const checkMarker = async () => {
      const marker = JSON.parse(await readFile(join(output, "SMA_STUDY"), "utf8"));
      if (marker.sessionId !== config.sessionId || marker.configHash !== configHash) {
        throw new PilotError("CONFLICT", "Wrong study output directory");
      }
    };
    const render = async () => {
      await checkMarker();
      const snapshot = await exportPerpsAudit(research.pool, config);
      const projection = smaStudyReport(snapshot.study, snapshot.accounts, Date.now());
      let processState = "NOT_STARTED";
      if (projection.startedAt !== null) {
        try {
          const pid = Number(await readFile(join(output, "runner.pid"), "utf8"));
          if (!Number.isSafeInteger(pid) || pid <= 0) {
            throw new Error("Invalid PID");
          }
          process.kill(pid, 0);
          processState = "ALIVE";
        } catch (error) {
          processState =
            (error as NodeJS.ErrnoException).code === "ESRCH" ? "DEAD" : "NOT_VERIFIABLE";
        }
      }
      const localFailure = await readFile(join(output, "runner-error.jsonl"), "utf8").catch(
        () => "",
      );
      const supervisionFailure = await readFile(
        join(output, "supervision-failure.json"),
        "utf8",
      ).catch(() => "");
      const interrupted = Boolean(
        localFailure ||
        supervisionFailure ||
        (processState === "DEAD" && ["running", "closing"].includes(projection.status)),
      );
      const effective = interrupted
        ? smaStudyReport(
            { ...snapshot.study, record: { ...snapshot.study.record, status: "interrupted" } },
            snapshot.accounts,
            Date.now(),
          )
        : projection;
      const report = {
        ...effective,
        processState,
        persistedStatus: projection.status,
        localFailure: localFailure ? JSON.parse(localFailure.trim().split("\n").at(-1)!) : null,
        supervisionFailure: supervisionFailure ? JSON.parse(supervisionFailure) : null,
        sourcePayloadHash: digest(snapshot),
      };
      await writeSmaReport(output, report);
      return report;
    };
    try {
      if (input.command === "prepare") {
        await mkdir(output, { recursive: true });
        await writeFile(
          join(output, "SMA_STUDY"),
          JSON.stringify({ sessionId: config.sessionId, configHash }),
          { flag: "wx", mode: 0o600 },
        );
        await study.initialize(config, metadata);
        console.log(
          JSON.stringify({
            status: "initialized",
            session: config.sessionId,
            modelCalls: 0,
            output,
          }),
        );
        await render();
        return;
      }
      const view = await study.view(config);
      if (digest(view.record.config) !== configHash) {
        throw new PilotError("CONFIG_CHANGED", "Frozen configuration changed");
      }
      if (["report", "status", "settle"].includes(input.command)) {
        let created = false;
        try {
          await mkdir(output, { recursive: false });
          created = true;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
            throw e;
          }
        }
        const markerPath = join(output, "SMA_STUDY");
        try {
          const marker = JSON.parse(await readFile(markerPath, "utf8"));
          if (marker.sessionId !== config.sessionId || marker.configHash !== configHash) {
            throw new PilotError("CONFLICT", "Report directory belongs to another study");
          }
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT" || !created) {
            throw e;
          }
          await writeFile(markerPath, JSON.stringify({ sessionId: config.sessionId, configHash }), {
            flag: "wx",
            mode: 0o600,
          });
        }
        const report = await render();
        console.log(
          JSON.stringify({
            status: report.status,
            output,
            commonRounds: report.commonSlots.length,
            modelCalls: report.modelCalls,
          }),
        );
        return;
      }
      if (input.command === "stop") {
        await checkMarker();
        await study.stop(config);
        await render();
        return;
      }
      if (
        (view.record.metadata as { commit?: string }).commit !== commit ||
        digest(view.record.metadata) !== digest(metadata)
      ) {
        throw new PilotError("CONFIG_CHANGED", "Code or policy metadata changed since preparation");
      }
      if (view.record.startedAt !== null) {
        throw new PilotError("STUDY_ALREADY_STARTED", "No resume or automatic repeat");
      }
      for (const variant of PERPS_SMA_STRATEGIES) {
        const agent = await research.agent({
          tenantId: config.tenantId,
          agentId: view.record.agentIds[variant]!,
        });
        if (agent.paused || agent.version !== view.record.agentVersions[variant]) {
          throw new PilotError("CONFIG_CHANGED", "Variant permissions changed");
        }
      }
      if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) {
        throw new PilotError("CONFIG_CHANGED", "Commit all frozen code before admission");
      }
      if (input.command === "preflight") {
        console.log(
          JSON.stringify({
            status: "ready",
            commit,
            configHash,
            modelCalls: 0,
            publicConnectivity: "not-measured",
          }),
        );
        return;
      }
      const marker = JSON.parse(await readFile(join(output, "SMA_STUDY"), "utf8"));
      if (marker.sessionId !== config.sessionId || marker.configHash !== configHash) {
        throw new PilotError("CONFLICT", "Wrong study output directory");
      }
      releaseAwake = process.platform === "darwin" ? await keepAwake() : () => {};
      await writeFile(join(output, "runner.pid"), String(process.pid), { flag: "wx", mode: 0o600 });
      await writeFile(
        join(output, "STARTED"),
        JSON.stringify({ commit, configHash, at: Date.now() }),
        { flag: "wx", mode: 0o600 },
      );
      const originalGuard = study.guard.bind(study);
      study.guard = async (...args) => {
        combined.throwIfAborted();
        if ((await readFile(configPath, "utf8")) !== frozenText || head() !== commit) {
          throw new PilotError("CONFIG_CHANGED", "Frozen input or code changed during comparison");
        }
        return originalGuard(...args);
      };
      data = createStudyData(paper, research, {
        onDiagnostic: diagnostic,
        onAcquisition: diagnostic,
      });
      console.log(
        JSON.stringify({
          status: "starting",
          session: config.sessionId,
          commit,
          modelCalls: 0,
          virtualCapital: "1000 AUSD per variant",
        }),
      );
      await createPerpsStudyRunner({
        study,
        paper,
        data,
        paperForLease: (scope, lease, ownedSignal) =>
          new PostgresPerpsPaperStore(research.pool, undefined, {
            ...scope,
            owner: lease.owner,
            ...(lease.assertActive ? { assertActive: lease.assertActive } : {}),
            signal: ownedSignal,
          }),
        leaseDiagnostic: diagnostic,
        dataDiagnostic: diagnostic,
        onCycle: async () => {
          const report = await render();
          console.log(
            JSON.stringify({
              status: report.status,
              commonRounds: report.commonSlots.length,
              end: report.endsAt,
              modelCalls: 0,
            }),
          );
        },
      }).run(config, combined);
      await render();
    } catch (error) {
      failed = true;
      await appendFile(
        join(output, "runner-error.jsonl"),
        JSON.stringify({
          at: Date.now(),
          code: error instanceof PilotError ? error.code : "SMA_RUNNER_FAILED",
          modelsCalled: 0,
        }) + "\n",
        { mode: 0o600 },
      ).catch(() => {});
      // Read-only projections may document pending positions; never claim completion after death.
      if (input.command === "run") {
        await render().catch(() => {});
      }
      throw error;
    } finally {
      releaseAwake();
      await data?.close();
      await diagnostics.catch((e) => {
        if (!failed) {
          throw e;
        }
      });
      await research.close();
    }
  }
}
