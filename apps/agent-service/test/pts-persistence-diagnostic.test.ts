import assert from "node:assert/strict";
import test from "node:test";
import type {
  PerpsLabQueryDiagnostic,
  PerpsLabConnectionDiagnostic,
} from "@pickler/infrastructure/perps-lab";
import { createPtsPersistenceDiagnostic } from "../src/pts-study/persistence-diagnostic.js";

function query(
  queryId: number,
  phase: "started" | "finished",
  code: string | null = null,
): PerpsLabQueryDiagnostic {
  return {
    version: 1,
    queryId,
    phase,
    operation: "client-query",
    statement: "SELECT",
    sqlHash: "a".repeat(64),
    backendPid: 123,
    at: queryId,
    durationMs: phase === "finished" ? 10 : null,
    code,
    driverCode: code ? "57014" : null,
  };
}
test("query diagnostics retain the first failure, bound completed and pending work, and expose truncation", () => {
  const collector = createPtsPersistenceDiagnostic();
  for (let i = 1; i <= 200; i++) {
    collector.observe(query(i, "started"));
    collector.observe(
      query(i, "finished", i === 1 || i === 2 ? "PERSISTENCE_QUERY_TIMEOUT" : null),
    );
  }
  for (let i = 201; i <= 220; i++) {
    collector.observe(query(i, "started"));
  }
  const snapshot = collector.snapshot();

  assert.equal(snapshot.started, 220);
  assert.equal(snapshot.finished, 200);
  assert.equal(snapshot.completed.length, 128);
  assert.equal(snapshot.active.length, 16);
  assert.equal(snapshot.discardedCompleted, 72);
  assert.equal(snapshot.untrackedActive, 4);
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.firstFailure!.queryId, 1);
  assert.equal(collector.failure()!.queryId, 1);
  snapshot.firstFailure!.code = "modified";
  snapshot.completed[0]!.statement = "modified";
  snapshot.active[0]!.statement = "modified";
  assert.equal(collector.failure()!.code, "PERSISTENCE_QUERY_TIMEOUT");
  assert.equal(collector.snapshot().completed[0]!.statement, "SELECT");
  assert.equal(collector.snapshot().active[0]!.statement, "SELECT");
});
test("successful completion clears pending evidence without manufacturing a persistence failure", () => {
  const collector = createPtsPersistenceDiagnostic();
  const first = query(1, "started");
  collector.observe(first);
  first.sqlHash = "modified";
  assert.equal(collector.snapshot().active[0]!.sqlHash, "a".repeat(64));
  collector.observe(query(1, "finished"));

  assert.equal(collector.failure(), null);
  assert.deepEqual(collector.snapshot().active, []);
  assert.equal(collector.snapshot().truncated, false);
});

test("connection phases are bounded and cloned separately from the first query failure", () => {
  const collector = createPtsPersistenceDiagnostic();
  for (let i = 0; i < 100; i++) {
    const value: PerpsLabConnectionDiagnostic = {
      version: 1,
      connectionId: i,
      workload: "execution",
      phase: "protocol-ready",
      at: i,
      elapsedMs: i,
      backendPid: 123,
      driverCode: null,
    };
    collector.connection(value);
    value.backendPid = 999;
  }
  collector.observe(query(1, "finished", "PERSISTENCE_CONNECTION_TIMEOUT"));
  const snapshot = collector.snapshot();
  assert.equal(snapshot.limits.connections, 64);
  assert.equal(snapshot.connections.length, 64);
  assert.equal(snapshot.discardedConnections, 36);
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.connections[0]!.backendPid, 123);
  snapshot.connections[0]!.backendPid = 998;
  assert.equal(collector.snapshot().connections[0]!.backendPid, 123);
  assert.equal(collector.failure()!.code, "PERSISTENCE_CONNECTION_TIMEOUT");
});
