import { briefToConfig } from "./brief-config.js";
import {
  PilotError,
  assertBrief,
  assertConfig,
  assertMaxLeverage,
  assertSpendLimits,
  briefFingerprint,
  normalizeBrief,
  type AgentBrief,
  type AgentConfig,
  type Decision,
  type RunEvent,
  type RunRecord,
  type SpendLimits,
} from "../research/types.js";

/** Paper runs of a brief (docs/specs/studio-brief-v1.md §4): 5 per user per rolling hour. */
export const PREVIEW_RATE = { perHour: 5, windowMs: 3_600_000 } as const;
/** A preview can be read, and adopted, for 24 h. */
export const PREVIEW_TTL_MS = 86_400_000;

/** 429, with the time the next run is allowed. */
export class PreviewRateLimited extends PilotError {
  constructor(public readonly retryAt: number) {
    super("PREVIEW_RATE_LIMITED", "Five paper runs an hour; the next one opens later");
  }
}

/** When the next preview may start, given the caller's recent creation times; null when now. */
export function previewRetryAt(createdAt: readonly number[], now: number): number | null {
  const recent = createdAt.filter((at) => at > now - PREVIEW_RATE.windowMs).sort((a, b) => a - b);
  if (recent.length < PREVIEW_RATE.perHour) {
    return null;
  }
  return recent[recent.length - PREVIEW_RATE.perHour]! + PREVIEW_RATE.windowMs;
}

export interface PreviewInput {
  brief: AgentBrief;
  spend: SpendLimits;
  maxLeverage: number;
}

/**
 * The one path from what the screen sent to what runs: normalize, check (400 INVALID_BRIEF naming
 * the section, or INVALID_INPUT for the caps), build the config, and fingerprint the eight inputs.
 * The drafts route runs it again on the brief it is sent, and compares fingerprints.
 */
export function preparePreview(input: PreviewInput): { config: AgentConfig; fingerprint: string } {
  const brief = normalizeBrief(input.brief);
  assertBrief(brief);
  const spend = { perCallAusd: input.spend.perCallAusd, perDayAusd: input.spend.perDayAusd };
  assertSpendLimits(spend);
  assertMaxLeverage(input.maxLeverage);
  const config = briefToConfig({ brief, spend, maxLeverage: input.maxLeverage });
  assertConfig(config);
  return {
    config,
    fingerprint: briefFingerprint({ brief, spend, maxLeverage: input.maxLeverage }),
  };
}

/** A preview as its owner reads it. */
export interface PreviewRun {
  id: string;
  status: RunRecord["status"];
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  expiresAt: number;
  adopted: boolean;
  decision: Decision | null;
  error: string | null;
}

export interface PreviewRepository {
  /** Queues a run with no agent row. Throws `PreviewRateLimited` past the hourly limit. */
  create(
    input: {
      userId: string;
      workspaceId: string;
      tenantId: string;
      config: AgentConfig;
      fingerprint: string;
    },
    now: number,
  ): Promise<{ id: string }>;
  /** The owner's run and its trace; NOT_FOUND for anyone else and after it expires. */
  read(userId: string, id: string, now: number): Promise<{ run: PreviewRun; events: RunEvent[] }>;
}

/** What adoption needs to know about a preview row, read under its lock. */
export interface AdoptablePreview {
  userId: string;
  workspaceId: string;
  status: RunRecord["status"];
  expiresAt: number;
  adopted: boolean;
  fingerprint: string;
}

/**
 * §6 steps 1 and 2: the run is the caller's, not expired, completed and not yet adopted (409
 * PREVIEW_UNUSABLE otherwise, the same answer for a run that is someone else's as for one that
 * does not exist), and it was made from exactly this brief (409 RUN_STALE).
 */
export function assertPreviewAdoptable(
  row: AdoptablePreview | null,
  caller: { userId: string; workspaceId: string },
  fingerprint: string,
  now: number,
): void {
  if (
    !row ||
    row.userId !== caller.userId ||
    row.workspaceId !== caller.workspaceId ||
    row.status !== "completed" ||
    row.expiresAt <= now ||
    row.adopted
  ) {
    throw new PilotError("PREVIEW_UNUSABLE", "Run it again, then create");
  }
  if (row.fingerprint !== fingerprint) {
    throw new PilotError("RUN_STALE", "The brief changed since the run");
  }
}
