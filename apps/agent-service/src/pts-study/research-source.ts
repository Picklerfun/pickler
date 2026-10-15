import { dirname } from "node:path";
import { PilotError } from "@pickler/core";
import { assertPtsConfig, ptsVariants, type PerpsPtsConfig } from "@pickler/trading/pts";
import type { PerpsRound, PerpsStudyView } from "@pickler/trading/evaluation";
import { digest } from "./files.js";
import {
  ptsPartsPayloadHash,
  readPtsExportManifest,
  readPtsPart,
  type PartReference,
  type PtsAccounts,
  type PtsExportManifest,
} from "./parts.js";

export interface ResearchSourceReference {
  file: string;
  sha256: string;
  slot: number | null;
  semanticHash?: string;
  semanticHashPolicy?: "sha256-canonical-audit-projection-v1";
  projection?: { kind: "payload" | "round" | "event"; key: string | null };
}

export interface ResearchRound {
  round: PerpsRound;
  events: PerpsStudyView["events"];
  source: ResearchSourceReference;
  eventSources: (ResearchSourceReference & { key: string; kind: string })[];
}

export interface ResearchAuditSource {
  record: PerpsStudyView["record"] & { config: PerpsPtsConfig };
  accounts: PtsAccounts;
  payloadHash: string;
  exportCommit: string;
  version: 1 | 2;
  roundCount: number;
  observationCount: number;
  partReferences: ResearchSourceReference[];
  rounds(): AsyncGenerator<ResearchRound>;
}

function validateRecord(
  record: PerpsStudyView["record"],
  accounts: PtsAccounts,
): asserts record is ResearchAuditSource["record"] {
  if (
    record?.config?.version !== 9 ||
    record.config.protocol !== "perps-pts-intraday-sma-v1" ||
    record.config.candidate !== "pts-intraday@0.2.0-fast.2"
  ) {
    throw new PilotError("INVALID_INPUT", "Responsive v9 original study required");
  }
  assertPtsConfig(record.config);
  if (
    JSON.stringify(Object.keys(accounts).sort()) !==
      JSON.stringify([...ptsVariants(record.config)].sort()) ||
    Object.values(accounts).some((account) => !account)
  ) {
    throw new PilotError("AUDIT_HASH_MISMATCH", "Original portfolio identities differ");
  }
}

function eventSlot(event: PerpsStudyView["events"][number]) {
  const data = event.data as { slot?: number } | null;
  const match = /^round-(\d+)/.exec(event.key)?.[1];
  return data?.slot ?? (match === undefined ? null : Number(match));
}

const replayKinds = new Set(["execution-input", "final-gate", "profile-execution"]);

/** Original packets remain untouched. V2 retains just the small part index, not a study clone. */
export async function openResearchAudit(
  path: string,
  packet: unknown,
  expectedPayloadHash: string,
  expectedFileHash: string,
  signal: AbortSignal,
): Promise<ResearchAuditSource> {
  signal.throwIfAborted();
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    throw new PilotError("INVALID_INPUT", "Original versioned audit packet required");
  }
  const header = packet as Record<string, unknown>;
  if (header.protocol === "perps-decision-audit-export-v1") {
    if (header.version !== 1) {
      throw new PilotError("INVALID_INPUT", "Unknown original audit packet version");
    }
    const payload = header.payload as { study: PerpsStudyView; accounts: PtsAccounts };
    if (
      !payload?.study ||
      !payload.accounts ||
      !Array.isArray(payload.study.rounds) ||
      !Array.isArray(payload.study.events) ||
      header.payloadHash !== expectedPayloadHash ||
      digest(payload) !== expectedPayloadHash
    ) {
      throw new PilotError("AUDIT_HASH_MISMATCH", "Original v1 audit payload differs");
    }
    const { study, accounts } = payload;
    validateRecord(study.record, accounts);
    const record = study.record;
    const seen = new Set<number>();
    for (const round of study.rounds) {
      if (seen.has(round.slot)) {
        throw new PilotError("INVALID_INPUT", "Duplicate original round slot");
      }
      seen.add(round.slot);
    }
    if (new Set(study.events.map((event) => event.key)).size !== study.events.length) {
      throw new PilotError("INVALID_INPUT", "Duplicate original event identity");
    }
    const source = (
      slot: number | null,
      value: unknown,
      kind: "payload" | "round" | "event",
      key: string | null,
    ): ResearchSourceReference => ({
      file: path,
      sha256: expectedFileHash,
      slot,
      semanticHash: digest(value),
      semanticHashPolicy: "sha256-canonical-audit-projection-v1",
      projection: { kind, key },
    });
    return {
      record,
      accounts,
      payloadHash: expectedPayloadHash,
      exportCommit:
        typeof header.exportCommit === "string" ? header.exportCommit : "NOT_VERIFIABLE",
      version: 1,
      roundCount: study.rounds.length,
      observationCount: study.events.filter((event) => event.kind === "observation").length,
      partReferences: [source(null, payload, "payload", null)],
      async *rounds() {
        for (const round of [...study.rounds].sort((left, right) => left.slot - right.slot)) {
          signal.throwIfAborted();
          const events = study.events.filter(
            (event) => eventSlot(event) === round.slot && replayKinds.has(event.kind),
          );
          yield {
            round,
            events,
            source: source(round.slot, round, "round", round.key),
            eventSources: events.map((event) => ({
              ...source(round.slot, event, "event", event.key),
              key: event.key,
              kind: event.kind,
            })),
          };
        }
      },
    };
  }
  if (header.protocol !== "perps-decision-audit-export-v2") {
    throw new PilotError(
      "INVALID_INPUT",
      "Only verified original v1/v2 audit packets are supported",
    );
  }
  const manifest = await readPtsExportManifest(path);
  if (digest(manifest) !== digest(header)) {
    throw new PilotError("AUDIT_HASH_MISMATCH", "Original audit index changed while reading");
  }
  const directory = dirname(path);
  if (
    manifest.payloadHash !== expectedPayloadHash ||
    (await ptsPartsPayloadHash(directory, manifest)) !== expectedPayloadHash
  ) {
    throw new PilotError("AUDIT_HASH_MISMATCH", "Original segmented audit payload differs");
  }
  signal.throwIfAborted();
  const record = await readPtsPart<PerpsStudyView["record"]>(directory, manifest.record);
  const accounts: PtsAccounts = {};
  for (const [variant, reference] of Object.entries(manifest.accounts)) {
    signal.throwIfAborted();
    accounts[variant] = await readPtsPart(directory, reference);
  }
  validateRecord(record, accounts);
  if (
    record.config.version !== manifest.studyVersion ||
    record.config.protocol !== manifest.studyProtocol
  ) {
    throw new PilotError("AUDIT_HASH_MISMATCH", "Original record/index protocol differs");
  }
  const indexedEvents = new Map<number, PtsExportManifest["events"]>();
  let observationCount = 0;
  for (const reference of manifest.events) {
    signal.throwIfAborted();
    const event = await readPtsPart<PerpsStudyView["events"][number]>(directory, reference);
    const slot = eventSlot(event);
    if (
      event.key !== reference.key ||
      event.kind !== reference.kind ||
      event.at !== reference.at ||
      slot !== reference.slot
    ) {
      throw new PilotError("AUDIT_HASH_MISMATCH", "Original event index differs");
    }
    if (event.kind === "observation") {
      observationCount++;
    }
    if (slot !== null && replayKinds.has(event.kind)) {
      indexedEvents.set(slot, [...(indexedEvents.get(slot) ?? []), reference]);
    }
  }
  const source = (reference: PartReference, slot: number | null): ResearchSourceReference => ({
    file: reference.file,
    sha256: reference.sha256,
    slot,
  });
  return {
    record,
    accounts,
    payloadHash: manifest.payloadHash,
    exportCommit: manifest.exportCommit,
    version: 2,
    roundCount: manifest.rounds.length,
    observationCount,
    partReferences: [
      source(manifest.record, null),
      ...Object.values(manifest.accounts).map((reference) => source(reference, null)),
      ...manifest.rounds.map((reference) => source(reference, reference.slot)),
      ...manifest.events.map((reference) => source(reference, reference.slot)),
    ],
    async *rounds() {
      for (const reference of [...manifest.rounds].sort((left, right) => left.slot - right.slot)) {
        signal.throwIfAborted();
        const round = await readPtsPart<PerpsRound>(directory, reference);
        if (round.slot !== reference.slot || round.key !== reference.key) {
          throw new PilotError("AUDIT_HASH_MISMATCH", "Original round index differs");
        }
        const events = [] as PerpsStudyView["events"];
        const eventSources: ResearchRound["eventSources"] = [];
        for (const item of indexedEvents.get(round.slot) ?? []) {
          signal.throwIfAborted();
          events.push(await readPtsPart(directory, item));
          eventSources.push({ ...source(item, round.slot), key: item.key, kind: item.kind });
        }
        yield {
          round,
          events,
          source: source(reference, round.slot),
          eventSources,
        };
      }
    },
  };
}
