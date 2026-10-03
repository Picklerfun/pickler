import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PilotError } from "@pickler/core";
import {
  auditPerpsDecisions,
  canonicalAudit,
  type PerpsStudyView,
  type AuditDiagnostic,
  type PerpsStudyMap,
} from "@pickler/trading/evaluation";
import type { PerpsPaperView } from "@pickler/trading/perps";
import { perpsModelState } from "@pickler/agent-runtime/composition/perps-model-state";

const hash = (v: unknown) => createHash("sha256").update(canonicalAudit(v)).digest("hex");
const commit = () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
interface Packet {
  version: 1;
  protocol: "perps-decision-audit-export-v1";
  exportCommit: string;
  provenance: { study: string; diagnostics: string | null; diagnosticsHash: string | null };
  payload: {
    study: PerpsStudyView;
    accounts: PerpsStudyMap<PerpsPaperView>;
    diagnostics: AuditDiagnostic[];
  };
  payloadHash: string;
}
function cleanDiagnostics(text: string): AuditDiagnostic[] {
  if (Buffer.byteLength(text) > 32 * 1024 * 1024) {
    throw new PilotError("INVALID_INPUT", "Diagnostics exceed 32 MiB");
  }
  const keys = [
    "at",
    "operation",
    "symbol",
    "attempt",
    "tickerAt",
    "bookAt",
    "skewMs",
    "durationMs",
    "status",
    "code",
    "kind",
  ];
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const value = JSON.parse(line);
      return Object.fromEntries(
        keys
          .filter(
            (k) =>
              Object.hasOwn(value, k) &&
              (value[k] === null ||
                typeof value[k] === "number" ||
                (typeof value[k] === "string" && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value[k]))),
          )
          .map((k) => [k, value[k]]),
      );
    });
}
function refuseSecrets(value: unknown): void {
  if (
    typeof value === "string" &&
    /https?:\/\/[^/\s]*@|postgres(?:ql)?:\/\/|\bBearer\s+\S+|-----BEGIN .*PRIVATE KEY-----/i.test(
      value,
    )
  ) {
    throw new PilotError("AUDIT_SENSITIVE_INPUT", "Sensitive data detected; export refused");
  }
  if (Array.isArray(value)) {
    value.forEach(refuseSecrets);
  } else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (
        /(password|private.?key|api.?key|authorization|lease.?owner|^owner$|^headers$|^secret$)/i.test(
          key,
        )
      ) {
        throw new PilotError("AUDIT_SENSITIVE_INPUT", "Sensitive field detected; export refused");
      }
      refuseSecrets(v);
    }
  }
}
async function outputDirectory(path?: string) {
  if (!path) {
    throw new PilotError("INVALID_INPUT", "A new --output directory is required");
  }
  const output = resolve(path);
  // Exclusive creation prevents overwriting a study or previous audit.
  await mkdir(output, { recursive: false, mode: 0o700 });
  return output;
}
export async function runPerpsAudit(input: {
  command: "audit" | "audit-export";
  configPath?: string | undefined;
  state?: string | undefined;
  envFile?: string | undefined;
  diagnostics?: string | undefined;
  output?: string | undefined;
  allowPaid?: boolean | undefined;
  signal?: AbortSignal | undefined;
}) {
  input.signal?.throwIfAborted();
  if (input.allowPaid) {
    throw new PilotError("INVALID_INPUT", "Audit cannot authorize paid calls");
  }
  if (input.command === "audit-export") {
    if (!input.configPath || !input.envFile || input.state) {
      throw new PilotError("INVALID_INPUT", "audit-export requires --config and --env-file");
    }
    const config = JSON.parse(await readFile(resolve(input.configPath), "utf8"));
    if (
      !["perps-comparison-v1", "perps-four-way-v2"].includes(config.protocol) ||
      !config.tenantId ||
      !config.sessionId ||
      !["mainnet", "testnet"].includes(config.network)
    ) {
      throw new PilotError("INVALID_INPUT", "Perpetual study scope required");
    }
    // Parse only DATABASE_URL; never populate process.env or read model/trading keys.
    const { parse } = await import("dotenv");
    const url = parse(await readFile(resolve(input.envFile), "utf8")).DATABASE_URL;
    if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) {
      throw new PilotError("INVALID_INPUT", "Audit export requires explicit loopback PostgreSQL");
    }
    const { PostgresResearchStore, exportPerpsAudit } = await import("@pickler/infrastructure");
    const store = new PostgresResearchStore(url);
    let snapshot;
    try {
      snapshot = await exportPerpsAudit(store.pool, config);
    } finally {
      await store.pool.end();
    }
    const text = input.diagnostics ? await readFile(resolve(input.diagnostics), "utf8") : null;
    const payload = { ...snapshot, diagnostics: text ? cleanDiagnostics(text) : [] };
    refuseSecrets(payload);
    const packet: Packet = {
      version: 1,
      protocol: "perps-decision-audit-export-v1",
      exportCommit: commit(),
      provenance: {
        study: resolve(input.configPath),
        diagnostics: input.diagnostics ? resolve(input.diagnostics) : null,
        diagnosticsHash: text ? createHash("sha256").update(text).digest("hex") : null,
      },
      payload,
      payloadHash: hash(payload),
    };
    input.signal?.throwIfAborted();
    const output = await outputDirectory(input.output);
    await writeFile(join(output, "audit-export.json"), JSON.stringify(packet, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        export: join(output, "audit-export.json"),
        hash: packet.payloadHash,
        rounds: snapshot.study.rounds.length,
      }),
    );
    return;
  }
  if (!input.state || input.envFile || input.configPath || input.diagnostics) {
    throw new PilotError(
      "INVALID_INPUT",
      "Offline audit requires only --state export and --output",
    );
  }
  const packet = JSON.parse(await readFile(resolve(input.state), "utf8")) as Packet;
  if (
    packet.version !== 1 ||
    packet.protocol !== "perps-decision-audit-export-v1" ||
    packet.payloadHash !== hash(packet.payload) ||
    !Array.isArray(packet.payload.study.rounds) ||
    !Array.isArray(packet.payload.study.events)
  ) {
    throw new PilotError("INVALID_INPUT", "Invalid or modified audit packet");
  }
  refuseSecrets(packet.payload);
  const analysis = auditPerpsDecisions(
    packet.payload.study,
    packet.payload.diagnostics,
    hash,
    packet.payload.accounts,
  );
  const contexts = packet.payload.study.rounds.map((r) => ({
    slot: r.slot,
    states: Object.fromEntries(
      Object.entries(r.accounts ?? {}).map(([s, account]) => {
        if (!r.evidence) {
          return [s, { representation: "NOT_VERIFIABLE" }];
        }
        try {
          return [
            s,
            {
              representation: "CURRENT_TRANSFORM_OF_RECORDED_CONTEXT_NOT_ORIGINAL_BYTES",
              hash: hash(perpsModelState({ evidence: r.evidence, account })),
              state: perpsModelState({ evidence: r.evidence, account }),
            },
          ];
        } catch {
          return [s, { representation: "NOT_VERIFIABLE" }];
        }
      }),
    ),
  }));
  const report = {
    ...analysis,
    provenance: packet.provenance,
    exportHash: packet.payloadHash,
    exportCommit: packet.exportCommit,
    analyzerCommit: commit(),
    contexts,
  };
  const escape = (v: unknown) =>
    String(v ?? "unknown").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
    );
  const fields = [
    "slot",
    "symbol",
    "strategy",
    "executionStatus",
    "phase",
    "cause",
    "initialValidity",
    "finalValidity",
    "candles",
    "marketChanges",
    "originalProposal",
    "recordedProposal",
    "recalculatedProposal",
    "conversion",
    "answers",
    "execution",
    "unexplainedAction",
    "diagnostics",
  ] as const;
  const cell = (v: unknown) => {
    const text = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "");
    return `"${(/^[=+@\-\t\r]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`;
  };
  const csv =
    [
      fields.map(cell).join(","),
      ...report.rows.map((r) => fields.map((k) => cell(r[k])).join(",")),
    ].join("\n") + "\n";
  const divergences = report.rows.filter(
    (r) => r.conversion.includes("DIVERGENCE") || r.unexplainedAction,
  );
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Perpl decision audit</title><style>body{font:16px system-ui;margin:24px;background:#10151c;color:#e4ebf5}table{border-collapse:collapse;width:100%}td,th{padding:10px;border:1px solid #465465;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin:12px 0}a{color:#a9caff}</style><h1>Perpl decision audit</h1><p>${escape(report.sessionId)} — ${report.completeSlots.length} common complete slots; ${report.omissions.length} data omissions; ${divergences.length} divergences or unexplained actions.</p><p>No providers, model calls or historical writes. No profitability claim.</p><h2>Evidence summary</h2><pre>${escape(JSON.stringify(report.summary, null, 2))}</pre><ul>${report.limitations.map((l) => `<li>${escape(l)}</li>`).join("")}</ul><table><thead><tr><th>Slot / asset</th><th>Variant</th><th>Data</th><th>Recorded decision</th><th>Policy replay / execution</th></tr></thead><tbody>${report.rows.map((r) => `<tr><td>${r.slot} / ${escape(r.symbol)}</td><td>${escape(r.strategy)}</td><td>${escape(r.initialValidity)} / ${escape(r.finalValidity)}<br>Hourly candles: ${escape(r.candles.validity)}; ${escape(r.candles.repeatInterpretation)}<br>SMA20 ${escape(r.candles.sma20)} / SMA50 ${escape(r.candles.sma50)}</td><td>${escape(r.recordedProposal?.action)}<br>${escape(r.recordedProposal?.reason)}<details><summary>Original proposal and Jev answers</summary><pre>${escape(JSON.stringify({ original: r.originalProposal, answers: r.answers }, null, 2))}</pre></details></td><td>${escape(r.conversion)}<br>${escape(r.executionStatus)}<br>${escape(r.phase)}<details><summary>Evidence and execution</summary><pre>${escape(JSON.stringify(r, null, 2))}</pre></details></td></tr>`).join("")}</tbody></table><details><summary>Provenance and transformed contexts</summary><pre>${escape(JSON.stringify({ ...report, rows: undefined }, null, 2))}</pre></details></html>`;
  input.signal?.throwIfAborted();
  const output = await outputDirectory(input.output);
  for (const [name, value] of [
    ["audit.json", JSON.stringify(report, null, 2) + "\n"],
    ["audit.csv", csv],
    ["audit.html", html],
  ]) {
    await writeFile(join(output, name!), value!, { flag: "wx", mode: 0o600 });
  }
  console.log(
    JSON.stringify({
      output,
      completeSlots: report.completeSlots,
      omissions: report.omissions.length,
      divergences: divergences.length,
    }),
  );
}
