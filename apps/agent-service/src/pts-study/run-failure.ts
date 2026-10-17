import { PilotError } from "@pickler/core";

/** A transport's abort wrapper must retain the known reason that stopped this scope. */
export function ptsRunFailure(error: unknown, signal: AbortSignal): unknown {
  if (error instanceof PilotError) {
    return error;
  }
  if (
    error instanceof Error &&
    (error.name === "AbortError" || Reflect.get(error, "code") === "ABORT_ERR") &&
    signal.aborted &&
    signal.reason instanceof PilotError
  ) {
    return signal.reason;
  }
  return error;
}
