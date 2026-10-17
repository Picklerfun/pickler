import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BaselineManifest, BaselineVerification } from "./contracts.js";
import { csv, html, writeJson } from "./safe.js";

export async function baselineReport(
  output: string,
  manifest: BaselineManifest,
  result?: BaselineVerification | Record<string, unknown>,
) {
  const files = manifest.files;
  const rows = [
    ["kind", "source", "status", "bytes", "sha256", "reason"],
    ...files.map((f) => ["file", f.source, f.status, f.bytes, f.sha256, f.reason]),
    ...manifest.databases.map((d) => [
      "database",
      d.id,
      d.status,
      d.dump?.bytes,
      d.dump?.sha256,
      d.code,
    ]),
    ...manifest.unavailable.map((u) => [u.kind, u.source, "unavailable", null, null, u.code]),
  ];
  await writeFile(
    join(output, "report.csv"),
    rows.map((r) => r.map(csv).join(",")).join("\n") + "\n",
    { flag: "wx", mode: 0o600 },
  );
  await writeJson(join(output, "report.json"), {
    captureId: manifest.captureId,
    completeness: manifest.status,
    result: result ?? manifest.verification,
    files: files.length,
    copied: files.filter((f) => f.status === "copied").length,
    excluded: files.filter((f) => f.status === "excluded").length,
    databases: manifest.databases.map((d) => ({
      id: d.id,
      status: d.status,
      origin: d.origin,
      tables: d.snapshot?.tables.length,
      rows: d.snapshot?.tables.reduce((sum, t) => sum + t.rows, 0),
      studies: d.snapshot?.studies,
    })),
    limitations: manifest.unavailable,
  });
  const fileTable = rows
    .slice(1)
    .map((r) => `<tr>${r.map((v) => `<td>${html(v ?? "")}</td>`).join("")}</tr>`)
    .join("");
  const page = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Trading baseline recovery</title><style>body{font:16px system-ui;margin:2rem;color:#18222c;background:#fafafa}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:8px;border:1px solid #ccd2d8;text-align:left;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:28px}</style><h1>Trading baseline ${html(manifest.captureId)}</h1><p>Completeness: <strong>${html(manifest.status)}</strong>. ${html(files.filter((f) => f.status === "copied").length)} copied files; ${html(files.filter((f) => f.status === "excluded").length)} explicit exclusions; ${html(manifest.databases.filter((d) => d.status === "captured").length)}/${html(manifest.databases.length)} database snapshots.</p><p>PTS: pts-course@1.0.0 / pts-trend-reversal@0.1.0, draft, unregistered and disabled. No strategy changes or provider calls.</p><p>${html(manifest.consistency)} Recovery copies are evidence only. This local backup does not protect against loss of this computer. Hashes detect corruption; this manifest is not a digital signature.</p><h2>Verification / recovery</h2><pre>${html(JSON.stringify(result ?? manifest.verification, null, 2))}</pre><h2>Git references</h2><pre>${html(JSON.stringify(manifest.git.references, null, 2))}</pre><h2>Database inventories</h2><pre>${html(
    JSON.stringify(
      manifest.databases.map((d) => ({
        id: d.id,
        status: d.status,
        origin: d.origin,
        code: d.code,
        identity: d.snapshot?.identity,
        capturedAt: d.snapshot?.capturedAt,
        tables: d.snapshot?.tables.length,
        inventorySha256: d.snapshot?.inventorySha256,
        studies: d.snapshot?.studies,
      })),
      null,
      2,
    ),
  )}</pre><h2>All files, exclusions and gaps</h2><table><thead><tr>${rows[0]!.map((v) => `<th>${html(v)}</th>`).join("")}</tr></thead><tbody>${fileTable}</tbody></table></html>`;
  await writeFile(join(output, "report.html"), page, { flag: "wx", mode: 0o600 });
}
