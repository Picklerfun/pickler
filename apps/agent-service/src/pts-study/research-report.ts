import { createHash, randomUUID } from "node:crypto";
import { open, rename, unlink, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { PilotError } from "@pickler/core";
import type { PublishedArtifact } from "./files.js";
import { csvCell, escapeHtml } from "./report.js";
import { bufferedChunks, jsonChunks } from "./serialization.js";

export type ResearchArtifactFiles = Record<string, PublishedArtifact>;
export type ResearchTableRow = Record<string, unknown>;

class ResearchSink {
  private readonly hash = createHash("sha256");
  private bytes = 0;
  private pending = "";
  private closed = false;

  private constructor(
    private readonly file: FileHandle,
    private readonly temporary: string,
    private readonly target: string,
    private readonly signal: AbortSignal,
  ) {}

  static async create(dir: string, name: string, signal: AbortSignal) {
    if (!/^[a-z][a-z0-9.-]*$/.test(name)) {
      throw new PilotError("INVALID_INPUT", "Local research artifact name required");
    }
    signal.throwIfAborted();
    const temporary = join(dir, name + "." + randomUUID() + ".tmp");
    return new ResearchSink(await open(temporary, "wx", 0o600), temporary, join(dir, name), signal);
  }

  async write(chunk: string) {
    this.signal.throwIfAborted();
    this.pending += chunk;
    if (this.pending.length >= 64 * 1024) {
      await this.flush();
    }
  }

  private async flush() {
    if (this.pending.length) {
      const buffer = Buffer.from(this.pending, "utf8");
      this.pending = "";
      await this.file.writeFile(buffer);
      this.hash.update(buffer);
      this.bytes += buffer.length;
    }
  }

  async finish(): Promise<PublishedArtifact> {
    this.signal.throwIfAborted();
    await this.flush();
    await this.file.sync();
    await this.file.close();
    this.closed = true;
    this.signal.throwIfAborted();
    await rename(this.temporary, this.target);
    return { bytes: this.bytes, sha256: this.hash.digest("hex") };
  }

  async discard() {
    if (!this.closed) {
      await this.file.close().catch(() => {});
      this.closed = true;
    }
    await unlink(this.temporary).catch(() => {});
  }
}

export async function publishResearchArtifact(
  directory: string,
  name: string,
  body: Iterable<string> | AsyncIterable<string> | string,
  signal: AbortSignal,
) {
  const sink = await ResearchSink.create(directory, name, signal);
  try {
    for await (const chunk of typeof body === "string" ? [body] : body) {
      await sink.write(chunk);
    }
    return await sink.finish();
  } catch (error) {
    await sink.discard();
    throw error;
  }
}

export const RESEARCH_COLUMNS = [
  "id",
  "mode",
  "at",
  "slot",
  "symbol",
  "marketId",
  "candidate",
  "version",
  "status",
  "action",
  "reason",
  "firstBlocker",
  "validationStatus",
  "direction",
  "abId",
  "abcId",
  "episodeId",
  "activeSetups",
  "gates",
  "timing",
  "signal",
  "comparedToReference",
  "source",
  "historicalDecision",
  "financialStatus",
] as const;

export function* researchCsv(rows: Iterable<ResearchTableRow>, columns: readonly string[]) {
  yield columns.join(",") + "\n";
  for (const row of rows) {
    yield columns.map((column) => csvCell(row[column])).join(",") + "\n";
  }
}

/** The seven-day container is streamed in one pass and never retained as a giant report object. */
export async function researchHistoryWriter(directory: string, signal: AbortSignal) {
  const json = await ResearchSink.create(directory, "history-decisions.json", signal);
  let csv: ResearchSink | undefined;
  try {
    csv = await ResearchSink.create(directory, "history.csv", signal);
    await json.write("[");
    await csv.write(RESEARCH_COLUMNS.join(",") + "\n");
  } catch (error) {
    await json.discard();
    await csv?.discard();
    throw error;
  }
  const csvSink = csv;
  let count = 0;
  return {
    async append(row: ResearchTableRow) {
      if (count) {
        await json.write(",");
      }
      for (const chunk of bufferedChunks(jsonChunks(row, { canonicalKeys: true }))) {
        await json.write(chunk);
      }
      await csvSink.write(RESEARCH_COLUMNS.map((column) => csvCell(row[column])).join(",") + "\n");
      count++;
    },
    async finish(): Promise<ResearchArtifactFiles> {
      await json.write("]\n");
      return {
        "history-decisions.json": await json.finish(),
        "history.csv": await csvSink.finish(),
      };
    },
    async discard() {
      await json.discard();
      await csvSink.discard();
    },
  };
}

function scriptJson(value: unknown) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function researchHtml(report: ResearchTableRow, rows: ResearchTableRow[]) {
  const counts = (report.counts ?? {}) as Record<string, number>;
  const reproduction = (report.originalReproduction ?? {}) as Record<string, unknown>;
  const traceCounts = (reproduction.originalAccountPtsFullTrace ?? {}) as Record<string, number>;
  const byPolicy = (Array.isArray(report.byPolicy) ? report.byPolicy : []) as Record<
    string,
    unknown
  >[];
  const comparisonCounts = new Map<
    string,
    { gained: number; lost: number; shared: number; examples: string[] }
  >();
  for (const item of (report.comparisons ?? []) as Record<string, unknown>[]) {
    const key = [item.mode, item.candidate].join(":");
    const count = comparisonCounts.get(key) ?? { gained: 0, lost: 0, shared: 0, examples: [] };
    count.gained += Number(item.gained ?? 0);
    count.lost += Number(item.lost ?? 0);
    count.shared += Number(item.shared ?? 0);
    const mechanism = (item.mechanismEvidence ?? []) as { rowId: string }[];
    const lost = (item.lostReferenceSignals ?? []) as { rowId: string }[];
    for (const example of [...mechanism, ...lost]) {
      if (count.examples.length < 2) {
        count.examples.push(example.rowId);
      }
    }
    comparisonCounts.set(key, count);
  }
  const reasonRows = Object.entries(
    (reproduction.originalPtsFirstBlockers ?? {}) as Record<string, number>,
  )
    .map(
      ([reason, count]) => `<tr><td>${escapeHtml(reason)}</td><td>${escapeHtml(count)}</td></tr>`,
    )
    .join("");
  const candidateRows = byPolicy
    .map((policy) => {
      const comparison = comparisonCounts.get([policy.mode, policy.candidate].join(":"));
      const values = [
        policy.mode,
        policy.candidate,
        policy.signalRows,
        policy.uniqueSignals,
        policy.uniqueAB,
        comparison?.gained ?? "—",
        comparison?.lost ?? "—",
        comparison?.shared ?? "—",
        comparison?.examples.join(" · ") ?? "Reference policy",
      ];
      return (
        "<tr>" + values.map((value) => "<td>" + escapeHtml(value) + "</td>").join("") + "</tr>"
      );
    })
    .join("");
  const overview = `The original account audit reproduced ${Number(reproduction.reproduced ?? 0)} of ${Number(counts.originalProposalRows ?? 0)} recorded proposals. Full original PTS traces have ${Number(traceCounts.fullTraceMatches ?? 0)} matches, ${Number(traceCounts.fullTraceDivergences ?? 0)} differences and ${Number(traceCounts.fullTraceNotVerifiable ?? 0)} unverifiable rows. Candidate comparisons below count causal candle signals; they do not establish profitable trades.`;
  const source = report.source as Record<string, unknown> | undefined;
  const financial = report.financial as
    | { candidateCounterfactual?: unknown; actualRecordedLedger?: Record<string, unknown>[] }
    | undefined;
  const summary = {
    scope: report.scope,
    counts: report.counts,
    originalReproduction: report.originalReproduction,
    financial: {
      candidateCounterfactual: financial?.candidateCounterfactual,
      actualRecordedLedger: financial?.actualRecordedLedger?.map(({ positions, ...metric }) => ({
        ...metric,
        positionCount: Array.isArray(positions) ? positions.length : null,
      })),
    },
    interpretations: report.interpretations,
    source: source
      ? Object.fromEntries(Object.entries(source).filter(([key]) => key !== "partReferences"))
      : undefined,
    policyHashes: report.policyHashes,
    analyzer: report.analyzer
      ? {
          commit: (report.analyzer as Record<string, unknown>).commit,
          nodeVersion: (report.analyzer as Record<string, unknown>).nodeVersion,
          sourceHash: (report.analyzer as Record<string, unknown>).sourceHash,
          compiledInventoryHash: (
            (report.analyzer as Record<string, unknown>).compiledBusiness as
              Record<string, unknown> | undefined
          )?.inventoryHash,
        }
      : undefined,
  };
  const compact = rows.map((row) => ({
    id: row.id,
    at: row.at,
    slot: row.slot,
    symbol: row.symbol,
    candidate: row.candidate,
    status: row.status,
    reason: row.reason,
    abId: row.abId,
    abcId: row.abcId,
  }));
  const episodes = Array.isArray(report.episodes)
    ? report.episodes.slice(0, 300).map((episode: Record<string, unknown>) => ({
        mode: episode.mode,
        candidate: episode.candidate,
        symbol: episode.symbol,
        abId: episode.abId,
        uniqueABC: episode.uniqueABC,
        firstAt: episode.firstAt,
        lastAt: episode.lastAt,
        rows: episode.rows,
        firstRowId: episode.firstRowId,
        lastRowId: episode.lastRowId,
      }))
    : [];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; img-src data:; base-uri 'none'; form-action 'none'"><title>PTS causal research</title><style>
  :root{color-scheme:dark}body{background:#101820;color:#e5ecf3;font:15px/1.5 system-ui;max-width:1450px;margin:32px auto;padding:20px}h1{font-size:32px}h2{color:#8ee2bc}section{border:1px solid #344654;border-radius:8px;padding:18px;margin:20px 0}a{color:#8fd2ff}input,button{background:#233442;color:#fff;border:1px solid #617687;padding:9px;margin:4px}table{border-collapse:collapse;width:100%}th,td{padding:9px;text-align:left;border-bottom:1px solid #344654;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}.table{overflow:auto}small{color:#bccad5}details{padding:8px 0}
  </style></head><body><h1>PTS causal research</h1><p>Offline development evidence · reference plus four independent, single-change candidates · no public trial started.</p>
  <section><h2>What the evidence shows</h2><p>${escapeHtml(overview)}</p><table><tbody><tr><th>Recorded decision times</th><td>${escapeHtml(counts.recordedSlots ?? 0)}</td><th>Forensic candidate rows</th><td>${escapeHtml(counts.forensicRows ?? 0)}</td></tr><tr><th>Original proposal rows</th><td>${escapeHtml(counts.originalProposalRows ?? 0)}</td><th>Causal history rows</th><td>${escapeHtml(counts.historyRows ?? 0)}</td></tr><tr><th>Unrecorded scheduled times</th><td>${escapeHtml(counts.notRecordedSlots ?? 0)}</td><th>Declared markets</th><td>${escapeHtml(counts.markets ?? 0)}</td></tr></tbody></table><h3>Original PTS first blockers</h3><table><thead><tr><th>Recorded reason</th><th>Rows</th></tr></thead><tbody>${reasonRows || '<tr><td colspan="2">No recorded PTS reason available.</td></tr>'}</tbody></table><p><strong>Evidence bounds:</strong> The supplied history was already examined and remains development evidence. Repeated polls and several corrections sharing one A–B impulse do not create independent observations. Unrecorded slots remain missing evidence. Additional candle signals have no verifiable hypothetical fills or P&amp;L because original minute books and hypothetical funding paths are absent.</p></section>
  <section><h2>Candidate comparisons</h2><p>Gained, lost and shared counts compare unique candle-signal identities against the reference within each mode. Signal rows can repeat one event; A–B counts group related corrections. Example row references can be searched in the decision table or inspected in JSON/CSV.</p><div class="table"><table><thead><tr><th>Mode</th><th>Policy</th><th>Signal rows</th><th>Unique signal events</th><th>Unique A–B</th><th>Gained</th><th>Lost</th><th>Shared</th><th>Example row reference</th></tr></thead><tbody>${candidateRows}</tbody></table></div></section>
  <section><h2>Recorded decision times</h2><p>Only recorded rounds appear here. Unrecorded scheduled slots are listed separately in coverage.csv.</p><input id="filter" aria-label="Filter decisions" placeholder="Market, policy, blocker or episode"><button id="prev">Previous</button><button id="next">Next</button><span id="count" aria-live="polite"></span><div class="table"><table><thead><tr><th>UTC / slot</th><th>Market</th><th>Policy</th><th>Status</th><th>First blocker</th><th>AB / ABC identity</th><th>Row reference</th></tr></thead><tbody id="rows"></tbody></table></div></section>
  <section><h2>Episode evidence</h2><p>An A–B identity can contain several corrections C. Neither those corrections nor repeated polls establish independent observations. All summaries remain in episodes.csv and report.json.</p><details><summary>Inspect up to 300 episode summaries</summary><pre>${escapeHtml(JSON.stringify(episodes, null, 2))}</pre></details></section>
  <section><details><summary>Provenance, original ledger audit and exact integrity references</summary><pre>${escapeHtml(JSON.stringify(summary, null, 2))}</pre><p>Full source-file and compiled-code inventories remain inspectable in report.json; private raw histories remain in the original source parts.</p></details></section>
  <section><h2>Inspect all values</h2><p><a href="report.json">Forensic JSON and summaries</a> · <a href="report.csv">Forensic CSV</a> · <a href="historical-audit.csv">Original account replay</a> · <a href="history-decisions.json">Full causal history JSON</a> · <a href="history.csv">Full causal history CSV</a> · <a href="stages.csv">Dependency denominators</a> · <a href="episodes.csv">Episode CSV</a> · <a href="coverage.csv">Unrecorded slot coverage</a> · <a href="protocol-future.json">Conditions for a separate future plan</a> · <a href="manifest.json">Artifact integrity</a></p><p>Full native histories remain in the immutable original files and hashed parts. Financial projection for every new candidate is NOT_VERIFIABLE because original maintenance books and hypothetical funding paths are absent.</p></section>
  <script type="application/json" id="data">${scriptJson(compact)}</script><script>
  const data=JSON.parse(document.getElementById("data").textContent);let page=0;const size=50;
  function render(){const q=document.getElementById("filter").value.toLowerCase();const list=data.filter(row=>JSON.stringify(row).toLowerCase().includes(q));page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(list.length/size)-1)));const body=document.getElementById("rows");body.replaceChildren();for(const row of list.slice(page*size,(page+1)*size)){const tr=document.createElement("tr");for(const value of [new Date(row.at).toISOString()+" / "+row.slot,row.symbol,row.candidate,row.status,row.reason,(row.abId||"—")+" / "+(row.abcId||"—"),row.id]){const td=document.createElement("td");td.textContent=String(value??"");tr.append(td);}body.append(tr);}document.getElementById("count").textContent=list.length+" rows · page "+(page+1);}
  document.getElementById("filter").oninput=()=>{page=0;render();};document.getElementById("prev").onclick=()=>{page--;render();};document.getElementById("next").onclick=()=>{page++;render();};render();
  </script></body></html>`;
}

export async function publishPtsResearchReport(
  directory: string,
  report: ResearchTableRow & { forensicRows: ResearchTableRow[] },
  existingFiles: ResearchArtifactFiles,
  signal: AbortSignal,
) {
  const files = { ...existingFiles };
  const reportHash = createHash("sha256");
  function* reportDocument() {
    for (const chunk of bufferedChunks(jsonChunks(report, { canonicalKeys: true }))) {
      reportHash.update(chunk);
      yield chunk;
    }
    yield "\n";
  }
  files["report.json"] = await publishResearchArtifact(
    directory,
    "report.json",
    reportDocument(),
    signal,
  );
  files["report.html"] = await publishResearchArtifact(
    directory,
    "report.html",
    researchHtml(report, report.forensicRows),
    signal,
  );
  files["report.csv"] = await publishResearchArtifact(
    directory,
    "report.csv",
    researchCsv(report.forensicRows, RESEARCH_COLUMNS),
    signal,
  );
  const manifest = {
    format: "pts-report-manifest-v3",
    reportProtocol: "pts-causal-research-report-v1",
    reportHashPolicy: "sha256-canonical-published-json-v1",
    reportHash: reportHash.digest("hex"),
    sourceHash: report.sourceHash,
    policyHashes: report.policyHashes,
    files: Object.fromEntries(Object.entries(files).map(([name, item]) => [name, item.sha256])),
    fileBytes: Object.fromEntries(Object.entries(files).map(([name, item]) => [name, item.bytes])),
  };
  signal.throwIfAborted();
  await publishResearchArtifact(
    directory,
    "manifest.json",
    [...bufferedChunks(jsonChunks(manifest, { canonicalKeys: true })), "\n"],
    signal,
  );
  return manifest;
}
