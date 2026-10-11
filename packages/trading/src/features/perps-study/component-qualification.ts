import { PilotError } from "@pickler/core";
import { auditUniverseCapture } from "../perps-paper/reader-audit.js";
import { COMPONENT_PAPER_POLICY } from "../perps-paper/types.js";
import {
  UNIVERSE_COMPONENT_STREAM_POLICY,
  validateUniverseStream,
  universeStreamValidation,
  type UniverseStreamBuffer,
} from "../perps-paper/stream-universe.js";
import type { PerpsPaperFrame } from "../perps-paper/simulation.js";
import { canonicalAudit } from "./audit.js";
import { assertPerpsStudyConfig } from "./policy.js";
import type { PerpsSmaReentryConfig } from "./types.js";

/** Revalidation of a pinned capture is not historical financial execution. No I/O is reachable. */
export function qualifyComponentPaperCapture(
  input: unknown,
  config: PerpsSmaReentryConfig,
  hash: (value: string) => string,
) {
  assertPerpsStudyConfig(config);
  const capture = input as {
    version: number;
    protocol: string;
    passed: boolean;
    commit: string;
    acquisitionPolicy: string;
    config: PerpsSmaReentryConfig;
    configurationHash: string;
    catalogHash: string;
    readerClosed: boolean;
    error: unknown;
    stream: { truncated: boolean; errors: unknown[]; hash: string };
    cycles: {
      slot: number;
      valid: boolean;
      validatedAt: number;
      frames: PerpsPaperFrame[];
      bufferGeneration: number;
      bufferCopiedAt: number;
      bufferContinuity: UniverseStreamBuffer["continuity"];
    }[];
  };
  const audit = auditUniverseCapture(input);
  const frozen = (value: PerpsSmaReentryConfig) => {
    return canonicalAudit(
      Object.fromEntries(
        Object.entries(value).filter(
          ([key]) => !["sessionId", "acquisitionPolicy", "captureQualification"].includes(key),
        ),
      ),
    );
  };
  if (
    config.acquisitionPolicy !== COMPONENT_PAPER_POLICY ||
    capture.version !== 4 ||
    capture.protocol !== "perps-universe-stability-v1" ||
    capture.acquisitionPolicy !== UNIVERSE_COMPONENT_STREAM_POLICY ||
    capture.commit !== config.captureQualification!.commit ||
    !capture.passed ||
    !capture.readerClosed ||
    capture.error !== null ||
    audit.counts.cycles !== 30 ||
    audit.counts.validCycles < 29 ||
    audit.counts.ownershipFailures !== 0 ||
    !audit.streamEvidence?.leaseReleased ||
    !audit.streamEvidence.socketClosed ||
    audit.streamEvidence.reconstructionErrors !== 0 ||
    capture.stream.truncated ||
    capture.stream.errors.length ||
    frozen(capture.config) !== frozen(config) ||
    hash(canonicalAudit(capture.config)) !== capture.configurationHash ||
    hash(canonicalAudit(capture.config.markets)) !== capture.catalogHash
  ) {
    throw new PilotError(
      "QUALIFICATION_REQUIRED",
      "Pinned component capture is incomplete or incompatible",
    );
  }
  const observations: { slot: number; validMarkets: number; jointValid: boolean }[] = [];
  for (const cycle of capture.cycles) {
    const frames = cycle.frames ?? [];
    if (cycle.valid && frames.length !== config.markets.length) {
      throw new PilotError(
        "QUALIFICATION_REQUIRED",
        "A qualifying cycle must retain every market frame",
      );
    }
    for (const frame of frames) {
      if (hash(JSON.stringify({ snapshot: frame.snapshot, book: frame.book })) !== frame.hash) {
        throw new PilotError("INVALID_INPUT", "Original component capture frame hash mismatch");
      }
    }
    if (!cycle.valid && frames.length === 0) {
      observations.push({ slot: cycle.slot, validMarkets: 0, jointValid: false });
      continue;
    }
    const result = validateUniverseStream({
      network: config.network,
      markets: config.markets,
      buffer: {
        generation: cycle.bufferGeneration,
        observedAt: cycle.bufferCopiedAt,
        ...(cycle.bufferContinuity ? { continuity: cycle.bufferContinuity } : {}),
        components: frames.map((frame) => ({
          symbol: frame.snapshot.market.symbol,
          snapshot: frame.snapshot,
          book: frame.book,
        })),
      },
      now: cycle.validatedAt,
      policy: COMPONENT_PAPER_POLICY,
      hash: (value) => hash(JSON.stringify(value)),
    });
    const jointValid = result.excluded.length === 0;
    if (jointValid !== cycle.valid) {
      throw new PilotError(
        "QUALIFICATION_REQUIRED",
        "Paper freshness diverges from pinned capture",
      );
    }
    observations.push({ slot: cycle.slot, validMarkets: result.frames.length, jointValid });
  }
  return {
    version: 1,
    protocol: "perps-component-paper-qualification-v1",
    sourceCommit: capture.commit,
    sourceReportSha256: config.captureQualification!.reportSha256,
    sourceConfigurationHash: capture.configurationHash,
    sourceCaptureSha256: capture.stream.hash,
    sourceCapturePolicy: capture.acquisitionPolicy,
    dataValidation: universeStreamValidation(COMPONENT_PAPER_POLICY),
    observations,
    validCycles: observations.filter((row) => row.jointValid).length,
    validatedMarkets: observations.reduce((sum, row) => sum + row.validMarkets, 0),
    historicalFills: 0,
    limitation:
      "Pinned public capture revalidated at its original clocks; controlled financial tests are separate. No historical trade is reconstructed.",
  };
}
