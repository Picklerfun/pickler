import { chmod, copyFile, lstat, mkdir, readdir, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import type { BaselineFile, BaselineInventory } from "./contracts.js";
import {
  BaselineError,
  credentialFile,
  fileFingerprint,
  privateBinary,
  relativePath,
  safePath,
} from "./safe.js";

export async function listBaselineFiles(root: string, prefix = ""): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push(...(await listBaselineFiles(root, path)));
    } else {
      result.push(path);
    }
  }
  return result.sort();
}

export async function exportBaselineFiles(
  inventory: BaselineInventory,
  output: string,
  signal: AbortSignal,
): Promise<BaselineFile[]> {
  const files: BaselineFile[] = [];
  const seen = new Set<string>();
  const roots = new Map(inventory.roots.map((r) => [r.id, r.path]));
  for (const entry of inventory.files) {
    signal.throwIfAborted();
    relativePath(entry.path);
    const root = roots.get(entry.root);
    if (!root || seen.has(`${entry.root}/${entry.path}`)) {
      throw new BaselineError("BASELINE_INVENTORY_INVALID");
    }
    seen.add(`${entry.root}/${entry.path}`);
    const file: BaselineFile = {
      root: entry.root,
      path: entry.path,
      source: join(root, entry.path),
      status: "unavailable",
      reason: null,
      capturedAt: new Date().toISOString(),
      sha256: null,
      bytes: null,
      artifact: null,
      opaquePrivate: privateBinary(entry.path),
    };
    files.push(file);
    if (credentialFile(entry.path)) {
      file.status = "excluded";
      file.reason = "CREDENTIAL_OR_PRIVATE_DIAGNOSTIC_FILE";
      continue;
    }
    let pendingTarget: string | undefined;
    try {
      const source = await safePath(root, entry.path);
      const before = await fileFingerprint(source, !file.opaquePrivate);
      if (before.secret) {
        file.status = "excluded";
        file.reason = "SENSITIVE_CONTENT";
        continue;
      }
      if (
        before.sha256 !== entry.sha256 ||
        before.bytes !== entry.bytes ||
        before.mtimeMs !== entry.mtimeMs
      ) {
        throw new BaselineError("BASELINE_FILE_CHANGED");
      }
      const artifact = `files/${entry.root}/${entry.path}`;
      const target = join(output, artifact);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(source, target, constants.COPYFILE_EXCL);
      pendingTarget = target;
      await chmod(target, 0o600);
      const copied = await fileFingerprint(target);
      const after = await fileFingerprint(source);
      if (
        copied.sha256 !== before.sha256 ||
        after.sha256 !== before.sha256 ||
        copied.bytes !== before.bytes ||
        after.mtimeMs !== before.mtimeMs
      ) {
        throw new BaselineError("BASELINE_FILE_CHANGED");
      }
      file.status = "copied";
      file.sha256 = copied.sha256;
      file.bytes = copied.bytes;
      file.artifact = artifact;
      pendingTarget = undefined;
    } catch (error) {
      if (pendingTarget) {
        await unlink(pendingTarget);
      }
      file.status =
        error instanceof BaselineError && error.code === "BASELINE_FILE_CHANGED"
          ? "changed"
          : "unavailable";
      file.reason = error instanceof BaselineError ? error.code : "BASELINE_FILE_UNAVAILABLE";
    }
  }
  return files;
}

/** Repeat the full root inventory and copied fingerprints at the end, not just immediately after copy. */
export async function checkSourceFiles(
  inventory: BaselineInventory,
  files: BaselineFile[],
  signal: AbortSignal,
) {
  const missing: BaselineInventory["unavailable"] = [];
  for (const root of inventory.roots) {
    signal.throwIfAborted();
    try {
      const expected = inventory.files
        .filter((f) => f.root === root.id)
        .map((f) => f.path)
        .sort();
      const actual = await listBaselineFiles(root.path);
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        missing.push({ kind: "directory", source: root.path, code: "DIRECTORY_INVENTORY_CHANGED" });
      }
    } catch {
      missing.push({ kind: "directory", source: root.path, code: "DIRECTORY_NOT_VERIFIABLE" });
    }
  }
  for (const file of files.filter((f) => f.status === "copied")) {
    try {
      const actual = await fileFingerprint(file.source);
      const expected = inventory.files.find((f) => f.root === file.root && f.path === file.path)!;
      if (
        actual.sha256 !== file.sha256 ||
        actual.bytes !== file.bytes ||
        actual.mtimeMs !== expected.mtimeMs
      ) {
        file.status = "changed";
        file.reason = "BASELINE_FILE_CHANGED";
      }
    } catch {
      file.status = "unavailable";
      file.reason = "BASELINE_FILE_UNAVAILABLE";
    }
  }
  return missing;
}

export async function restoreBaselineFiles(
  backup: string,
  files: BaselineFile[],
  output: string,
): Promise<number> {
  let copied = 0;
  for (const file of files.filter((f) => f.status === "copied")) {
    if (!file.artifact || credentialFile(file.path)) {
      throw new BaselineError("BASELINE_UNSAFE_FILE_ARTIFACT");
    }
    relativePath(file.root);
    relativePath(file.path);
    const source = await safePath(backup, file.artifact);
    const target = join(output, "files", file.root, file.path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(source, target, constants.COPYFILE_EXCL);
    await chmod(target, 0o400);
    const actual = await fileFingerprint(target);
    if (
      actual.sha256 !== file.sha256 ||
      actual.bytes !== file.bytes ||
      !(await lstat(target)).isFile()
    ) {
      throw new BaselineError("BASELINE_FILE_RESTORE_MISMATCH");
    }
    copied++;
  }
  return copied;
}
