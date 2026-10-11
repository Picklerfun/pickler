import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, open, rename, unlink, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { PilotError } from "@pickler/core";
import { canonicalAuditChunks } from "@pickler/trading/evaluation";
import { bufferedChunks } from "./serialization.js";
export const digest = (v: unknown) => {
  const hash = createHash("sha256");
  for (const chunk of bufferedChunks(canonicalAuditChunks(v))) {
    hash.update(chunk);
  }
  return hash.digest("hex");
};
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
  if ((await stat(resolve(path))).size > 256 * 1024 * 1024) {
    throw new PilotError("INVALID_INPUT", "PTS artifact exceeds 256 MiB");
  }
  const text = await readFile(resolve(path), "utf8");
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
export interface PublishedArtifact {
  bytes: number;
  sha256: string;
}
export async function publish(
  dir: string,
  files: Record<string, string | Iterable<string> | AsyncIterable<string>>,
): Promise<Record<string, PublishedArtifact>> {
  const published: Record<string, PublishedArtifact> = {};
  for (const [name, body] of Object.entries(files)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      throw new PilotError("INVALID_INPUT", "Artifact name must be local");
    }
    const tmp = join(dir, name + "." + randomUUID() + ".tmp");
    const file = await open(tmp, "wx", 0o600);
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      const chunks = typeof body === "string" ? [body] : body;
      for await (const chunk of chunks) {
        const buffer = Buffer.from(chunk, "utf8");
        await file.writeFile(buffer);
        hash.update(buffer);
        bytes += buffer.length;
      }
      await file.sync();
      await file.close();
      await rename(tmp, join(dir, name));
      published[name] = { bytes, sha256: hash.digest("hex") };
    } catch (error) {
      await file.close().catch(() => {});
      await unlink(tmp).catch(() => {});
      throw error;
    }
  }
  return published;
}
