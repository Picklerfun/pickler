import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { StudyState } from "@pickler/core";

export const studyConfigSchema = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^[a-z0-9-]{1,60}$/),
    hours: z.number().positive().max(72),
    settlementGraceHours: z.number().nonnegative().max(168),
    maxCases: z.number().int().positive().max(1000),
    maxApiUsd: z.number().positive().max(100),
    pricing: z
      .object({
        inputPerMillion: z.number().positive(),
        outputPerMillion: z.number().positive(),
        exaPerSearch: z.number().positive(),
      })
      .strict()
      .nullable(),
    agents: z
      .array(
        z
          .object({
            kind: z.enum(["btc-5m", "btc-15m", "sports"]),
            enabled: z.boolean(),
            plugins: z
              .array(z.enum(["polymarket", "coinbase", "exa"]))
              .refine((x) => new Set(x).size === x.length),
          })
          .strict(),
      )
      .min(1)
      .max(3)
      .refine((x) => new Set(x.map((a) => a.kind)).size === x.length),
  })
  .strict();
export async function readConfig(path: string) {
  return studyConfigSchema.parse(JSON.parse(await readFile(path, "utf8")));
}
export async function atomicWrite(path: string, value: string) {
  const temporary = `${path}.${process.pid}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(value);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
}
export async function lockStudy(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "writer.lock");
  let file;
  try {
    file = await open(path, "wx", 0o600);
  } catch {
    throw new Error(
      "STUDY_LOCKED: another writer or interrupted lock exists; verify the recorded PID before removing writer.lock",
    );
  }
  await file.writeFile(JSON.stringify({ pid: process.pid, host: hostname() }));
  await file.close();
  return async () => {
    await unlink(path);
  };
}
export function renderStudy(state: StudyState) {
  const headers = [
    "Case",
    "Group",
    "Market",
    "Started",
    "Market end UTC",
    "Status",
    "Outcome",
    "Probability",
    "Quantity",
    "Average entry",
    "Fees virtual",
    "Cost virtual",
    "Payout virtual",
    "PnL virtual",
    "Resolution",
    "Input tokens",
    "Output tokens",
    "API reservation USD",
    "Exa reported USD",
    "Reason",
  ];
  const rows = state.cases.map((row) => {
    const forecast = row.decision?.modelAssessment;
    const paper = row.paper;
    return [
      row.id,
      row.kind,
      row.snapshot.market.question,
      new Date(row.startedAt).toISOString(),
      new Date(row.snapshot.windowEnd).toISOString(),
      row.status,
      row.snapshot.market.outcomes.find((o) => o.id === forecast?.outcomeId)?.label ?? "",
      JSON.stringify(forecast?.probability ?? null),
      paper?.fill?.quantity ?? "",
      paper?.fill?.averagePrice ?? "",
      paper?.fill?.fees ?? "",
      paper?.fill?.totalCost ?? "",
      paper?.settlement?.payout ?? "",
      paper?.settlement?.realizedPnl ?? "",
      paper ? (paper.settlement ? "settled" : "pending") : "—",
      row.usage.inputTokens ?? "unknown",
      row.usage.outputTokens ?? "unknown",
      row.reservedApiUsd,
      row.usage.exaReportedUsd ?? "unknown",
      row.reason ?? row.resolutionError ?? "",
    ];
  });
  const escape = (value: unknown) =>
    String(value).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
    );
  const csv = [headers, ...rows]
    .map((row) =>
      row
        .map((value) => {
          const text = String(value);
          return `"${(/^[=+\-@\t\r]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\n");
  const settled = state.cases.filter((row) => row.paper?.settlement);
  const pnl = settled.reduce((sum, row) => sum + Number(row.paper!.settlement!.realizedPnl), 0);
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="refresh" content="30"><meta name="viewport" content="width=device-width"><title>Pickler paper study</title><style>body{font:15px system-ui;background:#101412;color:#edf3ee;padding:24px}table{border-collapse:collapse;white-space:nowrap}td,th{padding:12px;border-bottom:1px solid #354039;text-align:left}th{color:#c8ee72}section{overflow:auto}p{max-width:1000px}a{color:#c8ee72}</style><h1>Pickler · ${escape(state.config.id)}</h1><p>Local paper laboratory. No real orders. Updated ${escape(new Date(state.updatedAt).toISOString())}.</p><p>${rows.length} attempts · ${settled.length} settled positions · ${pnl.toFixed(6)} realized virtual PnL. Open positions are not losses or realized profits. API reservations use configured rates; they are not verified bills. This laboratory is not the deployed agent protocol.</p><p><a href="results.csv">Download CSV</a> · <a href="state.json">Evidence and snapshots</a></p><section><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${escape(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></section><h2>Discovery and session events</h2><ul>${state.events
    .slice(-100)
    .map(
      (e) =>
        `<li>${escape(new Date(e.time).toISOString())} · ${escape(e.kind)} · ${escape(e.code)}</li>`,
    )
    .join("")}</ul></html>`;
  return { html, csv };
}
export async function saveStudy(directory: string, state: StudyState) {
  state.updatedAt = Date.now();
  await atomicWrite(join(directory, "state.json"), JSON.stringify(state, null, 2));
  const report = renderStudy(state);
  await atomicWrite(join(directory, "results.csv"), report.csv);
  await atomicWrite(join(directory, "index.html"), report.html);
}
