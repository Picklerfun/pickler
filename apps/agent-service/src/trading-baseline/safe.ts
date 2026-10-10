import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export class BaselineError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "BaselineError";
  }
}
export const sha256 = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export const jsonHash = (value: unknown) => sha256(JSON.stringify(value));
export const git = async (cwd: string, args: string[], signal: AbortSignal) => {
  try {
    const result = await promisify(execFile)("git", ["-C", cwd, ...args], {
      signal,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    return result.stdout.trim();
  } catch {
    throw new BaselineError("BASELINE_GIT_FAILED");
  }
};

export function relativePath(path: string): string {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").some((p) => !p || p === "." || p === "..")
  ) {
    throw new BaselineError("BASELINE_UNSAFE_PATH");
  }
  return path;
}

/** Reject symlinks in every component, including parent directories. */
export async function safePath(root: string, path: string): Promise<string> {
  relativePath(path);
  const base = resolve(root);
  if ((await realpath(base)) !== base) {
    throw new BaselineError("BASELINE_SYMLINK_FORBIDDEN");
  }
  let part = base;
  for (const segment of path.split("/")) {
    part = join(part, segment);
    const info = await lstat(part);
    if (info.isSymbolicLink()) {
      throw new BaselineError("BASELINE_SYMLINK_FORBIDDEN");
    }
  }
  return part;
}

export async function newDirectory(path: string): Promise<string> {
  const output = resolve(path);
  const parent = resolve(output, "..");
  if ((await realpath(parent)) !== parent) {
    throw new BaselineError("BASELINE_SYMLINK_FORBIDDEN");
  }
  try {
    await mkdir(output, { mode: 0o700 });
  } catch {
    throw new BaselineError("BASELINE_NEW_DIRECTORY_REQUIRED");
  }
  return output;
}
export function disjoint(source: string, output: string): void {
  for (const [a, b] of [
    [source, output],
    [output, source],
  ]) {
    const path = relative(resolve(a!), resolve(b!));
    if (!path || (!path.startsWith("..") && !isAbsolute(path))) {
      throw new BaselineError("BASELINE_OVERLAPPING_PATHS");
    }
  }
}
export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

export const credentialFile = (path: string) =>
  /(^|\/)(\.env(?:\..*)?|\.dev\.vars(?:\..*)?|[^/]+\.env|[^/]*(?:credentials|secrets?|private[-_]?key|pgpass)[^/]*|[^/]+\.private|[^/]+\.(?:pem|key|p12|pfx))$/i.test(
    path,
  );
export const privateBinary = (path: string) =>
  /\.(?:dump|bundle|gz|zip|tar|pdf|png|jpe?g|webp)$/i.test(path);
const sensitive = (text: string) =>
  /postgres(?:ql)?:\/\/|\bBearer\s+[a-zA-Z0-9_.-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[a-zA-Z0-9_-]{16,}|(?:"(?:password|api[-_]?key|private[-_]?key|authorization|secret|DATABASE_URL|MODEL_API_KEY|EXA_API_KEY)"\s*:\s*"[^"\s]+")/i.test(
    text,
  );

export async function fileFingerprint(path: string, inspectSecrets = false) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new BaselineError("BASELINE_REGULAR_FILE_REQUIRED");
  }
  const hash = createHash("sha256");
  let tail = "";
  let secret = false;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunk of stream) {
      const bytes = chunk as Buffer;
      hash.update(bytes);
      if (inspectSecrets) {
        const text = tail + bytes.toString("utf8");
        secret ||= sensitive(text);
        tail = text.slice(-8192);
      }
    }
  } finally {
    await handle.close();
  }
  const after = await lstat(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) {
    throw new BaselineError("BASELINE_FILE_CHANGED");
  }
  return { sha256: hash.digest("hex"), bytes: after.size, mtimeMs: after.mtimeMs, secret };
}
export const html = (value: unknown) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export const csv = (value: unknown) => {
  const text = String(value ?? "");
  const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};
