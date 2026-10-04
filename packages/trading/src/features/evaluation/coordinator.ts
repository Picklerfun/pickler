import { BENCHMARK_VARIANTS } from "../paper-study/benchmark.js";
import { PERPS_FOUR_WAY_STRATEGIES, PERPS_STUDY_STRATEGIES } from "../perps-study/types.js";
import { PilotError } from "@pickler/core";
export const EVALUATION_PROTOCOLS = {
  "perps-multiframe-v3": {
    version: 2,
    instrument: "perpetual",
    strategySetVersion: 2,
    strategies: PERPS_FOUR_WAY_STRATEGIES,
    commands: [
      "prepare",
      "preflight",
      "validate",
      "run",
      "status",
      "stop",
      "settle",
      "report",
      "audit-export",
    ],
    paidCommands: ["validate", "run"],
    riskPolicy: "conservative-1x-v1",
    accounting: "acknowledged-historical-reservations-v2",
  },
  "perps-four-way-v2": {
    version: 2,
    instrument: "perpetual",
    strategySetVersion: 2,
    strategies: PERPS_FOUR_WAY_STRATEGIES,
    commands: [
      "prepare",
      "preflight",
      "validate",
      "run",
      "status",
      "stop",
      "settle",
      "report",
      "audit-export",
    ],
    paidCommands: ["validate", "run"],
    riskPolicy: "conservative-1x-v1",
    accounting: "acknowledged-historical-reservations-v2",
  },
  "perps-comparison-v1": {
    version: 1,
    instrument: "perpetual",
    strategySetVersion: 1,
    strategies: PERPS_STUDY_STRATEGIES,
    commands: [
      "audit-export",
      "stability",
      "data-diagnostic",
      "prepare",
      "preflight",
      "run",
      "resume",
      "status",
      "stop",
      "settle",
      "report",
    ],
    paidCommands: ["run", "resume"],
    riskPolicy: "conservative-1x-v1",
    accounting: "release-known-reservation-v1",
  },
  "btc-decision-benchmark-v1": {
    version: 4,
    instrument: "binary",
    strategySetVersion: 1,
    strategies: BENCHMARK_VARIANTS,
    commands: [
      "prepare",
      "preflight",
      "validate",
      "run",
      "status",
      "stop",
      "settle",
      "report",
      "compare",
    ],
    paidCommands: ["validate", "run"],
    riskPolicy: "binary-edge-above-3pct-v1",
    accounting: "retain-all-reservations-v1",
  },
  "paper-study-v1": {
    version: 1,
    instrument: "binary",
    strategySetVersion: 1,
    strategies: [],
    commands: ["status", "report"],
    paidCommands: [],
    riskPolicy: "historical-only",
    accounting: "preserve-historical-v1",
  },
  "btc-quant-jev-v1": {
    version: 2,
    instrument: "binary",
    strategySetVersion: 1,
    strategies: [],
    commands: ["status", "report", "settle", "history", "replay"],
    paidCommands: [],
    riskPolicy: "historical-only",
    accounting: "preserve-historical-v2",
  },
  "btc-policy-comparison-v1": {
    version: 3,
    instrument: "binary",
    strategySetVersion: 1,
    strategies: [],
    commands: ["status", "report", "settle"],
    paidCommands: [],
    riskPolicy: "historical-only",
    accounting: "preserve-historical-v3",
  },
} as const;
export type EvaluationProtocol = keyof typeof EVALUATION_PROTOCOLS;
export type EvaluationCommand =
  | "audit"
  | "audit-export"
  | "stability"
  | "data-diagnostic"
  | "prepare"
  | "preflight"
  | "validate"
  | "run"
  | "resume"
  | "status"
  | "stop"
  | "settle"
  | "report"
  | "history"
  | "replay"
  | "compare";
export interface EvaluationConfiguration {
  protocol: EvaluationProtocol;
  version: number;
}
export interface EvaluationRequest {
  command: EvaluationCommand;
  configuration: EvaluationConfiguration;
  allowPaid: boolean;
  signal: AbortSignal;
}
export interface EvaluationAdapter<Result = unknown> {
  execute(request: EvaluationRequest): Promise<Result>;
}
/** The same admission and protocol dispatch are used by CLI and any future trusted host. */
export function createEvaluationCoordinator<Result>(
  adapters: Partial<Record<EvaluationProtocol, EvaluationAdapter<Result>>>,
) {
  return {
    async execute(request: EvaluationRequest): Promise<Result> {
      request.signal.throwIfAborted();
      const definition = Object.hasOwn(EVALUATION_PROTOCOLS, request.configuration.protocol)
        ? EVALUATION_PROTOCOLS[request.configuration.protocol]
        : undefined;
      if (!definition || request.configuration.version !== definition.version) {
        throw new PilotError(
          "EVALUATION_PROTOCOL_INVALID",
          "Unsupported frozen evaluation protocol/version",
        );
      }
      if (!(definition.commands as readonly string[]).includes(request.command)) {
        throw new PilotError("EVALUATION_COMMAND_INVALID", "Command unsupported by this protocol");
      }
      if (
        (definition.paidCommands as readonly string[]).includes(request.command) &&
        !request.allowPaid
      ) {
        throw new PilotError(
          "PAID_OPT_IN_REQUIRED",
          "Explicit paid evaluation authorization required",
        );
      }
      const adapter = adapters[request.configuration.protocol];
      if (!adapter) {
        throw new PilotError("EVALUATION_ADAPTER_MISSING", "Protocol adapter unavailable");
      }
      return adapter.execute(request);
    },
  };
}
