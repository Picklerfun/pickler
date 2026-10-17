import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PilotError } from "@pickler/core";
import {
  canonicalAudit,
  qualifyComponentPaperCapture,
  type PerpsSmaReentryConfig,
} from "@pickler/trading/evaluation";
import { runReaderAudit } from "./reader-audit.js";

const transportPaths = [
  "packages/infrastructure/src/perpl/stream.ts",
  "packages/infrastructure/src/perpl/wire.ts",
  "packages/infrastructure/src/perpl/data.ts",
  "packages/infrastructure/src/perpl/transport.ts",
  "packages/agent-runtime/src/plugins/perps-paper/universe-stream.ts",
] as const;

/** Explicit adoption of a pinned capture; no environment, providers or database are loaded. */
export async function adoptComponentQualification(
  path: string,
  config: PerpsSmaReentryConfig,
  commit: string,
  output: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const state = resolve(path);
  if ((await stat(state)).size > 32 * 1024 * 1024) {
    throw new PilotError("QUALIFICATION_REQUIRED", "Qualification exceeds its size limit");
  }
  const bytes = await readFile(state);
  const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  if (
    bytes.length > 32 * 1024 * 1024 ||
    hash(bytes) !== config.captureQualification?.reportSha256
  ) {
    throw new PilotError("QUALIFICATION_REQUIRED", "Frozen qualification hash mismatch");
  }
  const capture = JSON.parse(bytes.toString("utf8"));
  const proof = qualifyComponentPaperCapture(capture, config, hash);
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", proof.sourceCommit, commit], {
      stdio: "ignore",
    });
    for (const path of transportPaths) {
      const previous = execFileSync("git", ["show", `${proof.sourceCommit}:${path}`]);
      const current = execFileSync("git", ["show", `${commit}:${path}`]);
      if (!previous.equals(current)) {
        throw new PilotError("QUALIFICATION_REQUIRED", "Qualified public transport changed");
      }
    }
  } catch (error) {
    if (error instanceof PilotError) {
      throw error;
    }
    throw new PilotError("QUALIFICATION_REQUIRED", "Qualification ancestry is not verifiable");
  }
  const replay = await runReaderAudit(state, join(output, "qualification-replay"), signal);
  const reconstructed = replay.replay as
    | {
        status?: string;
        truncated?: boolean;
        messages?: number;
      }
    | undefined;
  if (
    reconstructed?.status !== "RETAINED_PREFIX_REPLAYED" ||
    reconstructed.truncated !== false ||
    reconstructed.messages !== replay.streamEvidence?.messages
  ) {
    throw new PilotError("QUALIFICATION_REQUIRED", "Complete capture reconstruction is required");
  }
  const result = {
    ...proof,
    paperCommit: commit,
    paperConfigurationHash: hash(canonicalAudit(config)),
    publicTransportUnchanged: transportPaths,
    replay: reconstructed,
  };
  signal.throwIfAborted();
  await writeFile(
    join(output, "qualification-adoption.json"),
    JSON.stringify(result, null, 2) + "\n",
    {
      flag: "wx",
      mode: 0o600,
    },
  );
  return result;
}
