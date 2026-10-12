import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, lstat, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PilotError } from "@pickler/core";
import { canonicalAuditChunks, type PerpsStudyView } from "@pickler/trading/evaluation";
import type { PerpsPaperView } from "@pickler/trading/perps";
import type {
  PerpsAuditPart,
  PerpsAuditSourceRevision,
  PerpsAuditCaptureStats,
} from "@pickler/infrastructure/perps-lab";
import { digest, readJson, publish, refuseSecrets } from "./files.js";
import { bufferedChunks, jsonDocument } from "./serialization.js";

export interface PartReference {
  file: string;
  sha256: string;
  bytes: number;
  sourceRevision?: PerpsAuditSourceRevision;
}
export interface PtsExportManifest {
  version: 2;
  protocol: "perps-decision-audit-export-v2";
  exportCommit: string;
  studyProtocol: "perps-pts-sma-v1" | "perps-pts-intraday-sma-v1";
  studyVersion: 8 | 9;
  captureStartedAt: number;
  capturedAt: number;
  payloadHash: string;
  record: PartReference;
  rounds: (PartReference & { slot: number; key: string })[];
  events: (PartReference & { key: string; kind: string; at: number; slot: number | null })[];
  accounts: Record<string, PartReference>;
  sourceCapture?: PerpsAuditCaptureStats;
  sourceIndexHash?: string;
}

const PART_LIMIT = 64 * 1024 * 1024;
const pathPattern = /^parts\/[0-9a-f]{64}\.json$/;

async function checkedPath(directory: string, reference: PartReference) {
  if (
    !pathPattern.test(reference.file) ||
    reference.file !== "parts/" + reference.sha256 + ".json" ||
    !Number.isSafeInteger(reference.bytes) ||
    reference.bytes < 1 ||
    reference.bytes > PART_LIMIT
  ) {
    throw new PilotError("INVALID_INPUT", "Invalid bounded audit part reference");
  }
  const expected = resolve(await realpath(directory), reference.file);
  const actual = await realpath(expected);
  const file = await lstat(expected);
  if (actual !== expected || !file.isFile() || file.size !== reference.bytes) {
    throw new PilotError("AUDIT_HASH_MISMATCH", "Audit part path or length differs");
  }
  return expected;
}

export async function verifyPtsPart(directory: string, reference: PartReference) {
  const path = await checkedPath(directory, reference);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  if (hash.digest("hex") !== reference.sha256) {
    throw new PilotError("AUDIT_HASH_MISMATCH", "Audit part bytes differ");
  }
  return path;
}

export async function readPtsPart<T>(directory: string, reference: PartReference): Promise<T> {
  const path = await verifyPtsPart(directory, reference);
  const value = await readJson(path);
  if (digest(value) !== reference.sha256) {
    throw new PilotError("AUDIT_HASH_MISMATCH", "Audit part canonical value differs");
  }
  return value as T;
}

/** The v2 payload hash is byte-identical to the v1 canonical payload hash. */
export async function ptsPartsPayloadHash(directory: string, manifest: PtsExportManifest) {
  const hash = createHash("sha256");
  async function part(reference: PartReference) {
    const path = await checkedPath(directory, reference);
    const partHash = createHash("sha256");
    for await (const chunk of createReadStream(path)) {
      partHash.update(chunk);
      hash.update(chunk);
    }
    if (partHash.digest("hex") !== reference.sha256) {
      throw new PilotError("AUDIT_HASH_MISMATCH", "Audit part bytes differ");
    }
  }
  hash.update('{"accounts":{');
  const variants = Object.keys(manifest.accounts).sort();
  for (let index = 0; index < variants.length; index++) {
    const variant = variants[index]!;
    hash.update((index ? "," : "") + JSON.stringify(variant) + ":");
    await part(manifest.accounts[variant]!);
  }
  hash.update('},"study":{"events":[');
  for (let index = 0; index < manifest.events.length; index++) {
    if (index) {
      hash.update(",");
    }
    await part(manifest.events[index]!);
  }
  hash.update('],"record":');
  await part(manifest.record);
  hash.update(',"rounds":[');
  for (let index = 0; index < manifest.rounds.length; index++) {
    if (index) {
      hash.update(",");
    }
    await part(manifest.rounds[index]!);
  }
  hash.update("]}}");
  return hash.digest("hex");
}

function sourceIndexHash(manifest: PtsExportManifest) {
  return digest({
    version: 1,
    record: manifest.record,
    rounds: manifest.rounds,
    events: manifest.events,
  });
}

export async function createPtsPartsExport(
  directory: string,
  exportCommit: string,
  options: { reuseSource?: boolean } = {},
) {
  await mkdir(join(directory, "parts"), { recursive: true, mode: 0o700 });
  let previous: PtsExportManifest | undefined;
  let previousConfig: PerpsStudyView["record"]["config"] | undefined;
  if (options.reuseSource) {
    try {
      const candidate = await readPtsExportManifest(join(directory, "export.json"));
      if (candidate.sourceIndexHash) {
        if (candidate.sourceIndexHash !== sourceIndexHash(candidate)) {
          throw new PilotError("AUDIT_HASH_MISMATCH", "Source revision index differs");
        }
        previous = candidate;
        previousConfig = (await readPtsPart<PerpsStudyView["record"]>(directory, candidate.record))
          .config;
      }
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") {
        throw error;
      }
    }
  }
  const previousRounds = new Map(previous?.rounds.map((part) => [part.key, part]));
  const previousEvents = new Map(previous?.events.map((part) => [part.key, part]));
  let sameScope = false;
  const captureStartedAt = Date.now();
  let record: PartReference | undefined;
  let studyProtocol: PtsExportManifest["studyProtocol"] | undefined;
  let studyVersion: PtsExportManifest["studyVersion"] | undefined;
  const rounds: PtsExportManifest["rounds"] = [];
  const events: PtsExportManifest["events"] = [];
  const accounts: PtsExportManifest["accounts"] = {};
  async function emit(part: PerpsAuditPart) {
    refuseSecrets(part.value);
    const sha256 = digest(part.value);
    const name = sha256 + ".json";
    const existing = join(directory, "parts", name);
    let bytes: number;
    try {
      bytes = (await lstat(existing)).size;
      await verifyPtsPart(directory, { file: "parts/" + name, sha256, bytes });
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") {
        throw error;
      }
      function* bounded() {
        let total = 0;
        for (const chunk of bufferedChunks(canonicalAuditChunks(part.value))) {
          total += Buffer.byteLength(chunk);
          if (total > PART_LIMIT) {
            throw new PilotError("PTS_EXPORT_PART_LIMIT", "One audit part exceeds 64 MiB");
          }
          yield chunk;
        }
      }
      bytes = (await publish(join(directory, "parts"), { [name]: bounded() }))[name]!.bytes;
    }
    const reference: PartReference = {
      file: "parts/" + name,
      sha256,
      bytes,
      ...("sourceRevision" in part && part.sourceRevision
        ? { sourceRevision: part.sourceRevision }
        : {}),
    };
    if (part.kind === "record") {
      if (record) {
        throw new PilotError("INVALID_INPUT", "Duplicate audit record");
      }
      if (part.value.config.version !== 8 && part.value.config.version !== 9) {
        throw new PilotError("INVALID_INPUT", "Segmented PTS export requires v8 or v9");
      }
      sameScope = !!previousConfig && digest(previousConfig) === digest(part.value.config);
      record = reference;
      studyProtocol = part.value.config.protocol;
      studyVersion = part.value.config.version;
    } else if (part.kind === "round") {
      rounds.push({ ...reference, slot: part.value.slot, key: part.value.key });
    } else if (part.kind === "event") {
      const data = part.value.data as { slot?: number } | null;
      const fromKey = /^round-(\d+)/.exec(part.value.key)?.[1];
      const slot = data?.slot ?? (fromKey === undefined ? null : Number(fromKey));
      events.push({
        ...reference,
        key: part.value.key,
        kind: part.value.kind,
        at: part.value.at,
        slot,
      });
    } else {
      accounts[part.variant] = reference;
    }
  }
  async function reuse(revision: PerpsAuditSourceRevision) {
    if (!sameScope || revision.version !== 1 || revision.policy !== "postgres-jsonb-sha256-v1") {
      return false;
    }
    const reference =
      revision.kind === "round"
        ? previousRounds.get(revision.key)
        : previousEvents.get(revision.key);
    if (!reference?.sourceRevision || digest(reference.sourceRevision) !== digest(revision)) {
      return false;
    }
    try {
      await verifyPtsPart(directory, reference);
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") {
        return false;
      }
      throw error;
    }
    if (revision.kind === "round") {
      rounds.push({ ...reference } as PtsExportManifest["rounds"][number]);
    } else {
      events.push({ ...reference } as PtsExportManifest["events"][number]);
    }
    return true;
  }
  async function finish(sourceCapture?: PerpsAuditCaptureStats) {
    if (!record || !studyProtocol || !studyVersion) {
      throw new PilotError("INVALID_INPUT", "Audit record absent");
    }
    const manifest: PtsExportManifest = {
      version: 2,
      protocol: "perps-decision-audit-export-v2",
      exportCommit,
      studyProtocol,
      studyVersion,
      captureStartedAt,
      capturedAt: Date.now(),
      payloadHash: "",
      record,
      rounds,
      events,
      accounts,
      ...(sourceCapture ? { sourceCapture } : {}),
    };
    if (sourceCapture?.policy === "postgres-jsonb-sha256-v1") {
      manifest.sourceIndexHash = sourceIndexHash(manifest);
    }
    manifest.payloadHash = await ptsPartsPayloadHash(directory, manifest);
    await publish(directory, { "export.json": jsonDocument(manifest) });
    return manifest;
  }
  return { emit, reuse, finish };
}

export async function readPtsExportManifest(path: string) {
  const manifest = (await readJson(path)) as PtsExportManifest;
  if (
    manifest.version !== 2 ||
    manifest.protocol !== "perps-decision-audit-export-v2" ||
    !(
      (manifest.studyVersion === 8 && manifest.studyProtocol === "perps-pts-sma-v1") ||
      (manifest.studyVersion === 9 && manifest.studyProtocol === "perps-pts-intraday-sma-v1")
    ) ||
    !Number.isSafeInteger(manifest.captureStartedAt) ||
    !Number.isSafeInteger(manifest.capturedAt) ||
    manifest.captureStartedAt > manifest.capturedAt ||
    !Array.isArray(manifest.rounds) ||
    !Array.isArray(manifest.events) ||
    !manifest.accounts ||
    !/^[0-9a-f]{64}$/.test(manifest.payloadHash) ||
    new Set(manifest.rounds.map((part) => part.slot)).size !== manifest.rounds.length ||
    new Set(manifest.events.map((part) => part.key)).size !== manifest.events.length
  ) {
    throw new PilotError("INVALID_INPUT", "Invalid segmented PTS audit manifest");
  }
  return manifest;
}

export type PtsAccounts = Record<string, PerpsPaperView | undefined>;
export type PtsStudy = PerpsStudyView;
