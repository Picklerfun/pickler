import { PilotError } from "@pickler/core";
import type {
  BreakoutAcknowledgement,
  BreakoutClockBoundary,
  BreakoutClockCertificate,
  BreakoutClockInterval,
  BreakoutFinancialRole,
} from "./types.js";

export const BREAKOUT_MAX_GAP_MS = 90_000;
export type BreakoutGapStatus =
  "COMPLIANT" | "PROVED_GAP_BREACH" | "GAP_COMPLIANCE_UNPROVED" | "CLOCK_PROOF_FAILURE";
export interface BreakoutGapProof {
  status: BreakoutGapStatus;
  reason: string;
  financial: BreakoutClockInterval | null;
  monotonic: BreakoutClockInterval | null;
}

function intervalValid(interval: BreakoutClockInterval): boolean {
  return (
    Number.isFinite(interval.lowerMs) &&
    Number.isFinite(interval.upperMs) &&
    interval.lowerMs >= 0 &&
    interval.upperMs >= interval.lowerMs
  );
}
function elapsed(
  previous: BreakoutClockInterval,
  next: BreakoutClockInterval,
): BreakoutClockInterval {
  return { lowerMs: next.lowerMs - previous.upperMs, upperMs: next.upperMs - previous.lowerMs };
}
function qualification(
  boundary: BreakoutClockBoundary,
  scope: BreakoutClockCertificate["scope"],
): boolean {
  if (!boundary.id || !boundary.operationId || !boundary.certificateId || !boundary.epochId) {
    return false;
  }
  if (boundary.kind === "K") {
    return true;
  }
  if (scope === "source-local") {
    return boundary.kind === "J" && !!boundary.sourceIdentity && boundary.acceptedProof === true;
  }
  if (boundary.kind === "J") {
    return false;
  }
  if (
    !boundary.accountRole ||
    (!Number.isSafeInteger(boundary.marketId) && !boundary.marketIds?.length)
  ) {
    return false;
  }
  if (boundary.kind === "A_BEFORE_EFFECT" || boundary.kind === "OPENED_AT") {
    return boundary.acceptedProof === true;
  }
  return (
    boundary.acceptedProof === true &&
    !!boundary.authoritativeRecordId &&
    !!boundary.sourceIdentity &&
    (boundary.kind === "V" || boundary.kind === "V_CLOSE")
  );
}

/** Source-local J and financial V require separately accepted certificates and populations. */
export function compareBreakoutBoundaries(
  previous: BreakoutClockBoundary | null,
  next: BreakoutClockBoundary | null,
  certificates: readonly BreakoutClockCertificate[],
  scope: BreakoutClockCertificate["scope"] = previous?.kind === "J" || next?.kind === "J"
    ? "source-local"
    : "financial-valuation",
): BreakoutGapProof {
  const unproved = (reason: string): BreakoutGapProof => ({
    status: "GAP_COMPLIANCE_UNPROVED",
    reason,
    financial: null,
    monotonic: null,
  });
  const failed = (reason: string): BreakoutGapProof => ({
    status: "CLOCK_PROOF_FAILURE",
    reason,
    financial: null,
    monotonic: null,
  });
  if (!previous || !next || !qualification(previous, scope) || !qualification(next, scope)) {
    return unproved("ORIGINAL_QUALIFIED_BOUNDARY_UNAVAILABLE");
  }
  if (
    ![previous.financial, previous.monotonic, next.financial, next.monotonic].every(intervalValid)
  ) {
    return failed("INVALID_CLOCK_INTERVAL");
  }
  if (previous.epochId !== next.epochId) {
    return failed("UNBRIDGED_MONOTONIC_EPOCHS");
  }
  const p = certificates.find((c) => c.id === previous.certificateId);
  const q = certificates.find((c) => c.id === next.certificateId);
  if (!p || !q || !p.accepted || !q.accepted || p.scope !== scope || q.scope !== scope) {
    return unproved("ACCEPTED_POPULATION_CERTIFICATE_UNAVAILABLE");
  }
  if (
    p.epochId !== previous.epochId ||
    q.epochId !== next.epochId ||
    p.compatibilityId !== q.compatibilityId
  ) {
    return failed("INCOMPATIBLE_CLOCK_CERTIFICATES");
  }
  for (const [boundary, certificate] of [
    [previous, p],
    [next, q],
  ] as const) {
    const bounds = Object.values(certificate.measuredBounds);
    if (
      !certificate.compatibilityId ||
      !certificate.provenance.length ||
      !bounds.every((n) => Number.isFinite(n) && n >= 0) ||
      certificate.measuredBounds.resolutionMs <= 0 ||
      !Number.isFinite(certificate.validFromMs) ||
      !Number.isFinite(certificate.validUntilMs) ||
      certificate.validUntilMs < certificate.validFromMs
    ) {
      return unproved("MEASURED_NUMERIC_CLOCK_CERTIFICATE_UNAVAILABLE");
    }
    if (
      boundary.financial.lowerMs < certificate.validFromMs ||
      boundary.financial.upperMs > certificate.validUntilMs
    ) {
      return unproved("EXPIRED_OR_OUT_OF_RANGE_CLOCK_CERTIFICATE");
    }
    if (
      boundary.financial.upperMs - boundary.financial.lowerMs <
        certificate.measuredBounds.resolutionMs ||
      boundary.monotonic.upperMs - boundary.monotonic.lowerMs <
        certificate.measuredBounds.resolutionMs
    ) {
      return unproved("BOUNDARY_UNCERTAINTY_NOT_COVERED");
    }
  }
  const financial = elapsed(previous.financial, next.financial);
  const monotonic = elapsed(previous.monotonic, next.monotonic);
  if (financial.upperMs < 0 || monotonic.upperMs < 0) {
    return { status: "CLOCK_PROOF_FAILURE", reason: "CLOCK_REGRESSION", financial, monotonic };
  }
  // Independent financial/monotonic intervals must admit the same elapsed duration.
  if (
    Math.max(financial.lowerMs, monotonic.lowerMs, 0) >
    Math.min(financial.upperMs, monotonic.upperMs)
  ) {
    return {
      status: "CLOCK_PROOF_FAILURE",
      reason: "INCOMPATIBLE_ELAPSED_INTERVALS",
      financial,
      monotonic,
    };
  }
  if (financial.lowerMs > BREAKOUT_MAX_GAP_MS || monotonic.lowerMs > BREAKOUT_MAX_GAP_MS) {
    return {
      status: "PROVED_GAP_BREACH",
      reason: "TRUSTWORTHY_LOWER_BOUND_EXCEEDS_90000_MS",
      financial,
      monotonic,
    };
  }
  if (financial.upperMs > BREAKOUT_MAX_GAP_MS || monotonic.upperMs > BREAKOUT_MAX_GAP_MS) {
    return {
      status: "GAP_COMPLIANCE_UNPROVED",
      reason: "UPPER_BOUND_EXCEEDS_90000_MS",
      financial,
      monotonic,
    };
  }
  return {
    status: "COMPLIANT",
    reason: "BOTH_CERTIFIED_UPPER_BOUNDS_WITHIN_90000_MS",
    financial,
    monotonic,
  };
}

export type BreakoutCommitTiming =
  | "CONFIRMED_WITHIN_ACK_WINDOW"
  | "PROVED_LATE_COMMIT"
  | "LATE_ACK_WITH_COMMIT_TIME_UNRESOLVED"
  | "UNKNOWN_OUTCOME"
  | "PROVED_ROLLBACK"
  | "ACKNOWLEDGEMENT_TIME_UNPROVED";

export function breakoutCommitTiming(
  status: "confirmed" | "rolled_back" | "unknown",
  acknowledgement: BreakoutAcknowledgement | null,
  deadline: number,
): BreakoutCommitTiming {
  if (status === "unknown") {
    return "UNKNOWN_OUTCOME";
  }
  if (status === "rolled_back") {
    return "PROVED_ROLLBACK";
  }
  if (
    !acknowledgement ||
    acknowledgement.receivedAt === null ||
    !Number.isFinite(acknowledgement.receivedAt)
  ) {
    return "ACKNOWLEDGEMENT_TIME_UNPROVED";
  }
  const commit = acknowledgement.irreversibleCommitAt;
  if (commit && intervalValid(commit) && commit.lowerMs >= deadline) {
    return "PROVED_LATE_COMMIT";
  }
  if (acknowledgement.receivedAt >= deadline) {
    return "LATE_ACK_WITH_COMMIT_TIME_UNRESOLVED";
  }
  return "CONFIRMED_WITHIN_ACK_WINDOW";
}

export interface BreakoutExposureSupervision {
  role: BreakoutFinancialRole;
  marketId: number;
  positionOrAttemptId: string;
  openingAnchor: BreakoutClockBoundary | null;
  valuations: readonly BreakoutClockBoundary[];
  /** Unknown close never supplies this endpoint. */
  closeAcknowledgement: BreakoutClockBoundary | null;
  stillPossiblyExposed: boolean;
  monitorBoundary: BreakoutClockBoundary | null;
}

/** Opening/first/successive/trailing/close intervals remain distinct; late catch-up repairs none. */
export function breakoutExposureGaps(
  exposure: BreakoutExposureSupervision,
  certificates: readonly BreakoutClockCertificate[],
) {
  const qualifies = (v: BreakoutClockBoundary) =>
    v.accountRole === exposure.role &&
    (v.marketId === exposure.marketId ||
      (v.marketIds?.includes(exposure.marketId) === true &&
        v.acceptedRecords?.some(
          (r) => r.marketId === exposure.marketId && !!r.recordId && !!r.sourceIdentity,
        ) === true));
  const original = new Map<string, BreakoutClockBoundary>();
  for (const value of exposure.valuations) {
    if (value.kind !== "V" || !qualifies(value)) {
      throw new PilotError(
        "INVALID_INPUT",
        "A valuation must prove the exact original account and market",
      );
    }
    const key = `${value.operationId}:${exposure.role}:${exposure.marketId}`;
    const existing = original.get(key);
    if (existing && existing.id !== value.id) {
      throw new PilotError(
        "INVALID_INPUT",
        "A duplicate cannot replace the first original acknowledgement",
      );
    }
    original.set(key, existing ?? value);
  }
  const anchor =
    exposure.openingAnchor && qualifies(exposure.openingAnchor) ? exposure.openingAnchor : null;
  const closed = exposure.closeAcknowledgement;
  if (closed && (closed.kind !== "V_CLOSE" || !qualifies(closed))) {
    throw new PilotError("INVALID_INPUT", "Full-close endpoint must prove the exact closed market");
  }
  const boundaries = [anchor, ...original.values()];
  if (closed) {
    boundaries.push(closed);
  } else if (exposure.stillPossiblyExposed) {
    boundaries.push(exposure.monitorBoundary);
  } else {
    // A caller's flat flag is not an authoritative terminal acknowledgement.
    boundaries.push(null);
  }
  if (boundaries.length === 1) {
    boundaries.push(null);
  }
  const intervals = boundaries.slice(1).map((next, i) => ({
    previous: boundaries[i]?.id ?? null,
    next: next?.id ?? null,
    proof: compareBreakoutBoundaries(
      boundaries[i] ?? null,
      next,
      certificates,
      "financial-valuation",
    ),
  }));
  return {
    role: exposure.role,
    marketId: exposure.marketId,
    positionOrAttemptId: exposure.positionOrAttemptId,
    intervals,
    accepted: intervals.length > 0 && intervals.every((i) => i.proof.status === "COMPLIANT"),
  };
}

/** Keep the economic openedAt and original acknowledgement separate from this wrapper anchor. */
export function breakoutOpeningAnchor(input: {
  beforeEffect: BreakoutClockBoundary | null;
  nativeOpenedAt: BreakoutClockBoundary | null;
  confirmedOpening: boolean;
  certificates: readonly BreakoutClockCertificate[];
}): BreakoutClockBoundary | null {
  const before = input.beforeEffect;
  const opened = input.nativeOpenedAt;
  if (!before || before.kind !== "A_BEFORE_EFFECT") {
    return null;
  }
  if (!input.confirmedOpening) {
    return before;
  }
  if (
    !opened ||
    opened.kind !== "OPENED_AT" ||
    before.accountRole !== opened.accountRole ||
    before.marketId !== opened.marketId ||
    before.epochId !== opened.epochId
  ) {
    return null;
  }
  const p = input.certificates.find((c) => c.id === before.certificateId);
  const q = input.certificates.find((c) => c.id === opened.certificateId);
  if (
    !p?.accepted ||
    !q?.accepted ||
    p.scope !== "financial-valuation" ||
    q.scope !== "financial-valuation" ||
    p.compatibilityId !== q.compatibilityId
  ) {
    return null;
  }
  const financialEarlier = before.financial.lowerMs <= opened.financial.lowerMs;
  const monotonicEarlier = before.monotonic.lowerMs <= opened.monotonic.lowerMs;
  if (financialEarlier !== monotonicEarlier) {
    return null;
  }
  return financialEarlier ? before : opened;
}

/** Every minute interval intersecting possible exposure is required, including unknown effects. */
export function breakoutRequiredExposureMinutes(input: {
  exposure: BreakoutExposureSupervision;
  minuteOrigin: number;
  validOriginalScheduledMinutes: ReadonlySet<number>;
}) {
  const { exposure } = input;
  const opening = exposure.openingAnchor;
  const endpoint = exposure.closeAcknowledgement ?? exposure.monitorBoundary;
  if (
    !opening ||
    !endpoint ||
    !intervalValid(opening.financial) ||
    !intervalValid(endpoint.financial)
  ) {
    return { status: "GAP_COMPLIANCE_UNPROVED", required: [], missing: [] };
  }
  const first = Math.floor((opening.financial.lowerMs - input.minuteOrigin) / 60_000);
  const last = Math.ceil((endpoint.financial.upperMs - input.minuteOrigin) / 60_000) - 1;
  if (
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(last) ||
    last < first ||
    last - first > 50_000
  ) {
    return { status: "GAP_COMPLIANCE_UNPROVED", required: [], missing: [] };
  }
  const required = Array.from(
    { length: last - first + 1 },
    (_, i) => input.minuteOrigin + (first + i) * 60_000,
  );
  const missing = required.filter((minute) => !input.validOriginalScheduledMinutes.has(minute));
  return {
    status: missing.length ? "REQUIRED_EXPOSED_MINUTE_MISSING" : "COMPLETE",
    required,
    missing,
  };
}
