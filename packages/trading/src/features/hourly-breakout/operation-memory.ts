import { PilotError } from "@pickler/core";
import type { BreakoutDigest } from "./types.js";

export type BreakoutMemoryLookup = "NEW" | "RECENT_EXACT" | "POSSIBLY_OLDER";

/**
 * Fixed-size, conservative tombstones supplement canonical durable operation identities.
 * Eviction never makes a remembered identity new. A collision can only deny new work.
 * The bounded exact cache distinguishes recent duplicates from older/uncertain membership.
 */
export class BreakoutOperationMemory {
  private readonly bits: Uint8Array;
  private readonly recent = new Set<string>();
  private readonly recentLimit: number;

  constructor(
    private readonly digest: BreakoutDigest,
    options: { bytes?: number; recentLimit?: number } = {},
  ) {
    const bytes = options.bytes ?? 8 * 1024 * 1024;
    this.recentLimit = options.recentLimit ?? 128;
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 1 ||
      bytes > 8 * 1024 * 1024 ||
      !Number.isSafeInteger(this.recentLimit) ||
      this.recentLimit < 1 ||
      this.recentLimit > 128
    ) {
      throw new PilotError("INVALID_INPUT", "Bounded operation memory required");
    }
    this.bits = new Uint8Array(bytes);
  }

  private identity(namespace: "operation" | "terminal-attempt", key: string) {
    const hash = this.digest(JSON.stringify(["breakout-operation-memory-v1", namespace, key]));
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      throw new PilotError("INVALID_INPUT", "Stable SHA-256 operation identity required");
    }
    const positions = Array.from(
      { length: 8 },
      (_, index) =>
        Number.parseInt(hash.slice(index * 8, index * 8 + 8), 16) % (this.bits.length * 8),
    );
    return { hash, positions };
  }

  lookup(namespace: "operation" | "terminal-attempt", key: string): BreakoutMemoryLookup {
    const { hash, positions } = this.identity(namespace, key);
    if (this.recent.has(hash)) {
      return "RECENT_EXACT";
    }
    return positions.every((bit) => (this.bits[Math.floor(bit / 8)]! & (1 << (bit % 8))) !== 0)
      ? "POSSIBLY_OLDER"
      : "NEW";
  }

  remember(namespace: "operation" | "terminal-attempt", key: string): void {
    const { hash, positions } = this.identity(namespace, key);
    for (const bit of positions) {
      this.bits[Math.floor(bit / 8)]! |= 1 << (bit % 8);
    }
    this.recent.add(hash);
    while (this.recent.size > this.recentLimit) {
      this.recent.delete(this.recent.values().next().value!);
    }
  }

  get size() {
    return { tombstoneBytes: this.bits.byteLength, exactIdentities: this.recent.size };
  }
}
