import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { toolsSchema } from "./contracts.js";
import { baselineDatabaseUrl } from "./export.js";
import { restoreBaselineFiles } from "./files.js";
import { recoverBaselineGit } from "./git.js";
import { verifyPts } from "./pts.js";
import { baselineReport } from "./report.js";
import { BaselineError, disjoint, git, newDirectory, safePath, writeJson } from "./safe.js";
import { readBaseline, verifyBaseline } from "./verify.js";

export async function restoreBaseline(input: {
  state: string;
  output: string;
  targetPath?: string;
  verifierRepository: string;
  signal: AbortSignal;
}) {
  const { backup, manifest } = await readBaseline(input.state);
  disjoint(backup, input.output);
  for (const root of manifest.roots) {
    disjoint(root.path, input.output);
  }
  const output = await newDirectory(input.output);
  const verification = await verifyBaseline({
    ...input,
    output: join(output, "pre-restore-verification"),
  });
  if (verification.status !== "verified") {
    throw new BaselineError("BASELINE_VERIFICATION_FAILED");
  }
  const code = await recoverBaselineGit(
    await safePath(backup, manifest.git.bundle.path),
    manifest.git.references,
    join(output, "git-recovery"),
    input.signal,
  );
  const pts = await verifyPts(
    code,
    "knowledge/trading/pts",
    "knowledge/trading/pts-versions/pts-trend-reversal/0.1.0.json",
  );
  const filesRestored = await restoreBaselineFiles(backup, manifest.files, output);
  const results: {
    id: string;
    database: string | null;
    verified: boolean;
    code: string | null;
    inventorySha256: string | null;
  }[] = [];
  const captured = manifest.databases.filter((d) => d.status === "captured");
  if (captured.length) {
    if (!input.targetPath) {
      throw new BaselineError("BASELINE_ISOLATED_TARGET_REQUIRED");
    }
    const target = z
      .object({ envFile: z.string().startsWith("/"), tools: toolsSchema })
      .strict()
      .parse(JSON.parse(await readFile(input.targetPath, "utf8")));
    const adminConnectionString = await baselineDatabaseUrl(target.envFile);
    const { restoreBaselineDatabase, BaselineFailure } =
      await import("@pickler/infrastructure/trading-baseline");
    const sources = captured.map((d) => d.snapshot!.identity);
    for (const database of captured) {
      input.signal.throwIfAborted();
      try {
        const result = await restoreBaselineDatabase({
          adminConnectionString,
          sources,
          expected: database.snapshot!,
          tools: target.tools,
          dumpPath: await safePath(backup, database.dump!.path),
          signal: input.signal,
        });
        results.push({
          id: database.id,
          database: result.database,
          verified: result.verified,
          inventorySha256: result.actual.inventorySha256,
          code: result.verified ? null : "BASELINE_DATABASE_RESTORE_MISMATCH",
        });
        await writeJson(join(output, `${database.id}-restored-inventory.json`), result.actual);
      } catch (error) {
        results.push({
          id: database.id,
          database: null,
          verified: false,
          inventorySha256: null,
          code: error instanceof BaselineFailure ? error.code : "BASELINE_DATABASE_RESTORE_FAILED",
        });
      }
    }
  }
  const result = {
    protocol: "trading-baseline-restoration-v1",
    captureId: manifest.captureId,
    analyzerCommit: await git(input.verifierRepository, ["rev-parse", "HEAD"], input.signal),
    status:
      results.every((r) => r.verified) && manifest.status === "complete"
        ? "verified-complete"
        : "partial-or-failed",
    completeness: manifest.status,
    recoveryOnly: true,
    applicationsStarted: false,
    databasesReadOnly: true,
    filesRestored,
    pts,
    referencesVerified: manifest.git.references,
    databases: results,
    limitations: manifest.unavailable,
  };
  await writeJson(join(output, "RECOVERY-ONLY.json"), {
    recoveryOnly: true,
    sessionRestartForbidden: true,
    newBudgetForbidden: true,
  });
  await writeJson(join(output, "restoration.json"), result);
  await baselineReport(output, manifest, result);
  return result;
}
