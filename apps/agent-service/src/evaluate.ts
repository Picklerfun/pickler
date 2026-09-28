import { parseArgs } from "node:util";
import { PilotError } from "@pickler/core";
import { type EvaluationCommand } from "@pickler/trading/evaluation";
import { executeEvaluation } from "./evaluation-host/service.js";
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string" },
    "allow-paid": { type: "boolean" },
    "env-file": { type: "string" },
    output: { type: "string" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    "evaluate prepare|preflight|validate|run|resume|status|stop|settle|report --config FILE [--env-file FILE] [--allow-paid] [--output DIRECTORY]\nSingle evaluation entry point; protocol comes from the frozen config. No automatic paid restart or migration.",
  );
} else {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    if (positionals.length !== 1 || !values.config) {
      throw new PilotError("INVALID_INPUT", "One command and --config required");
    }
    await executeEvaluation({
      command: positionals[0] as EvaluationCommand,
      configPath: values.config,
      allowPaid: values["allow-paid"] ?? false,
      ...(values["env-file"] ? { envFile: values["env-file"] } : {}),
      ...(values.output ? { output: values.output } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    console.error(
      error instanceof PilotError
        ? `${error.code}: ${error.message}`
        : "EVALUATION_FAILED: inspect frozen configuration and preserved diagnostics; no automatic retry",
    );
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
