/**
 * A save that waits for the changes to stop, and is never dropped by leaving.
 *
 * `schedule` replaces whatever was waiting, so a run of changes is one save of the last value.
 * `flush` saves what is waiting now: a screen that showed the new value the moment it was chosen
 * and then cancelled the save on its way out would leave the stored value behind what it showed.
 * Pure over its timers, and pinned in `studio-pending-save.test.ts`.
 */

export interface Timers {
  set(run: () => void, delayMs: number): unknown;
  clear(id: unknown): void;
}

const REAL: Timers = {
  set: (run, delayMs) => setTimeout(run, delayMs),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export function pendingSave<T>(delayMs: number, save: (value: T) => void, timers: Timers = REAL) {
  let waiting: { id: unknown; value: T } | null = null;

  function flush() {
    if (!waiting) {
      return;
    }
    const { id, value } = waiting;
    waiting = null;
    timers.clear(id);
    save(value);
  }

  return {
    schedule(value: T) {
      if (waiting) {
        timers.clear(waiting.id);
      }
      waiting = { id: timers.set(flush, delayMs), value };
    },
    flush,
  };
}
