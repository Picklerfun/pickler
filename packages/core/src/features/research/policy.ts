import { hasMarketSelection } from "./market-scope.js";
import { PilotError, type AgentRecord, type ScheduleReadiness } from "./types.js";
export function assertCanQueue(agent: AgentRecord, recentRuns: number): void {
  if (agent.paused) {
    throw new PilotError("PAUSED", "Agent is paused");
  }
  if (!hasMarketSelection(agent.config)) {
    throw new PilotError("CATEGORIES_REQUIRED", "Select permitted categories");
  }
  if (recentRuns >= agent.config.limits.dailyRuns) {
    throw new PilotError("QUOTA", "Rolling 24-hour investigation quota reached");
  }
}

/** The predicate behind NOT_READY: connections validated and one completed manual run. */
export function isReadyToSchedule(agent: AgentRecord, readiness: ScheduleReadiness): boolean {
  return (
    readiness.connectionsChecked &&
    readiness.manualSucceeded &&
    !agent.paused &&
    (agent.config.perpl ? agent.config.perpl.markets.length > 0 : hasMarketSelection(agent.config))
  );
}

export function assertCanSchedule(
  agent: AgentRecord,
  connectionsChecked: boolean,
  manualSucceeded: boolean,
): void {
  if (!isReadyToSchedule(agent, { connectionsChecked, manualSucceeded })) {
    throw new PilotError(
      "NOT_READY",
      "Validate connections and complete manual research for this configuration first",
    );
  }
}

export function nextOccurrence(agent: AgentRecord, now: number): number {
  return now + agent.config.intervalHours * 3_600_000;
}

export function decimalPrice(value: string): bigint {
  if (!/^(0(\.\d{1,8})?|1(\.0{1,8})?)$/.test(value)) {
    throw new PilotError("INVALID_DECISION", "Invalid fractional price");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 100_000_000n + BigInt(fraction.padEnd(8, "0"));
}
