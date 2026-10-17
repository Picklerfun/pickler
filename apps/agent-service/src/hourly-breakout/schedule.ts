import { setTimeout as wait } from "node:timers/promises";
import { PilotError } from "@pickler/core";

export const CAPTURE_GRID = {
  durationMs: 86400000,
  pumpMs: 20000,
  pumps: 4320,
  minutes: 1440,
  markets: 11,
  pumpCells: 47520,
  canonicalCells: 15840,
  jointMinuteFloor: 1368,
  marketMinuteFloor: 15048,
  perMarketMinuteFloor: 1368,
  sourceGapMs: 90000,
  leaseMs: 90000,
  renewalMs: 20000,
  monitorMs: 1000,
  backgroundMs: 300000,
  backgroundDeadlineMs: 60000,
  backgroundMaximum: 288,
} as const;

export interface CaptureWindow {
  index: number;
  operationId: string;
  dueAt: number;
  deadlineAt: number;
  canonicalMinute: number | null;
  offsetSeconds: 0 | 20 | 40;
}

export type PumpStatus =
  "CAPTURED" | "UNAVAILABLE" | "MISSED_BUSY" | "MISSED_TIMER" | "NOT_OBSERVED_AFTER_STOP";

export interface CaptureScheduleClock {
  now(): number;
  sleepUntil(at: number, signal: AbortSignal): Promise<void>;
}

export const captureScheduleClock: CaptureScheduleClock = {
  now: Date.now,
  async sleepUntil(at, signal) {
    while (Date.now() < at) {
      await wait(Math.min(60000, Math.max(1, at - Date.now())), undefined, { signal });
    }
  },
};

export function freezeSourceWindow(preflightCompletedAt: number) {
  if (!Number.isSafeInteger(preflightCompletedAt) || preflightCompletedAt < 0) {
    throw new PilotError(
      "CLOCK_PROOF_FAILURE",
      "A valid local preflight completion clock is required",
    );
  }
  let startsAt = Math.ceil((preflightCompletedAt + 120000) / 60000) * 60000;
  if (startsAt % 86400000 === 0) {
    startsAt += 60000;
  }
  const endsAt = startsAt + CAPTURE_GRID.durationMs;
  return {
    preflightCompletedAt,
    startsAt,
    endsAt,
    crossesUTCRollover: Math.floor(startsAt / 86400000) !== Math.floor(endsAt / 86400000),
    financialT0: null,
    interpretation: "NONFINANCIAL_SOURCE_WINDOW_ONLY" as const,
    ...CAPTURE_GRID,
  };
}

export function sourceWindowAt(startsAt: number, index: number): CaptureWindow {
  if (!Number.isInteger(index) || index < 0 || index >= CAPTURE_GRID.pumps) {
    throw new PilotError("INVALID_INPUT", "Original source window identity is out of range");
  }
  const dueAt = startsAt + index * CAPTURE_GRID.pumpMs;
  const offsetSeconds = ((index % 3) * 20) as 0 | 20 | 40;
  return {
    index,
    operationId: `source:${dueAt}:${offsetSeconds}`,
    dueAt,
    deadlineAt: dueAt + CAPTURE_GRID.pumpMs,
    canonicalMinute: offsetSeconds === 0 ? index / 3 : null,
    offsetSeconds,
  };
}

/** Timer dispatch never waits for an occupied capture and never shifts an original deadline. */
export async function runSourceWindows<T>(input: {
  startsAt: number;
  signal: AbortSignal;
  capture(window: CaptureWindow, signal: AbortSignal): Promise<T>;
  result(window: CaptureWindow, result: T, completedAt: number): Promise<void>;
  missed(window: CaptureWindow, status: Exclude<PumpStatus, "CAPTURED">): Promise<void>;
  failed(error: unknown, window: CaptureWindow): Promise<void>;
  clock?: CaptureScheduleClock;
  /** Controlled tests may inspect a prefix; actual host never overrides this value. */
  count?: number;
}) {
  const clock = input.clock ?? captureScheduleClock;
  const count = input.count ?? CAPTURE_GRID.pumps;
  if (count < 1 || count > CAPTURE_GRID.pumps) {
    throw new PilotError("INVALID_INPUT", "Invalid original source-window count");
  }
  let active: Promise<void> | undefined;
  let stopped = false;
  let terminalFailure: unknown;
  const wake = new AbortController();
  const timerSignal = AbortSignal.any([input.signal, wake.signal]);
  for (let index = 0; index < count; index++) {
    const window = sourceWindowAt(input.startsAt, index);
    if (!input.signal.aborted) {
      try {
        await clock.sleepUntil(window.dueAt, timerSignal);
      } catch {
        stopped = true;
      }
    }
    if (terminalFailure !== undefined) {
      throw terminalFailure;
    }
    if (input.signal.aborted || stopped) {
      await input.missed(window, "NOT_OBSERVED_AFTER_STOP");
      continue;
    }
    if (clock.now() >= window.deadlineAt) {
      await input.missed(window, "MISSED_TIMER");
      continue;
    }
    if (active) {
      await input.missed(window, "MISSED_BUSY");
      continue;
    }
    active = (async () => {
      try {
        // The reader enforces window.deadlineAt. Its continuous connection must receive the
        // capture lifetime, never a per-window signal aborted after an otherwise valid copy.
        const result = await input.capture(window, input.signal);
        const completedAt = clock.now();
        // Preserve original bytes even when returned late; result qualification owns that fact.
        await input.result(window, result, completedAt);
      } catch (error) {
        await input.failed(error, window);
      }
    })()
      .catch((error) => {
        // A failed diagnostic write must not become an unhandled background rejection while
        // the scheduler sleeps until a later window. Bring it through the awaited host path.
        terminalFailure = error;
        wake.abort(error);
      })
      .finally(() => {
        active = undefined;
      });
  }
  if (!input.signal.aborted) {
    await clock
      .sleepUntil(input.startsAt + count * CAPTURE_GRID.pumpMs, timerSignal)
      .catch(() => {});
  }
  await active;
  if (terminalFailure !== undefined) {
    throw terminalFailure;
  }
}

/** Bounded background preparation runs independently and cannot occupy the price-capture lane. */
export async function runBackgroundPreparation(input: {
  startsAt: number;
  endsAt: number;
  signal: AbortSignal;
  prepare(operationId: string, dueAt: number, deadlineAt: number): Promise<void>;
  missed(operationId: string, dueAt: number, reason: "MISSED_BUSY" | "MISSED_TIMER"): void;
  failed(error: unknown): void;
  clock?: CaptureScheduleClock;
}) {
  const clock = input.clock ?? captureScheduleClock;
  let active: Promise<void> | undefined;
  let rounds = 0;
  try {
    for (let dueAt = input.startsAt; dueAt < input.endsAt; dueAt += CAPTURE_GRID.backgroundMs) {
      if (++rounds > CAPTURE_GRID.backgroundMaximum) {
        throw new PilotError(
          "BREAKOUT_BACKGROUND_LIMIT",
          "Background preparation slot ceiling reached",
        );
      }
      await clock.sleepUntil(dueAt, input.signal);
      input.signal.throwIfAborted();
      const operationId = `preparation:${dueAt}`;
      if (clock.now() >= dueAt + CAPTURE_GRID.backgroundDeadlineMs) {
        input.missed(operationId, dueAt, "MISSED_TIMER");
      } else if (active) {
        input.missed(operationId, dueAt, "MISSED_BUSY");
      } else {
        active = input
          .prepare(operationId, dueAt, dueAt + CAPTURE_GRID.backgroundDeadlineMs)
          .catch(input.failed)
          .finally(() => {
            active = undefined;
          });
      }
    }
  } catch (error) {
    if (!input.signal.aborted) {
      input.failed(error);
    }
  } finally {
    await active;
  }
}
