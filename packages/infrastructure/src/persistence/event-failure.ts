import { PersistenceFailure, PilotError } from "@pickler/core";

/** Never expose driver messages: Drizzle errors may contain SQL, parameters and credentials. */
export function eventFailure(error: unknown, eventType: string): PilotError {
  if (error instanceof PilotError) {
    return error;
  }
  let reason: PersistenceFailure["details"]["reason"] = "DATABASE_ERROR";
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    const code = Reflect.get(current, "code");
    if (
      ["ECONNRESET", "EPIPE", "08003", "08006", "57P01"].includes(code) ||
      ["Connection terminated unexpectedly", "Network connection lost."].includes(current.message)
    ) {
      reason = "CONNECTION_LOST";
      break;
    }
    if (code === "57014" || code === "ETIMEDOUT") {
      reason = "QUERY_TIMEOUT";
    }
    current = current.cause;
  }
  return new PersistenceFailure({ operation: "event", eventType, reason });
}
