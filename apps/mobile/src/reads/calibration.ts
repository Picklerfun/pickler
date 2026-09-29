// Perfil de agente (spec mobile-light D16): calibración y récord con TUS reads de ese agente (máx. 50 de reads-list). Puro.
import type { Read } from "./types";

export const CALIBRATION_MIN = 5;
const N = 5;

export type Bucket = { lo: number; hi: number; promised: number; actual: number | null; n: number };

const isResolved = (r: Read): boolean => (r.status === "right" || r.status === "wrong") && r.probability !== null && r.outcome !== null;

export function calibration(reads: readonly Read[]): Bucket[] | null {
  const done = reads.filter(isResolved);
  if (done.length < CALIBRATION_MIN) return null;
  return Array.from({ length: N }, (_, i) => {
    const lo = i / N, hi = (i + 1) / N;
    const inB = done.filter((r) => r.probability! >= lo && (r.probability! < hi || (i === N - 1 && r.probability! <= 1)));
    const yes = inB.filter((r) => r.outcome === true).length;
    return { lo, hi, promised: (2 * i + 1) / (2 * N), actual: inB.length === 0 ? null : yes / inB.length, n: inB.length };
  });
}

export type RecordFilter = "all" | "right" | "wrong" | "open";

export function recordFor(reads: readonly Read[] | null, agentId: string, filter: RecordFilter): Read[] | null {
  if (reads === null) return null;
  const mine = reads.filter((r) => r.agentId === agentId);
  return filter === "all" ? mine : mine.filter((r) => r.status === filter);
}
