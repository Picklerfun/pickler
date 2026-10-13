/** A same-origin API clock anchored to monotonic time, independent of wall-clock changes. */
export class ServerClock {
  private anchor: { server: number; monotonic: number } | null = null;

  constructor(
    private readonly wallNow: () => number = Date.now,
    private readonly monotonicNow: () => number = () => performance.now(),
  ) {}

  get synchronized() {
    return this.anchor !== null;
  }

  observe(serverTimeMs: number, started: number, received = this.monotonicNow()) {
    const elapsed = received - started;
    if (
      !Number.isSafeInteger(serverTimeMs) ||
      serverTimeMs <= 0 ||
      elapsed < 0 ||
      elapsed > 15_000
    ) {
      return;
    }
    this.anchor = { server: serverTimeMs + elapsed / 2, monotonic: received };
  }

  now() {
    if (!this.anchor) {
      return this.wallNow();
    }
    return Math.floor(
      this.anchor.server + Math.max(0, this.monotonicNow() - this.anchor.monotonic),
    );
  }
}

export const apiClock = new ServerClock();
