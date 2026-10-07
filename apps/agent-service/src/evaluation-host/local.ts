import { runHistoricalEvaluation } from "./history.js";
import { compareBenchmarkStudies } from "../paper-study/benchmark-report.js";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEvaluationCoordinator,
  EVALUATION_PROTOCOLS,
  type EvaluationCommand,
  type EvaluationProtocol,
} from "@pickler/trading/evaluation";
import { PilotError } from "@pickler/core";

const appRoot = fileURLToPath(new URL("../../", import.meta.url));
export interface EvaluationHostRequest {
  command: EvaluationCommand;
  configPath: string;
  allowPaid?: boolean;
  envFile?: string;
  output?: string;
  acquisitionChoice?: string;
  signal?: AbortSignal;
  states?: string[];
}
/** Public application service: no process.argv, chdir, or alternate provider/strategy implementation. */
export async function executeEvaluation(input: EvaluationHostRequest) {
  if (input.command === "audit-export") {
    const { runPerpsAudit } = await import("../perps-study/audit.js");
    return runPerpsAudit({
      command: "audit-export",
      configPath: input.configPath,
      envFile: input.envFile,
      output: input.output,
      allowPaid: input.allowPaid,
    });
  }
  const path = resolve(input.configPath);
  const raw = JSON.parse(await readFile(path, "utf8")) as {
    protocol: EvaluationProtocol;
    version: number;
  };
  const originalConfiguration = JSON.stringify(raw);
  if (raw.version === 1 && !raw.protocol) {
    raw.protocol = "paper-study-v1";
  }
  const signal = input.signal ?? new AbortController().signal;
  const historical = {
    execute: async (request: import("@pickler/trading/evaluation").EvaluationRequest) =>
      runHistoricalEvaluation(
        request.command,
        raw.protocol === "paper-study-v1"
          ? Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "protocol"))
          : raw,
        join(appRoot, ".data/paper-studies"),
        signal,
        async () => {
          if (JSON.stringify(JSON.parse(await readFile(path, "utf8"))) !== originalConfiguration) {
            throw new PilotError("CONFIG_CHANGED", "Frozen historical configuration changed");
          }
        },
      ),
  };
  const coordinator = createEvaluationCoordinator({
    "paper-study-v1": historical,
    "btc-quant-jev-v1": historical,
    "btc-policy-comparison-v1": historical,
    "perps-comparison-v1": {
      async execute(request) {
        if (request.command === "stability" || request.command === "data-diagnostic") {
          const { runPerpsStability } = await import("../perps-study/stability.js");
          return runPerpsStability(
            { ...input, diagnostic: request.command === "data-diagnostic" },
            signal,
          );
        }
        const { runPerpsStudy } = await import("../perps-study/host.js");
        const command =
          request.command === "prepare"
            ? "init"
            : request.command === "status"
              ? "report"
              : request.command;
        const args = [command, "--config", path];
        if (input.acquisitionChoice) {
          args.push("--acquisition-choice", resolve(input.acquisitionChoice));
        }
        if (input.envFile) {
          args.push("--env-file", resolve(input.envFile));
        }
        if (input.output) {
          args.push("--output", resolve(input.output));
        }
        if (request.allowPaid) {
          args.push("--allow-paid");
        }
        return runPerpsStudy(args, signal);
      },
    },
    "perps-sma-jev-exa-v1": {
      async execute(request) {
        const { runSmaReview } = await import("../perps-study/sma-review.js");
        return runSmaReview({ ...input, command: request.command, configPath: path }, signal);
      },
    },
    "perps-original-sma-v1": {
      async execute(request) {
        const { runOriginalSma } = await import("../perps-study/original-sma.js");
        return runOriginalSma({ ...input, command: request.command, configPath: path }, signal);
      },
    },
    "perps-four-way-v2": {
      async execute(request) {
        if (request.command === "stability" || request.command === "data-diagnostic") {
          const { runPerpsStability } = await import("../perps-study/stability.js");
          return runPerpsStability(
            { ...input, diagnostic: request.command === "data-diagnostic" },
            signal,
          );
        }
        const { runPerpsStudy } = await import("../perps-study/host.js");
        const command =
          request.command === "prepare"
            ? "init"
            : request.command === "status"
              ? "report"
              : request.command;
        const args = [command, "--config", path];
        if (input.acquisitionChoice) {
          args.push("--acquisition-choice", resolve(input.acquisitionChoice));
        }
        if (input.envFile) {
          args.push("--env-file", resolve(input.envFile));
        }
        if (input.output) {
          args.push("--output", resolve(input.output));
        }
        if (request.allowPaid) {
          args.push("--allow-paid");
        }
        return runPerpsStudy(args, signal);
      },
    },
    "btc-decision-benchmark-v1": {
      async execute(request) {
        const { runBtcBenchmark, benchmarkConfigSchema } =
          await import("../paper-study/benchmark-host.js");
        const config = benchmarkConfigSchema.parse(raw);
        if (request.command === "compare") {
          if (!input.output || !input.states?.length) {
            throw new PilotError("INVALID_INPUT", "compare requires --output and --state paths");
          }
          console.log(
            await compareBenchmarkStudies(
              resolve(input.output),
              input.states.map((path) => resolve(path)),
            ),
          );
          return;
        }
        const root = join(appRoot, ".data/paper-studies");
        const directory = join(root, config.id);
        if (request.command === "preflight") {
          console.log(
            JSON.stringify({
              protocol: config.protocol,
              strategies: EVALUATION_PROTOCOLS[config.protocol].strategies,
              configurationValid: true,
              paidCalls: 0,
              providerConnectivity: "not-measured",
            }),
          );
          return;
        }
        if (request.command === "stop") {
          // Existing directory only; never initializes a campaign or removes a previous stop.
          await readFile(join(directory, "state.json"), "utf8");
          await writeFile(join(directory, "STOP"), "OPERATOR_PAUSE_FOR_UNIFICATION\n", {
            flag: "wx",
            mode: 0o600,
          }).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "EEXIST") {
              throw error;
            }
          });
          console.log("Evaluation stop recorded; existing results and reservations retained.");
          return;
        }
        const command =
          request.command === "validate"
            ? "evaluate"
            : request.command === "status"
              ? "report"
              : request.command;
        const args = [command, path];
        if (request.allowPaid) {
          args.push("--allow-paid");
        }
        return runBtcBenchmark(args, {
          signal,
          root,
          envFile: input.envFile ? resolve(input.envFile) : join(appRoot, ".env"),
        });
      },
    },
  });
  if (input.output && !raw.protocol.startsWith("perps-") && input.command !== "compare") {
    throw new PilotError(
      "INVALID_INPUT",
      "BTC reports remain in their immutable session directory",
    );
  }
  return coordinator.execute({
    command: input.command,
    configuration: raw,
    allowPaid: input.allowPaid ?? false,
    signal,
  });
}
