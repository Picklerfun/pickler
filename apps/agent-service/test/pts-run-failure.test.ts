import assert from "node:assert/strict";
import test from "node:test";
import { PilotError } from "@pickler/core";
import { ptsRunFailure } from "../src/pts-study/run-failure.js";

test("a fetch abort retains the specific PostgreSQL failure that cancelled PTS", () => {
  const controller = new AbortController();
  const primary = new PilotError("PERSISTENCE_CONNECTION_FAILED", "Controlled database loss");
  controller.abort(primary);
  const transport = new DOMException("private transport body", "AbortError");

  const observed = ptsRunFailure(transport, controller.signal);

  assert.equal(observed, primary);
  assert.equal((observed as PilotError).code, "PERSISTENCE_CONNECTION_FAILED");
  assert.equal(JSON.stringify(observed).includes("private transport"), false);
});

test("Node abort wrappers preserve an ownership failure rather than a generic operation error", () => {
  const controller = new AbortController();
  const primary = new PilotError("LEASE_LOST", "Controlled ownership loss");
  controller.abort(primary);
  const transport = Object.assign(new Error("private abort detail"), { code: "ABORT_ERR" });

  assert.equal(ptsRunFailure(transport, controller.signal), primary);
});

test("known report failures remain the cause of a later cancelled public request", () => {
  const controller = new AbortController();
  const primary = new PilotError("PTS_REPORT_SOURCE_INVALID", "Controlled report failure");
  controller.abort(primary);

  assert.equal(
    ptsRunFailure(new DOMException("cancelled", "AbortError"), controller.signal),
    primary,
  );
});

test("an unrelated typed failure is never replaced by a coincident abort reason", () => {
  const controller = new AbortController();
  controller.abort(new PilotError("PERSISTENCE_CONNECTION_FAILED", "Controlled database loss"));
  const primary = new PilotError("INVALID_MARKET_DATA", "Controlled data rejection");

  assert.equal(ptsRunFailure(primary, controller.signal), primary);
});

test("unrelated programmer errors remain unchanged even when a scope is cancelled", () => {
  const controller = new AbortController();
  controller.abort(new PilotError("PERSISTENCE_CONNECTION_FAILED", "Controlled database loss"));
  const primary = new TypeError("controlled unrelated error");

  assert.equal(ptsRunFailure(primary, controller.signal), primary);
});

test("an abort without a known typed cause cannot fabricate a persistence diagnosis", () => {
  const controller = new AbortController();
  controller.abort(new Error("private unknown cancellation"));
  const primary = new DOMException("cancelled", "AbortError");

  assert.equal(ptsRunFailure(primary, controller.signal), primary);
});
