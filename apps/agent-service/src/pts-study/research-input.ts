import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PilotError } from "@pickler/core";
import {
  PTS_INTRADAY_RESPONSIVE_POLICY,
  PTS_RESEARCH_CANDIDATES,
  assertPtsReplay,
  type PtsReplayInput,
  type PtsResearchCandidateId,
} from "@pickler/trading/pts";
import { digest, readJson, refuseSecrets } from "./files.js";
import { researchJsonPath } from "./research-path.js";

export interface ResearchFile {
  file: string;
  sha256: string;
}

export interface PtsResearchInput {
  format: "pts-research-input-v1";
  version: 1;
  reference: ResearchFile & { id: "pts-intraday"; version: "0.2.0-fast.2" };
  candidates: (ResearchFile & { id: PtsResearchCandidateId; version: "0.1.0" })[];
  sources: {
    audit: ResearchFile & { payloadHash: string };
    history: ResearchFile & { historyHash: string };
  };
  dataUse: "examined-development";
  historyWindow: { from: number; to: number; stepSeconds: 300 };
}

const HASH = /^[0-9a-f]{64}$/;

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function keys(value: object, expected: string[]) {
  return Object.keys(value).sort().join(",") === expected.sort().join(",");
}

function fileReference(value: unknown): value is ResearchFile & Record<string, unknown> {
  return (
    object(value) &&
    typeof value.file === "string" &&
    value.file.length > 0 &&
    value.file.length <= 4096 &&
    !value.file.includes("\0") &&
    !/^[a-z][a-z\d+.-]*:/i.test(value.file) &&
    value.file.endsWith(".json") &&
    !/(^|[/\\])(?:\.env[^/\\]*|credentials[^/\\]*|secrets?[^/\\]*)($|[/\\])/i.test(value.file) &&
    typeof value.sha256 === "string" &&
    HASH.test(value.sha256)
  );
}

export function assertPtsResearchInput(value: unknown): asserts value is PtsResearchInput {
  if (
    !object(value) ||
    !keys(value, [
      "format",
      "version",
      "reference",
      "candidates",
      "sources",
      "dataUse",
      "historyWindow",
    ]) ||
    value.format !== "pts-research-input-v1" ||
    value.version !== 1 ||
    value.dataUse !== "examined-development" ||
    !fileReference(value.reference) ||
    !keys(value.reference, ["id", "version", "file", "sha256"]) ||
    value.reference.id !== "pts-intraday" ||
    value.reference.version !== "0.2.0-fast.2" ||
    !Array.isArray(value.candidates) ||
    value.candidates.length !== PTS_RESEARCH_CANDIDATES.length ||
    value.candidates.some(
      (item, index) =>
        !fileReference(item) ||
        !keys(item, ["id", "version", "file", "sha256"]) ||
        item.id !== PTS_RESEARCH_CANDIDATES[index]?.id ||
        item.version !== "0.1.0",
    ) ||
    !object(value.sources) ||
    !keys(value.sources, ["audit", "history"]) ||
    !fileReference(value.sources.audit) ||
    !keys(value.sources.audit, ["file", "sha256", "payloadHash"]) ||
    typeof value.sources.audit.payloadHash !== "string" ||
    !HASH.test(value.sources.audit.payloadHash) ||
    !fileReference(value.sources.history) ||
    !keys(value.sources.history, ["file", "sha256", "historyHash"]) ||
    typeof value.sources.history.historyHash !== "string" ||
    !HASH.test(value.sources.history.historyHash) ||
    !object(value.historyWindow) ||
    !keys(value.historyWindow, ["from", "to", "stepSeconds"]) ||
    !Number.isSafeInteger(value.historyWindow.from) ||
    !Number.isSafeInteger(value.historyWindow.to) ||
    Number(value.historyWindow.to) <= Number(value.historyWindow.from) ||
    Number(value.historyWindow.to) - Number(value.historyWindow.from) > 7 * 86400000 ||
    Number(value.historyWindow.from) % 300000 !== 0 ||
    Number(value.historyWindow.to) % 300000 !== 0 ||
    value.historyWindow.stepSeconds !== 300
  ) {
    throw new PilotError("INVALID_INPUT", "Explicit versioned offline PTS research input required");
  }
}

/** Only explicitly named regular local JSON files are read; no directory discovery or env files. */
export async function readResearchFile(
  manifestPath: string,
  reference: ResearchFile,
  signal: AbortSignal,
) {
  if (!fileReference(reference)) {
    throw new PilotError("INVALID_INPUT", "Explicit hashed local JSON source required");
  }
  signal.throwIfAborted();
  const path = await researchJsonPath(reference.file, dirname(resolve(manifestPath)));
  const info = await lstat(path);
  if (!info.isFile() || info.size < 1 || info.size > 256 * 1024 * 1024) {
    throw new PilotError("INVALID_INPUT", "Bounded regular JSON source required");
  }
  if ((await realpath(path)) !== path) {
    throw new PilotError("INVALID_INPUT", "Symlinked research sources are forbidden");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const body = await handle.readFile();
    const after = await handle.stat();
    if (
      body.length !== info.size ||
      after.size !== info.size ||
      after.mtimeMs !== info.mtimeMs ||
      after.ino !== info.ino ||
      createHash("sha256").update(body).digest("hex") !== reference.sha256
    ) {
      throw new PilotError("AUDIT_HASH_MISMATCH", "Explicit research source bytes differ");
    }
    signal.throwIfAborted();
    const value: unknown = JSON.parse(body.toString("utf8"));
    refuseSecrets(value);
    return { path, value };
  } finally {
    await handle.close();
  }
}

export async function readPtsResearchInput(path: string, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!fileReference({ file: path, sha256: "0".repeat(64) })) {
    throw new PilotError("INVALID_INPUT", "Explicit local research JSON manifest required");
  }
  const manifestPath = await researchJsonPath(path);
  const manifestInfo = await lstat(manifestPath);
  if (!manifestInfo.isFile() || manifestInfo.size > 64 * 1024) {
    throw new PilotError("INVALID_INPUT", "Bounded regular research manifest required");
  }
  const input = await readJson(manifestPath);
  assertPtsResearchInput(input);
  const reference = await readResearchFile(path, input.reference, signal);
  if (digest(reference.value) !== digest(PTS_INTRADAY_RESPONSIVE_POLICY)) {
    throw new PilotError("AUDIT_HASH_MISMATCH", "Pinned responsive reference policy differs");
  }
  for (const [index, candidate] of input.candidates.entries()) {
    const source = await readResearchFile(path, candidate, signal);
    if (digest(source.value) !== digest(PTS_RESEARCH_CANDIDATES[index])) {
      throw new PilotError("AUDIT_HASH_MISMATCH", "Pinned offline research policy differs");
    }
  }
  const saved = await readResearchFile(path, input.sources.history, signal);
  if (!object(saved.value)) {
    throw new PilotError("INVALID_INPUT", "Versioned frozen history object required");
  }
  const packet = saved.value;
  const envelope = Object.hasOwn(packet, "history");
  if (
    (envelope && packet.format !== "pts-preparation-v1") ||
    (!envelope && packet.format !== "perps-pts-history-v1") ||
    (Object.hasOwn(packet, "version") && packet.version !== 1)
  ) {
    throw new PilotError("INVALID_INPUT", "Unknown frozen history packet format or version");
  }
  const history = (envelope ? packet.history : packet) as PtsReplayInput;
  if (!object(history)) {
    throw new PilotError("INVALID_INPUT", "Frozen native history object required");
  }
  assertPtsReplay(history);
  if (
    history.candidate !== "pts-intraday@0.2.0-fast.2" ||
    digest(history) !== input.sources.history.historyHash ||
    (envelope && packet.historyHash !== input.sources.history.historyHash) ||
    (packet.policyHash !== undefined &&
      packet.policyHash !== digest(PTS_INTRADAY_RESPONSIVE_POLICY)) ||
    input.historyWindow.from < history.from ||
    input.historyWindow.to > history.to ||
    history.markets.length === 0
  ) {
    throw new PilotError("AUDIT_HASH_MISMATCH", "Frozen responsive history identity differs");
  }
  const audit = await readResearchFile(path, input.sources.audit, signal);
  return { input, history, historyPacket: packet, audit };
}
