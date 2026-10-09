import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { auditUniverseCapture } from "@pickler/trading/evaluation";
import { PilotError } from "@pickler/core";

const escape = (value: unknown) =>
  String(value ?? "NOT_VERIFIABLE")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const csvCell = (value: unknown) => {
  const text = value == null ? "NOT_VERIFIABLE" : String(value);
  return '"' + (/^[=+\-@\t\r]/.test(text) ? "'" : "") + text.replaceAll('"', '""') + '"';
};

export async function runReaderAudit(statePath: string, outputPath: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const state = resolve(statePath);
  if ((await stat(state)).size > 32 * 1024 * 1024) {
    throw new PilotError("INVALID_INPUT", "Capture exceeds the offline audit size limit");
  }
  const source = await readFile(state);
  if (source.byteLength > 32 * 1024 * 1024) {
    throw new PilotError("INVALID_INPUT", "Capture exceeds the offline audit size limit");
  }
  const audit = auditUniverseCapture(JSON.parse(source.toString("utf8")));
  const result = {
    ...audit,
    sourceBytesHash: createHash("sha256").update(source).digest("hex"),
    analyzerCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    analysisMode: "OFFLINE_RECORDED_FACTS_ONLY",
    modelsCalled: 0,
    providersCalled: 0,
  };
  const output = resolve(outputPath);
  signal.throwIfAborted();
  await mkdir(output, { recursive: false, mode: 0o700 });
  const headers = Object.keys(audit.rows[0] ?? { slot: 0, symbol: "", finalValid: null });
  const csv =
    [
      headers.map(csvCell).join(","),
      ...audit.rows.map((row) =>
        headers.map((key) => csvCell(row[key as keyof typeof row])).join(","),
      ),
    ].join("\n") + "\n";
  const requestHeaders = Object.keys(audit.requests[0] ?? { slot: 0, requestId: 0 });
  const requestCsv =
    [
      requestHeaders.map(csvCell).join(","),
      ...audit.requests.map((row) =>
        requestHeaders.map((key) => csvCell(row[key as keyof typeof row])).join(","),
      ),
    ].join("\n") + "\n";
  const recovery = audit.recoveryChecks;
  const recoveryFacts = `<p>Invalid-to-next-check intervals with both original source dates: ${recovery.observations} observations, median ${escape(recovery.medianMs)} ms and p95 ${escape(recovery.p95Ms)} ms. Initial ticker-only preparation is excluded. BTC: ${recovery.btcObservations} observations, range ${escape(recovery.btcMinimumMs)}–${escape(recovery.btcMaximumMs)} ms.</p>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Perpl reader evidence audit</title><style>body{font:15px system-ui,sans-serif;margin:32px;background:#10151c;color:#e8eef7}a{color:#97c7ff}h1{font-size:27px}p,li{max-width:1000px;line-height:1.6}table{border-collapse:collapse;white-space:nowrap;font-size:12px}td,th{padding:9px;border-bottom:1px solid #344150;text-align:left}th{background:#202b39}section{overflow:auto}code{word-break:break-all}details{margin:20px 0}</style></head><body><h1>Perpl reader evidence audit</h1><p><strong>${audit.counts.validCycles}/${audit.counts.cycles} joint cycles valid; ${audit.counts.validMarkets}/${audit.counts.marketObservations} market captures valid.</strong> This is an offline analysis of recorded observations. No provider request, model call or trading operation was performed.</p><p>Acquisition: ${escape(audit.acquisitionPolicy)}. Original commit: <code>${escape(audit.sourceCommit)}</code>. Analyzer commit: <code>${escape(result.analyzerCommit)}</code>.</p><p>Original file SHA-256: <code>${escape(result.sourceBytesHash)}</code>.</p><p>HTTP 200: ${audit.counts.http200}; HTTP 400: ${audit.counts.http400}; HTTP 429: ${audit.counts.http429}; no HTTP status: ${audit.counts.noHttpStatus}; ownership failures: ${audit.counts.ownershipFailures}.</p>${recoveryFacts}<p>Recovery delay measures the interval between the first invalid recorded check and the next check of that asset. It is not a network round-trip time and the next check can reuse a cached ticker. All relative times use the actual cycle start.</p><details open><summary>What the evidence can establish</summary><ul>${audit.limitations.map((text) => `<li>${escape(text)}</li>`).join("")}</ul></details><p><a href="report.json">JSON evidence</a> · <a href="markets.csv">Market checks CSV</a> · <a href="requests.csv">Request timeline CSV</a></p><section><table><thead><tr>${headers.map((key) => `<th>${escape(key)}</th>`).join("")}</tr></thead><tbody>${audit.rows.map((row) => `<tr>${headers.map((key) => `<td>${escape(row[key as keyof typeof row])}</td>`).join("")}</tr>`).join("")}</tbody></table></section></body></html>`;
  for (const [name, content] of Object.entries({
    "report.json": JSON.stringify(result, null, 2) + "\n",
    "markets.csv": csv,
    "requests.csv": requestCsv,
    "report.html": html,
  })) {
    signal.throwIfAborted();
    await writeFile(join(output, name), content, { flag: "wx", mode: 0o600 });
  }
  return result;
}
