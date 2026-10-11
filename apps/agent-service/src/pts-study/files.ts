import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { PilotError } from "@pickler/core";
import { canonicalAudit } from "@pickler/trading/evaluation";
export const digest = (v: unknown) => createHash("sha256").update(canonicalAudit(v)).digest("hex");
export const bytesHash = (v: string) => createHash("sha256").update(v).digest("hex");
export const commit = () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
export function refuseSecrets(value: unknown): void {
  if (
    typeof value === "string" &&
    /postgres(?:ql)?:\/\/|Bearer\s+\S+|-----BEGIN .*PRIVATE KEY-----|https?:\/\/[^/\s]*@/i.test(
      value,
    )
  ) {
    throw new PilotError("AUDIT_SENSITIVE_INPUT", "Secret-bearing data is forbidden");
  }
  if (Array.isArray(value)) {
    value.forEach(refuseSecrets);
  } else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (/password|api.?key|private.?key|authorization|^owner$|headers|secret/i.test(key)) {
        throw new PilotError("AUDIT_SENSITIVE_INPUT", "Secret-bearing fields are forbidden");
      }
      refuseSecrets(v);
    }
  }
}
export async function readJson(path: string) {
  const text = await readFile(resolve(path), "utf8");
  if (Buffer.byteLength(text) > 256 * 1024 * 1024) {
    throw new PilotError("INVALID_INPUT", "PTS artifact exceeds 256 MiB");
  }
  const value: unknown = JSON.parse(text);
  refuseSecrets(value);
  return value;
}
export async function newDirectory(path?: string) {
  if (!path) {
    throw new PilotError("INVALID_INPUT", "New --output directory required");
  }
  const dir = resolve(path);
  await mkdir(dir, { mode: 0o700 });
  return dir;
}
export async function publish(dir: string, files: Record<string, string>) {
  for (const [name, body] of Object.entries(files)) {
    const tmp = join(dir, name + ".tmp");
    await writeFile(tmp, body, { mode: 0o600 });
    await rename(tmp, join(dir, name));
  }
}
