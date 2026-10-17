import type {
  PerpsLabQueryDiagnostic,
  PerpsLabConnectionDiagnostic,
} from "@pickler/infrastructure/perps-lab";

/** Bounded process evidence only; never a financial record or an ownership grant. */
export function createPtsPersistenceDiagnostic() {
  const completedLimit = 128;
  const connectionLimit = 64;
  const connections: PerpsLabConnectionDiagnostic[] = [];
  let discardedConnections = 0;
  const activeLimit = 16;
  const active = new Map<number, PerpsLabQueryDiagnostic>();
  const completed: PerpsLabQueryDiagnostic[] = [];
  let started = 0;
  let finished = 0;
  let discardedCompleted = 0;
  let untrackedActive = 0;
  let firstFailure: PerpsLabQueryDiagnostic | null = null;
  return {
    connection(value: PerpsLabConnectionDiagnostic) {
      connections.push({ ...value });
      if (connections.length > connectionLimit) {
        connections.shift();
        discardedConnections++;
      }
    },
    observe(value: PerpsLabQueryDiagnostic) {
      const retained = { ...value };
      if (retained.phase === "started") {
        started++;
        if (active.size < activeLimit) {
          active.set(retained.queryId, retained);
        } else {
          untrackedActive++;
        }
        return;
      }
      finished++;
      active.delete(retained.queryId);
      if (retained.code !== null && firstFailure === null) {
        firstFailure = retained;
      }
      completed.push(retained);
      if (completed.length > completedLimit) {
        completed.shift();
        discardedCompleted++;
      }
    },
    failure() {
      return firstFailure ? { ...firstFailure } : null;
    },
    snapshot() {
      return {
        version: 1 as const,
        started,
        finished,
        limits: { completed: completedLimit, active: activeLimit, connections: connectionLimit },
        discardedCompleted,
        untrackedActive,
        discardedConnections,
        truncated: discardedCompleted > 0 || untrackedActive > 0 || discardedConnections > 0,
        firstFailure: firstFailure ? { ...firstFailure } : null,
        active: [...active.values()].map((value) => ({ ...value })),
        completed: completed.map((value) => ({ ...value })),
        connections: connections.map((value) => ({ ...value })),
      };
    },
  };
}
