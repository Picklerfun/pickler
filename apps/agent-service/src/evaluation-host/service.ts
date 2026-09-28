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
import { runPerpsStudy } from "../perps-study/host.js";
import { runBtcBenchmark, benchmarkConfigSchema } from "../paper-study/benchmark-host.js";
const appRoot = fileURLToPath(new URL("../../", import.meta.url));
export interface EvaluationHostRequest {
  command: EvaluationCommand;
  configPath: string;
  allowPaid?: boolean;
  envFile?: string;
  output?: string;
  signal?: AbortSignal;
}
/** Public application service: no process.argv, chdir, or alternate provider/strategy implementation. */
export async function executeEvaluation(input: EvaluationHostRequest) {
  const path = resolve(input.configPath);
  const raw = JSON.parse(await readFile(path, "utf8")) as {
    protocol: EvaluationProtocol;
    version: number;
  };
  const signal = input.signal ?? new AbortController().signal;
  const coordinator = createEvaluationCoordinator({
    "perps-comparison-v1": {
      async execute(request) {
        const command =
          request.command === "prepare"
            ? "init"
            : request.command === "status"
              ? "report"
              : request.command;
        const args = [command, "--config", path];
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
        const config = benchmarkConfigSchema.parse(raw);
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
  if (input.output && raw.protocol !== "perps-comparison-v1") {
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
