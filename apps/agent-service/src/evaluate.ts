import { parseArgs } from "node:util";
import { PilotError } from "@pickler/core";
import { type EvaluationCommand } from "@pickler/trading/evaluation";
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string" },
    diagnostics: { type: "string" },
    qualification: { type: "string" },
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
    "evaluate reader-audit|reader-check|timing-check|audit-export|audit|data-diagnostic|stability|prepare|preflight|validate|run|resume|status|stop|settle|report|compare|history|replay --config FILE [--env-file FILE] [--allow-paid] [--output DIRECTORY]\nOffline reader evidence: evaluate reader-audit --state CAPTURE_JSON --output NEW_DIRECTORY. Reader check: three public diagnostic captures, never qualification or trading. Offline audit: evaluate audit --state EXPORT_JSON --output NEW_DIRECTORY. Offline timing: evaluate timing-check --state EXPORT_JSON --output NEW_DIRECTORY. Export: evaluate audit-export --config STUDY_JSON --env-file PRIVATE_ENV [--diagnostics LOCAL_JSONL] --output NEW_DIRECTORY. V7 run requires --qualification CAPTURE_REPORT_JSON.\nSingle evaluation entry point; protocol comes from the frozen config. No automatic paid restart or migration.",
  );
} else {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    if (positionals.length === 1 && positionals[0] === "reader-audit") {
      if (
        values["env-file"] ||
        values["allow-paid"] ||
        values.config ||
        values.diagnostics ||
        values.qualification ||
        values["acquisition-choice"] ||
        values.state?.length !== 1 ||
        !values.output
      ) {
        throw new PilotError(
          "INVALID_INPUT",
          "Offline reader-audit requires one --state and new --output; no environment or provider mode",
        );
      }
      const { runReaderAudit } = await import("./perps-study/reader-audit.js");
      await runReaderAudit(values.state[0]!, values.output, controller.signal);
    } else if (positionals.length === 1 && positionals[0] === "timing-check") {
      if (
        values["env-file"] ||
        values["allow-paid"] ||
        values.state?.length !== 1 ||
        !values.output
      ) {
        throw new PilotError(
          "INVALID_INPUT",
          "Offline timing-check requires one --state and new --output; no environment or paid mode",
        );
      }
      const { runTimingCheck } = await import("./perps-study/timing-check.js");
      await runTimingCheck(values.state[0]!, values.output, controller.signal);
    } else if (positionals.length === 1 && ["audit", "audit-export"].includes(positionals[0]!)) {
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
      const { executeEvaluation } = await import("./evaluation-host/local.js");
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
        ...(values.qualification ? { qualification: values.qualification } : {}),
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
