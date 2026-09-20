import test from "node:test";
import assert from "node:assert/strict";
import { PilotError, PersistenceFailure } from "@pickler/core";
import { eventFailure } from "../src/persistence/event-failure.js";

test("event errors retain safe categories without SQL, values, messages or causes", () => {
  const wrapped = new Error("SQL and secret parameters", {
    cause: new Error("Connection terminated unexpectedly"),
  });
  const failure = eventFailure(wrapped, "candidates") as PersistenceFailure;
  assert.equal(failure.code, "PERSISTENCE_FAILURE");
  assert.deepEqual(failure.details, {
    operation: "event",
    eventType: "candidates",
    reason: "CONNECTION_LOST",
  });
  assert.equal(failure.cause, undefined);
  assert.ok(!JSON.stringify(failure).includes("secret"));
  const timeout = Object.assign(new Error("sensitive value"), { code: "57014" });
  assert.equal(
    (eventFailure(timeout, "sources") as PersistenceFailure).details.reason,
    "QUERY_TIMEOUT",
  );
  assert.equal(
    (eventFailure(new Error("sensitive value"), "sources") as PersistenceFailure).details.reason,
    "DATABASE_ERROR",
  );
  for (const code of ["LEASE_LOST", "CONFIG_CHANGED", "RESEARCH_ACCESS_DENIED"]) {
    const original = new PilotError(code, "Denied");
    assert.equal(eventFailure(original, "sources"), original);
  }
});
