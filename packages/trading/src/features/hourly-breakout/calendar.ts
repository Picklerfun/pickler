import { PilotError } from "@pickler/core";
import { BREAKOUT_DECISION_MS, breakoutWindowTimes } from "./policy.js";

export interface BreakoutCalendarProgress {
  /** Greatest original UTC minute already recorded, including an explicitly missed minute. */
  lastMinute: number | null;
  /** Greatest original five-minute slot already attempted or recorded missed. */
  lastDecisionSlot: number | null;
  lastFundingMinute?: number | null;
  admissionsClosed?: boolean;
}

/** Current work only. Missed original identities are reported, never replayed or rebased. */
export function breakoutDueWork(T0: number, now: number, progress: BreakoutCalendarProgress) {
  const { TA, TV, TF } = breakoutWindowTimes(T0);
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    (progress.lastMinute !== null &&
      (!Number.isSafeInteger(progress.lastMinute) ||
        progress.lastMinute > now ||
        progress.lastMinute < T0 ||
        (progress.lastMinute - T0) % 60_000 !== 0)) ||
    (progress.lastDecisionSlot !== null &&
      (!Number.isSafeInteger(progress.lastDecisionSlot) ||
        progress.lastDecisionSlot < 0 ||
        progress.lastDecisionSlot >= 8064 ||
        T0 + progress.lastDecisionSlot * BREAKOUT_DECISION_MS > now)) ||
    (progress.lastFundingMinute !== undefined &&
      progress.lastFundingMinute !== null &&
      (!Number.isSafeInteger(progress.lastFundingMinute) ||
        progress.lastFundingMinute < TV ||
        progress.lastFundingMinute > now ||
        (progress.lastFundingMinute - T0) % 60000 !== 0))
  ) {
    throw new PilotError("CLOCK_PROOF_FAILURE", "Original nonregressing screen calendar required");
  }
  const phase =
    now < T0
      ? "WAITING"
      : now < TA
        ? "ACTIVE"
        : now < TV
          ? "CLOSING"
          : now < TF
            ? "FUNDING"
            : "TERMINAL";
  const currentMinute = T0 + Math.floor((now - T0) / 60_000) * 60_000;
  const minuteRequired = now >= T0 && now < TV;
  const minute =
    minuteRequired && (progress.lastMinute === null || progress.lastMinute < currentMinute)
      ? {
          scheduledAt: currentMinute,
          minuteIndex: (currentMinute - T0) / 60_000,
          grace: currentMinute >= TA,
        }
      : null;
  const previousMinute = progress.lastMinute ?? T0 - 60_000;
  const missingEnd = Math.min(currentMinute, TV);
  const missedMinutes: number[] = [];
  for (let at = previousMinute + 60_000; at < missingEnd; at += 60_000) {
    missedMinutes.push(at);
  }
  const currentSlot = Math.floor((now - T0) / BREAKOUT_DECISION_MS);
  const active = phase === "ACTIVE";
  const scheduledAt = T0 + currentSlot * BREAKOUT_DECISION_MS;
  const claimable = active && now - scheduledAt < 30_000;
  const decision =
    active &&
    (progress.lastDecisionSlot === null || progress.lastDecisionSlot < currentSlot) &&
    claimable
      ? {
          slot: currentSlot,
          scheduledAt,
          claimDeadline: scheduledAt + 30_000,
          admissionDeadline: scheduledAt + BREAKOUT_DECISION_MS,
          candidateHourly: currentSlot % 12 === 0,
        }
      : null;
  const missedDecisionSlots: number[] = [];
  const previousSlot = progress.lastDecisionSlot ?? -1;
  const missingSlotEnd = Math.min(8064, Math.max(0, currentSlot + (active && !claimable ? 1 : 0)));
  for (let slot = previousSlot + 1; slot < missingSlotEnd; slot++) {
    missedDecisionSlots.push(slot);
  }
  const fundingMinute =
    phase === "FUNDING" &&
    (progress.lastFundingMinute === undefined ||
      progress.lastFundingMinute === null ||
      progress.lastFundingMinute < currentMinute)
      ? currentMinute
      : null;
  const nextWakeAt =
    phase === "WAITING"
      ? T0
      : phase === "TERMINAL"
        ? null
        : minute || decision || fundingMinute !== null
          ? now + 1
          : Math.min(
              currentMinute + 60_000 + 100,
              phase === "ACTIVE" ? TA : phase === "CLOSING" ? TV : TF,
            );
  return {
    phase,
    T0,
    TA,
    TV,
    TF,
    minute,
    decision,
    fundingMinute,
    missedMinutes,
    missedDecisionSlots,
    closeAdmissionsDue: now >= TA && progress.admissionsClosed !== true,
    terminalCloseRequired: phase === "CLOSING",
    nextWakeAt,
  };
}
