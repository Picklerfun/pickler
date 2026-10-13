export interface PtsLoopSample {
  version: 1;
  at: number;
  elapsedMs: number;
  timerLatenessMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  rssBytes: number;
}

/** Passive host scheduling evidence, separate from market/financial clocks and deadlines. */
export function startPtsLoopDiagnostic(intervalMs = 1000) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 10) {
    throw new Error("Invalid diagnostic interval");
  }
  let previous = performance.now();
  let previousCpu = process.cpuUsage();
  let due = previous + intervalMs;
  let discarded = 0;
  let stopped = false;
  let largest: PtsLoopSample | null = null;
  let stoppedAt: PtsLoopSample | null = null;
  const samples: PtsLoopSample[] = [];
  const limit = 64;
  const sample = (): PtsLoopSample => {
    const current = performance.now();
    const cpu = process.cpuUsage(previousCpu);
    return {
      version: 1,
      at: Date.now(),
      elapsedMs: Math.max(0, current - previous),
      timerLatenessMs: Math.max(0, current - due),
      cpuUserMs: cpu.user / 1000,
      cpuSystemMs: cpu.system / 1000,
      rssBytes: process.memoryUsage().rss,
    };
  };
  const tick = () => {
    if (stopped) {
      return;
    }
    const value = sample();
    samples.push(value);
    if (samples.length > limit) {
      samples.shift();
      discarded++;
    }
    if (!largest || value.timerLatenessMs > largest.timerLatenessMs) {
      largest = value;
    }
    previous = performance.now();
    previousCpu = process.cpuUsage();
    due = previous + intervalMs;
    timer = setTimeout(tick, intervalMs);
    timer.unref();
  };
  let timer = setTimeout(tick, intervalMs);
  timer.unref();
  return {
    snapshot() {
      return {
        version: 1 as const,
        intervalMs,
        limit,
        discarded,
        truncated: discarded > 0,
        samples: samples.map((value) => ({ ...value })),
        largest: largest ? { ...largest } : null,
        current: stoppedAt ? { ...stoppedAt } : sample(),
      };
    },
    stop() {
      if (stopped) {
        return;
      }
      stoppedAt = sample();
      stopped = true;
      clearTimeout(timer);
    },
  };
}
