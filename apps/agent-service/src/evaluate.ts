import { parseArgs } from "node:util";
import { PilotError } from "@pickler/core";
import { type EvaluationCommand } from "@pickler/trading/evaluation";
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string" },
    diagnostics: { type: "string" },
    "allow-paid": { type: "boolean" },
    "env-file": { type: "string" },
    "acquisition-choice": { type: "string" },
    output: { type: "string" },
    help: { type: "boolean" },
    state: { type: "string", multiple: true },
  },
});
if (values.help) {
  console.log(
    "evaluate audit-export|audit|data-diagnostic|stability|prepare|preflight|validate|run|resume|status|stop|settle|report|compare|history|replay --config FILE [--env-file FILE] [--allow-paid] [--output DIRECTORY]\nOffline audit: evaluate audit --state EXPORT_JSON --output NEW_DIRECTORY. Export: evaluate audit-export --config STUDY_JSON --env-file PRIVATE_ENV [--diagnostics LOCAL_JSONL] --output NEW_DIRECTORY.\nSingle evaluation entry point; protocol comes from the frozen config. No automatic paid restart or migration.",
  );
} else {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    if (positionals.length === 1 && ["audit", "audit-export"].includes(positionals[0]!)) {
      const { runPerpsAudit } = await import("./perps-study/audit.js");
      if (values.state && values.state.length !== 1) {
        throw new PilotError("INVALID_INPUT", "Audit requires exactly one --state");
      }
      await runPerpsAudit({
        signal: controller.signal,
        command: positionals[0] as "audit" | "audit-export",
        configPath: values.config,
        state: values.state?.[0],
        envFile: values["env-file"],
        diagnostics: values.diagnostics,
        output: values.output,
        allowPaid: values["allow-paid"],
      });
    } else {
      if (positionals.length !== 1 || !values.config) {
        throw new PilotError("INVALID_INPUT", "One command and --config required");
      }
      const { readFile } = await import("node:fs/promises");
      const protocol = JSON.parse(await readFile(values.config, "utf8")).protocol;
      const executeEvaluation =
        protocol === "perps-sma-ablation-v1"
          ? (await import("./perps-study/sma-host.js")).runSmaStudy
          : (await import("./evaluation-host/local.js")).executeEvaluation;
      await executeEvaluation({
        command: positionals[0] as EvaluationCommand,
        configPath: values.config,
        allowPaid: values["allow-paid"] ?? false,
        ...(values["env-file"] ? { envFile: values["env-file"] } : {}),
        ...(values.output ? { output: values.output } : {}),
        signal: controller.signal,
        ...(values["acquisition-choice"]
          ? { acquisitionChoice: values["acquisition-choice"] }
          : {}),
        ...(values.state ? { states: values.state } : {}),
      });
    }
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
