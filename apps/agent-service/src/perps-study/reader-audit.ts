import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { auditUniverseCapture, canonicalAudit } from "@pickler/trading/evaluation";
import { PilotError } from "@pickler/core";
import { PerplStreamState } from "@pickler/infrastructure";

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
  const capture = JSON.parse(source.toString("utf8"));
  const audit = auditUniverseCapture(capture);
  let replay: unknown = null;
  if (audit.version === 3 || audit.version === 4) {
    const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
    if (
      digest(canonicalAudit(capture.config)) !== capture.configurationHash ||
      digest(canonicalAudit(capture.config.markets)) !== capture.catalogHash
    ) {
      throw new PilotError("INVALID_INPUT", "Stream configuration/catalog hash mismatch");
    }
    for (const cycle of capture.cycles) {
      for (const frame of cycle.frames ?? []) {
        if (digest(JSON.stringify({ snapshot: frame.snapshot, book: frame.book })) !== frame.hash) {
          throw new PilotError("INVALID_INPUT", "Stream snapshot hash mismatch");
        }
      }
    }
    const eventPath = join(dirname(state), "events.jsonl");
    let events: Buffer;
    try {
      if ((await stat(eventPath)).size > 32 * 1024 * 1024) {
        throw new PilotError("INVALID_INPUT", "Public capture size limit exceeded");
      }
      events = await readFile(eventPath);
    } catch (error) {
      if (error instanceof PilotError) {
        throw error;
      }
      replay = { status: "NOT_VERIFIABLE", reason: "Public capture file absent" };
      events = Buffer.alloc(0);
    }
    if (events.length) {
      if (
        events.length !== audit.streamEvidence!.bytes ||
        digest(events) !== audit.streamEvidence!.hash ||
        events.at(-1) !== 10
      ) {
        throw new PilotError("INVALID_INPUT", "Retained public capture bytes/hash mismatch");
      }
      let state: PerplStreamState | undefined;
      let messages = 0;
      let generations = 0;
      for (const line of events.toString("utf8").split("\n")) {
        if (!line) {
          continue;
        }
        signal.throwIfAborted();
        const event = JSON.parse(line);
        if (event.kind === "catalog") {
          const markets = event.publicMessage.markets;
          state = new PerplStreamState(
            markets,
            "wss://app.perpl.xyz/ws/v1/market-data",
            markets[0].provenance.chainId,
          );
        }
        if (
          event.kind === "connected" ||
          event.kind === "disconnected" ||
          event.kind === "closed"
        ) {
          state?.reset();
          if (event.kind === "connected") {
            generations++;
          }
        }
        if (event.kind === "message") {
          if (!state) {
            throw new PilotError("INVALID_INPUT", "Replay catalog absent");
          }
          state.apply(event.publicMessage, event.receivedAt);
          messages++;
        }
      }
      replay = {
        status: "RETAINED_PREFIX_REPLAYED",
        messages,
        generations,
        truncated: audit.streamEvidence!.truncated,
        limitation:
          "Only retained validated public messages; rejected raw bytes and truncated tail cannot be reconstructed.",
      };
    }
  }
  const result = {
    ...audit,
    sourceBytesHash: createHash("sha256").update(source).digest("hex"),
    analyzerCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    analysisMode: "OFFLINE_RECORDED_FACTS_ONLY",
    modelsCalled: 0,
    providersCalled: 0,
    ...(audit.version === 3 || audit.version === 4 ? { replay } : {}),
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
  const streamFacts = audit.streamEvidence
    ? `<h2>Continuous stream evidence</h2><p>Attempted cycles: ${escape(audit.counts.attemptedCycles)}; not admitted after interruption: ${escape(audit.counts.notAdmittedCycles)}; missed admission windows: ${escape(audit.counts.windowMissedCycles)}.</p><p>${escape(audit.streamEvidence.connections)} connections, ${escape(audit.streamEvidence.disconnects)} disconnects, ${escape(audit.streamEvidence.messages)} validated messages; reconstruction errors: ${escape(audit.streamEvidence.reconstructionErrors)}. Socket closed: ${escape(audit.streamEvidence.socketClosed)}; PostgreSQL lease released: ${escape(audit.streamEvidence.leaseReleased)}.</p><p>Retained bytes: ${escape(audit.streamEvidence.bytes)}; truncated: ${escape(audit.streamEvidence.truncated)}. Only the retained prefix can be replayed. Successful acquisition duration: median ${escape(audit.streamEvidence.acquisitionMs.median)} ms, p95 ${escape(audit.streamEvidence.acquisitionMs.p95)} ms; denominator ${escape(audit.streamEvidence.acquisitionMs.observations)}.</p><details><summary>Offline reconstruction result</summary><pre>${escape(JSON.stringify(replay, null, 2))}</pre></details>`
    : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Perpl reader evidence audit</title><style>body{font:15px system-ui,sans-serif;margin:32px;background:#10151c;color:#e8eef7}a{color:#97c7ff}h1{font-size:27px}p,li{max-width:1000px;line-height:1.6}table{border-collapse:collapse;white-space:nowrap;font-size:12px}td,th{padding:9px;border-bottom:1px solid #344150;text-align:left}th{background:#202b39}section{overflow:auto}code{word-break:break-all}details{margin:20px 0}</style></head><body><h1>Perpl reader evidence audit</h1><p><strong>${audit.counts.validCycles}/${audit.counts.cycles} joint cycles valid; ${audit.counts.validMarkets}/${audit.counts.marketObservations} market captures valid.</strong> This is an offline analysis of recorded observations. No provider request, model call or trading operation was performed.</p><p>Acquisition: ${escape(audit.acquisitionPolicy)}. Original commit: <code>${escape(audit.sourceCommit)}</code>. Analyzer commit: <code>${escape(result.analyzerCommit)}</code>.</p><p>Original file SHA-256: <code>${escape(result.sourceBytesHash)}</code>.</p><p>HTTP 200: ${audit.counts.http200}; HTTP 400: ${audit.counts.http400}; HTTP 429: ${audit.counts.http429}; no HTTP status: ${audit.counts.noHttpStatus}; ownership failures: ${audit.counts.ownershipFailures}.</p>${recoveryFacts}${streamFacts}<p>Recovery delay measures the interval between the first invalid recorded check and the next check of that asset. It is not a network round-trip time and the next check can reuse a cached ticker. All relative times use the actual cycle start.</p><details open><summary>What the evidence can establish</summary><ul>${audit.limitations.map((text) => `<li>${escape(text)}</li>`).join("")}</ul></details><p><a href="report.json">JSON evidence</a> · <a href="markets.csv">Market checks CSV</a> · <a href="requests.csv">Request timeline CSV</a></p><section><table><thead><tr>${headers.map((key) => `<th>${escape(key)}</th>`).join("")}</tr></thead><tbody>${audit.rows.map((row) => `<tr>${headers.map((key) => `<td>${escape(row[key as keyof typeof row])}</td>`).join("")}</tr>`).join("")}</tbody></table></section></body></html>`;
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
