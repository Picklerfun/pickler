import { PilotError } from "@pickler/core";
import {
  runBenchmarkCase,
  type BenchmarkState,
  type BenchmarkPorts,
} from "../paper-study/benchmark.js";
import { markMissedSlots, type ComparisonState } from "../paper-study/comparison.js";
import type { StudyMarket, StudyKind } from "../paper-study/study.js";
export interface BenchmarkLoopPorts {
  ports: BenchmarkPorts;
  signal: AbortSignal;
  discover(kind: StudyKind, signal: AbortSignal): Promise<StudyMarket[]>;
  guard(plugin: "polymarket"): Promise<void>;
  save(): Promise<void>;
  settle(): Promise<void>;
  stopped(): boolean;
  admissionEnded(): void;
  now(): number;
  sleep(ms: number): Promise<void>;
}
/** Prospective scheduling is shared; hosts supply IO, time and cancellation. */
export async function runBenchmarkLoop(state: BenchmarkState, deps: BenchmarkLoopPorts) {
  deps.signal.throwIfAborted();
  const clock = deps.now;
  let stopping = false;
  const active = new Set<Promise<void>>();
  let previousTick = clock();
  let lastReportAt = 0;
  let settlementTask: Promise<void> | undefined;
  try {
    while (
      !stopping &&
      !deps.signal.aborted &&
      !deps.stopped() &&
      clock() < state.settlementDeadline!
    ) {
      await deps.guard("polymarket");
      const now = clock();
      if (now - previousTick > 15000) {
        state.interruptions.push({ at: now, gapMs: now - previousTick });
      }
      previousTick = now;
      markMissedSlots({ slots: state.slots } as ComparisonState, now);
      if (now >= state.deadline!) {
        deps.admissionEnded();
      }
      for (const slot of state.slots.filter(
        (s) =>
          s.status === "pending" &&
          now >= s.start + 60000 &&
          now <= s.start + 90000 &&
          now < state.deadline!,
      )) {
        if (active.size >= 2) {
          break;
        }
        slot.status = "started";
        await deps.save();
        const task = (async () => {
          try {
            const items = await deps.discover(
              slot.kind,
              AbortSignal.any([deps.signal, AbortSignal.timeout(30000)]),
            );
            const item = items.find((i) => i.windowStart === slot.start);
            if (!item) {
              slot.status = "failed";
              slot.reason = "NO_ELIGIBLE_MARKET";
              return;
            }
            slot.marketId = item.market.id;
            await runBenchmarkCase(state, item, deps.ports);
            const row = state.cases.find((r) => r.marketId === item.market.id);
            slot.status = row?.status === "completed" ? "evaluated" : "failed";
            if (row?.reason) {
              slot.reason = row.reason;
            }
          } catch (e) {
            slot.status = "failed";
            slot.reason = e instanceof PilotError ? e.code : "DISCOVERY_FAILED";
          } finally {
            await deps.save();
          }
        })();
        active.add(task);
        void task.then(
          () => active.delete(task),
          () => {
            stopping = true;
            active.delete(task);
          },
        );
      }
      // Resolution cannot block admission of coincident windows.
      if (!settlementTask) {
        settlementTask = deps.settle();
        void settlementTask.then(
          () => {
            settlementTask = undefined;
          },
          () => {
            stopping = true;
            settlementTask = undefined;
          },
        );
      }
      if (now - lastReportAt >= 10000) {
        await deps.save();
        lastReportAt = now;
      }
      if (
        now >= state.deadline! &&
        active.size === 0 &&
        !state.cases.some((r) => r.forecast && r.resolutions.length < (r.identities?.length ?? 0))
      ) {
        break;
      }
      await deps.sleep(1000);
    }
  } finally {
    stopping = true;
    await Promise.allSettled([...active, ...(settlementTask ? [settlementTask] : [])]);
  }
}
