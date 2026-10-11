import { PTS_POLICY } from "@pickler/trading/pts";
import { publish, digest, bytesHash } from "./files.js";
export const escapeHtml = (v: unknown) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export function csvCell(v: unknown) {
  const s = typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
  return '"' + (/^[\s]*[=+@-]/.test(s) ? "'" : "") + s.replaceAll('"', '""') + '"';
}
function setupGraph(setup: import("@pickler/trading/pts").PtsSetup) {
  const points = [setup.a, setup.b, setup.c],
    times = points.map((p) => p.openTime),
    prices = points.map((p) => Number(p.price));
  if (!prices.every(Number.isFinite)) {
    return "";
  }
  const minimum = Math.min(...prices, Number(setup.initialStop)),
    maximum = Math.max(...prices);
  const x = (t: number) => 60 + (460 * (t - times[0]!)) / Math.max(1, times[2]! - times[0]!);
  const y = (p: number) => 220 - (170 * (p - minimum)) / Math.max(1e-9, maximum - minimum);
  const levels = setup.recovery.ratios.map((r) => ({
    ratio: r,
    price: Number(setup.c.price) + (Number(setup.b.price) - Number(setup.c.price)) * Number(r),
  }));
  return (
    "<figure><figcaption>" +
    escapeHtml(setup.symbol + " " + setup.direction + " — " + setup.id) +
    '</figcaption><svg viewBox="0 0 760 265" role="img" aria-label="Frozen correction A B C and recovery levels">' +
    '<polyline fill="none" stroke="#8ee2bc" stroke-width="2" points="' +
    points.map((p, i) => x(p.openTime) + "," + y(prices[i]!)).join(" ") +
    '"/>' +
    points
      .map(
        (p, i) =>
          '<circle fill="#8ee2bc" r="4" cx="' +
          x(p.openTime) +
          '" cy="' +
          y(prices[i]!) +
          '"/><text fill="#fff" x="' +
          (x(p.openTime) + 6) +
          '" y="' +
          (y(prices[i]!) - 7) +
          '">' +
          ["A", "B", "C"][i] +
          " " +
          escapeHtml(p.price) +
          "</text>",
      )
      .join("") +
    levels
      .map(
        (l) =>
          '<line x1="340" x2="650" y1="' +
          y(l.price) +
          '" y2="' +
          y(l.price) +
          '" stroke="#819aab"/><text fill="#fff" x="655" y="' +
          (y(l.price) + 4) +
          '">' +
          escapeHtml(l.ratio) +
          "</text>",
      )
      .join("") +
    '<text fill="#fff" x="50" y="250">Illustration from frozen anchors; no inferred fills or P&amp;L.</text></svg><p>Confirmed C: ' +
    escapeHtml(new Date(setup.c.confirmedAt).toISOString()) +
    ". Trigger: " +
    escapeHtml(new Date(setup.triggerAt).toISOString()) +
    ". Stop: " +
    escapeHtml(setup.initialStop) +
    ". Exact values and channel formulas remain in JSON.</p></figure>"
  );
}
export async function ptsReport(
  dir: string,
  report: Record<string, unknown>,
  rows: Record<string, unknown>[],
) {
  const keys = [
    "at",
    "slot",
    "symbol",
    "variant",
    "action",
    "reason",
    "status",
    "eligible",
    "coverage",
    "reproduction",
    "finalDecision",
    "verification",
    "analysisHash",
    "projectionHash",
    "setupId",
    "initialStop",
    "triggerAt",
    "expiresAt",
    "original",
    "analysis",
    "anchors",
    "filters",
    "executions",
  ];
  const allAnalyses = report.analyses
    ? Object.values(report.analyses as Record<string, import("@pickler/trading/pts").PtsAnalysis>)
    : (rows
        .map((r) => r.analysis ?? (r.reproduction as { trace?: unknown } | undefined)?.trace)
        .filter(Boolean) as import("@pickler/trading/pts").PtsAnalysis[]);
  const setups = [
    ...new Map(allAnalyses.filter((a) => a.setup).map((a) => [a.setup!.id, a.setup!])).values(),
  ];
  const graphs = setups.slice(0, 24).map(setupGraph).join("");
  const stage =
    report.processState === "closing"
      ? "Decisions stopped; only deterministic virtual exits remain."
      : report.processState === "active"
        ? "Authorized local paper comparison active."
        : report.processState === "finished"
          ? "Local comparison finished."
          : report.processState === "interrupted"
            ? "Comparison interrupted; review pending positions and funding."
            : report.processState === "process-unverified"
              ? "The recorded study started; current process health is not verified. No restart is authorized."
              : "Preparation or offline replay. The fourteen-day public comparison has not started.";
  const csvRows = rows.map((row) => {
    const analysis =
      row.analysis ??
      (report.analyses as Record<string, unknown> | undefined)?.[String(row.analysisHash)] ??
      (row.reproduction as { trace?: unknown } | undefined)?.trace;
    const trace = analysis as import("@pickler/trading/pts").PtsAnalysis | undefined;
    const setup =
      trace?.setup ??
      (row.original as { pts?: { setup?: import("@pickler/trading/pts").PtsSetup } } | undefined)
        ?.pts?.setup;
    return {
      ...row,
      anchors: setup ? { a: setup.a, b: setup.b, c: setup.c, channel: setup.channel } : null,
      filters: trace?.checks ?? null,
    };
  });
  const csv =
    [
      keys.join(","),
      ...csvRows.map((row) =>
        keys.map((k) => csvCell((row as Record<string, unknown>)[k])).join(","),
      ),
    ].join("\n") + "\n";
  const visibleSummary = Object.fromEntries(
    Object.entries(report).filter(
      ([key]) => !["analyses", "accounts", "events", "study", "rows", "financial"].includes(key),
    ),
  );
  visibleSummary.detailCounts = {
    rows: rows.length,
    analyses: allAnalyses.length,
    setups: setups.length,
  };
  if (report.financial) {
    const financial = report.financial as {
      protocol?: string;
      status?: string;
      reason?: string;
      interpretation?: string;
      modelCalls?: number;
      metrics?: unknown[];
    };
    visibleSummary.financial = {
      protocol: financial.protocol,
      status: financial.status,
      reason: financial.reason,
      interpretation: financial.interpretation,
      modelCalls: financial.modelCalls,
      metrics: Array.isArray(report.financial) ? report.financial : financial.metrics,
    };
  }
  const compact = rows.map((r, i) => ({
    i,
    at: r.at,
    slot: r.slot,
    symbol: r.symbol,
    variant: r.variant,
    action: r.action,
    reason: r.reason,
    status: r.status,
    analysisHash: r.analysisHash,
  }));
  const json = JSON.stringify(compact)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>PTS basic 0.2.0 — preparation and replay</title><style>
  body{background:#101820;color:#e5ecf3;font:15px system-ui;max-width:1500px;margin:32px auto;padding:20px}h1{font-size:30px}h2{font-size:22px;color:#8ee2bc}a{color:#8fd2ff}section{padding:18px;border:1px solid #344654;border-radius:8px;margin:20px 0}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #344654}button,select,input{background:#233442;color:#fff;border:1px solid #617687;padding:8px;margin:4px}pre{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#bccad5}svg{max-width:600px;background:#182a35}
  </style><h1>PTS basic 0.2.0</h1><p>${escapeHtml(stage)} No models or real orders.</p>
  <section><h2>Evidence and limits</h2><pre>${escapeHtml(JSON.stringify(visibleSummary, null, 2))}</pre></section>
  <section><h2>Frozen policy</h2><pre>${escapeHtml(JSON.stringify(PTS_POLICY, null, 2))}</pre><p>Numeric choices are experimental. More signals do not establish profitability. Missing books/funding do not establish hypothetical P&amp;L.</p></section>
  <section><h2>Frozen anchors and drawings</h2>${graphs || "<p>No eligible setup in these inputs. No drawing was invented.</p>"}<p>Up to 24 distinct setups illustrated; all exact anchors and formulas remain in JSON.</p></section>
  <section><h2>Decision evidence</h2><input id="filter" placeholder="Market, action or reason" aria-label="Filter decisions"><button id="prev">Previous</button><button id="next">Next</button><span id="count"></span>
  <table><thead><tr><th>UTC / slot</th><th>Market</th><th>Variant</th><th>Action</th><th>Reason / status</th><th>Reference</th></tr></thead><tbody id="rows"></tbody></table></section>
  <p>When financial evidence exists, separate fills.csv, movements.csv and positions.csv retain virtual partials, fees and funding; all values are also in JSON.</p>
  <p><a href="report.json">Full JSON, anchors and traces</a> · <a href="report.csv">CSV</a> · <a href="manifest.json">Hashes and provenance</a></p>
  <script type="application/json" id="data">${json}</script><script>
  const data=JSON.parse(document.getElementById("data").textContent);let page=0;const size=50;
  function render(){const q=document.getElementById("filter").value.toLowerCase(),list=data.filter(r=>JSON.stringify(r).toLowerCase().includes(q));page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(list.length/size)-1)));document.getElementById("rows").replaceChildren();
  for(const r of list.slice(page*size,(page+1)*size)){const tr=document.createElement("tr");for(const v of [r.at?new Date(r.at).toISOString():r.slot,r.symbol,r.variant||"signal-only",r.action||"",r.reason||r.status,r.analysisHash||r.i]){const td=document.createElement("td");td.textContent=String(v??"");tr.append(td);}document.getElementById("rows").append(tr);}
  document.getElementById("count").textContent=list.length+" rows, page "+(page+1);}
  document.getElementById("filter").oninput=()=>{page=0;render();};document.getElementById("prev").onclick=()=>{page--;render();};document.getElementById("next").onclick=()=>{page++;render();};render();
  </script></html>`;
  const full = { ...report, rows };
  const accounts = (report.accounts ??
    (report.financial as { accounts?: unknown } | undefined)?.accounts) as
    Record<string, import("@pickler/trading/perps").PerpsPaperView> | undefined;
  const financialFiles: Record<string, string> = {};
  if (accounts) {
    for (const kind of ["fills", "movements", "positions"] as const) {
      const detail = Object.entries(accounts).flatMap(([variant, view]) => {
        const values =
          kind === "fills"
            ? view.attempts.filter((a) => a.status === "filled")
            : kind === "movements"
              ? view.movements
              : view.account.positions;
        return values.map((evidence) => ({ variant, evidence }));
      });
      financialFiles[kind + ".csv"] =
        [
          "variant,evidence",
          ...detail.map((v) => csvCell(v.variant) + "," + csvCell(v.evidence)),
        ].join("\n") + "\n";
    }
  }
  await publish(dir, {
    ...financialFiles,
    "report.json": JSON.stringify(full, null, 2) + "\n",
    "report.html": html,
    "report.csv": csv,
    "manifest.json":
      JSON.stringify(
        {
          format: "pts-report-manifest-v1",
          reportHash: digest(full),
          policyHash: digest(PTS_POLICY),
          files: {
            ...Object.fromEntries(
              Object.entries(financialFiles).map(([name, body]) => [name, bytesHash(body)]),
            ),
            "report.html": bytesHash(html),
            "report.csv": bytesHash(csv),
            "report.json": bytesHash(JSON.stringify(full, null, 2) + "\n"),
          },
        },
        null,
        2,
      ) + "\n",
  });
}
