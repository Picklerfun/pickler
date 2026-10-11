import { createReadStream } from "node:fs";
import { chmod, mkdir, readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  inventorySchema,
  type BaselineArtifact,
  type BaselineInventory,
  type BaselineManifest,
} from "./contracts.js";
import { checkSourceFiles, exportBaselineFiles } from "./files.js";
import { exportBaselineGit } from "./git.js";
import { verifyPts } from "./pts.js";
import { baselineReport } from "./report.js";
import { BaselineError, disjoint, fileFingerprint, git, newDirectory, writeJson } from "./safe.js";

/** Only DATABASE_URL is parsed. No dotenv, process.env population or provider composition. */
export async function baselineDatabaseUrl(path: string): Promise<string> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const match = /^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*?)\s*$/.exec(line);
      if (match) {
        let value = match[1]!;
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return value;
      }
    }
    throw new BaselineError("BASELINE_DATABASE_CONFIG_MISSING");
  } finally {
    lines.close();
    stream.destroy();
  }
}
export async function artifact(output: string, path: string): Promise<BaselineArtifact> {
  const actual = await fileFingerprint(join(output, path));
  return { path, sha256: actual.sha256, bytes: actual.bytes };
}

export async function exportBaseline(input: {
  inventoryPath: string;
  output: string;
  signal: AbortSignal;
}): Promise<BaselineManifest> {
  const inventory = inventorySchema.parse(JSON.parse(await readFile(input.inventoryPath, "utf8")));
  if (
    new Set(inventory.roots.map((r) => r.id)).size !== inventory.roots.length ||
    new Set(inventory.references.map((r) => r.name)).size !== inventory.references.length ||
    new Set(inventory.databases.map((d) => d.id)).size !== inventory.databases.length
  ) {
    throw new BaselineError("BASELINE_INVENTORY_INVALID");
  }
  for (const source of [inventory.repository, ...inventory.roots.map((r) => r.path)]) {
    disjoint(source, input.output);
  }
  for (const database of inventory.databases) {
    const origin = database.origin;
    if (
      origin?.kind === "stopped-volume-copy" &&
      !inventory.roots.some((root) => root.id === origin.evidenceRoot)
    ) {
      throw new BaselineError("BASELINE_DATABASE_ORIGIN_INVALID");
    }
  }
  const pts = await verifyPts(inventory.repository, inventory.ptsPath, inventory.candidatePath);
  const output = await newDirectory(input.output);
  await exportBaselineGit(
    inventory.repository,
    inventory.references,
    join(output, "code.bundle"),
    input.signal,
  );
  await chmod(join(output, "code.bundle"), 0o600);
  const capturedAt = new Date().toISOString();
  const files = await exportBaselineFiles(inventory, output, input.signal);
  const databases: BaselineManifest["databases"] = [];
  if (inventory.databases.length) {
    // Node-only PostgreSQL adapter is intentionally not imported by offline verification.
    const { exportBaselineDatabase, localBaselineUrl, BaselineFailure } =
      await import("@pickler/infrastructure/trading-baseline");
    const seen = new Set<string>();
    await mkdir(join(output, "databases"), { mode: 0o700 });
    for (const database of inventory.databases) {
      input.signal.throwIfAborted();
      const record: BaselineManifest["databases"][number] = {
        id: database.id,
        configurationFiles: database.configurationFiles,
        origin: database.origin ?? { kind: "direct-local" },
        status: "unavailable",
        code: null,
        snapshot: null,
        dump: null,
        inventory: null,
      };
      databases.push(record);
      try {
        const connectionString = await baselineDatabaseUrl(database.envFile);
        const url = localBaselineUrl(connectionString);
        const identity = `${url.hostname}:${url.port || "5432"}${url.pathname}`;
        if (seen.has(identity)) {
          throw new BaselineError("BASELINE_DUPLICATE_DATABASE");
        }
        seen.add(identity);
        const dumpPath = `databases/${database.id}.dump`;
        const snapshot = await exportBaselineDatabase({
          connectionString,
          tools: database.tools,
          dumpPath: join(output, dumpPath),
          signal: input.signal,
        });
        if (
          record.origin.kind === "stopped-volume-copy" &&
          snapshot.identity.systemIdentifier !== record.origin.originalSystemIdentifier
        ) {
          throw new BaselineError("BASELINE_DATABASE_ORIGIN_MISMATCH");
        }
        const inventoryPath = `databases/${database.id}.json`;
        await writeJson(join(output, inventoryPath), snapshot);
        record.status = "captured";
        record.snapshot = snapshot;
        record.dump = await artifact(output, dumpPath);
        record.inventory = await artifact(output, inventoryPath);
      } catch (error) {
        record.code =
          error instanceof BaselineError || error instanceof BaselineFailure
            ? error.code
            : "BASELINE_DATABASE_UNAVAILABLE";
      }
    }
  }
  const unavailable = [
    ...inventory.unavailable,
    ...(await checkSourceFiles(inventory, files, input.signal)),
  ];
  const complete =
    unavailable.length === 0 &&
    files.every((f) => ["copied", "excluded"].includes(f.status)) &&
    databases.every((d) => d.status === "captured");
  const manifest: BaselineManifest = {
    protocol: "trading-baseline-v1",
    version: 1,
    captureId: `baseline-${randomUUID()}`,
    capturedAt,
    completedAt: new Date().toISOString(),
    exportCommit: await git(inventory.repository, ["rev-parse", "HEAD"], input.signal),
    status: complete ? "complete" : "partial",
    consistency: "Per database snapshot; files individually verified. No global common instant.",
    recoveryOnly: true,
    pts: {
      bundleId: "pts-course",
      knowledgeVersion: "1.0.0",
      bundleSha256: pts.bundleSha256,
      candidateSha256: pts.candidateSha256,
      validation: pts,
    },
    git: { bundle: await artifact(output, "code.bundle"), references: inventory.references },
    roots: inventory.roots,
    files,
    databases,
    unavailable,
    verification: { status: "pending", restoration: "pending" },
  };
  await writeJson(join(output, "manifest.json"), manifest);
  await writeJson(join(output, "seal.json"), {
    protocol: "trading-baseline-seal-v1",
    manifest: await artifact(output, "manifest.json"),
  });
  await baselineReport(output, manifest);
  return manifest;
}
export type { BaselineInventory };
