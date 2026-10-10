import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  manifestSchema,
  sealSchema,
  type BaselineManifest,
  type BaselineVerification,
} from "./contracts.js";
import { recoverBaselineGit } from "./git.js";
import { verifyPts } from "./pts.js";
import { baselineReport } from "./report.js";
import {
  BaselineError,
  credentialFile,
  disjoint,
  fileFingerprint,
  git,
  jsonHash,
  newDirectory,
  safePath,
  writeJson,
} from "./safe.js";

export async function readBaseline(
  state: string,
): Promise<{ backup: string; manifest: BaselineManifest }> {
  const backup = dirname(resolve(state));
  const seal = sealSchema.parse(
    JSON.parse(await readFile(await safePath(backup, "seal.json"), "utf8")),
  );
  if (seal.manifest.path !== "manifest.json" || resolve(state) !== join(backup, "manifest.json")) {
    throw new BaselineError("BASELINE_INVALID_MANIFEST_PATH");
  }
  const actual = await fileFingerprint(await safePath(backup, seal.manifest.path));
  if (actual.sha256 !== seal.manifest.sha256 || actual.bytes !== seal.manifest.bytes) {
    throw new BaselineError("BASELINE_MANIFEST_HASH_MISMATCH");
  }
  const manifest = manifestSchema.parse(JSON.parse(await readFile(state, "utf8")));
  return { backup, manifest };
}

/** Imports files/crypto/Git/schema validation only. No PostgreSQL, environment or network. */
export async function verifyBaseline(input: {
  state: string;
  output: string;
  verifierRepository: string;
  signal: AbortSignal;
}): Promise<BaselineVerification> {
  const { backup, manifest } = await readBaseline(input.state);
  disjoint(backup, input.output);
  for (const root of manifest.roots) {
    disjoint(root.path, input.output);
  }
  const output = await newDirectory(input.output);
  const failures: string[] = [];
  let filesChecked = 0;
  let databasesChecked = 0;
  const check = async (path: string, hash: string, bytes: number) => {
    input.signal.throwIfAborted();
    const actual = await fileFingerprint(await safePath(backup, path));
    if (actual.sha256 !== hash || actual.bytes !== bytes) {
      throw new BaselineError("BASELINE_ARTIFACT_HASH_MISMATCH");
    }
    const mode = (await stat(join(backup, path))).mode;
    if ((mode & 0o077) !== 0) {
      throw new BaselineError("BASELINE_PRIVATE_PERMISSIONS_REQUIRED");
    }
  };
  for (const file of manifest.files) {
    if (file.status !== "copied") {
      continue;
    }
    try {
      if (
        !file.artifact ||
        !file.sha256 ||
        file.bytes === null ||
        credentialFile(file.path) ||
        !manifest.roots.some((r) => r.id === file.root) ||
        file.artifact !== `files/${file.root}/${file.path}`
      ) {
        throw new BaselineError("BASELINE_UNSAFE_FILE_ARTIFACT");
      }
      await check(file.artifact, file.sha256, file.bytes);
      if (
        !file.opaquePrivate &&
        (await fileFingerprint(await safePath(backup, file.artifact), true)).secret
      ) {
        throw new BaselineError("BASELINE_SENSITIVE_FILE_ARTIFACT");
      }
      filesChecked++;
    } catch (error) {
      failures.push(
        `file:${file.root}/${file.path}:${error instanceof BaselineError ? error.code : "NOT_VERIFIABLE"}`,
      );
    }
  }
  for (const database of manifest.databases) {
    if (database.status !== "captured") {
      continue;
    }
    try {
      if (!database.dump || !database.inventory || !database.snapshot) {
        throw new BaselineError("BASELINE_DATABASE_ARTIFACT_MISSING");
      }
      const origin = database.origin;
      if (
        origin.kind === "stopped-volume-copy" &&
        (origin.originalSystemIdentifier !== database.snapshot.identity.systemIdentifier ||
          !manifest.roots.some((root) => root.id === origin.evidenceRoot))
      ) {
        throw new BaselineError("BASELINE_DATABASE_ORIGIN_MISMATCH");
      }
      await check(database.dump.path, database.dump.sha256, database.dump.bytes);
      await check(database.inventory.path, database.inventory.sha256, database.inventory.bytes);
      if (
        JSON.stringify(
          JSON.parse(await readFile(await safePath(backup, database.inventory.path), "utf8")),
        ) !== JSON.stringify(database.snapshot) ||
        jsonHash({
          tables: database.snapshot.tables,
          sequences: database.snapshot.sequences,
          studies: database.snapshot.studies,
        }) !== database.snapshot.inventorySha256
      ) {
        throw new BaselineError("BASELINE_DATABASE_INVENTORY_MISMATCH");
      }
      databasesChecked++;
    } catch (error) {
      failures.push(
        `database:${database.id}:${error instanceof BaselineError ? error.code : "NOT_VERIFIABLE"}`,
      );
    }
  }
  try {
    await check(manifest.git.bundle.path, manifest.git.bundle.sha256, manifest.git.bundle.bytes);
    const code = await recoverBaselineGit(
      await safePath(backup, manifest.git.bundle.path),
      manifest.git.references,
      join(output, "git-proof"),
      input.signal,
    );
    const pts = await verifyPts(
      code,
      "knowledge/trading/pts",
      "knowledge/trading/pts-versions/pts-trend-reversal/0.1.0.json",
    );
    if (
      pts.bundleSha256 !== manifest.pts.bundleSha256 ||
      pts.candidateSha256 !== manifest.pts.candidateSha256
    ) {
      throw new BaselineError("BASELINE_PTS_RECOVERY_MISMATCH");
    }
  } catch (error) {
    failures.push(`git:${error instanceof BaselineError ? error.code : "NOT_VERIFIABLE"}`);
  }
  if (
    manifest.status === "complete" &&
    (manifest.unavailable.length ||
      manifest.files.some((f) => ["changed", "unavailable"].includes(f.status)) ||
      manifest.databases.some((d) => d.status !== "captured"))
  ) {
    failures.push("BASELINE_FALSE_COMPLETENESS");
  }
  const result: BaselineVerification = {
    protocol: "trading-baseline-verification-v1",
    verifierCommit: await git(input.verifierRepository, ["rev-parse", "HEAD"], input.signal),
    captureId: manifest.captureId,
    status: failures.length ? "failed" : "verified",
    completeness: manifest.status,
    filesChecked,
    databasesChecked,
    failures,
  };
  await writeJson(join(output, "verification.json"), result);
  await baselineReport(output, manifest, result);
  return result;
}
