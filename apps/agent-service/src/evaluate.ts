import { readFile } from "node:fs/promises";
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
    inventory: { type: "string" },
    "restore-target": { type: "string" },
  },
});
if (values.help) {
  console.log(
    "evaluate baseline-export|baseline-verify|baseline-restore-check|audit-export|audit|data-diagnostic|stability|prepare|preflight|validate|run|resume|status|stop|settle|report|compare|history|replay --config FILE [--env-file FILE] [--allow-paid] [--output DIRECTORY]\nBaseline: baseline-export --inventory FILE --output NEW_DIRECTORY; baseline-verify --state MANIFEST --output NEW_DIRECTORY; baseline-restore-check --state MANIFEST --restore-target LOCAL_TARGET_JSON --output NEW_DIRECTORY. No env/provider composition.\nOffline audit: evaluate audit --state EXPORT_JSON --output NEW_DIRECTORY. Export: evaluate audit-export --config STUDY_JSON --env-file PRIVATE_ENV [--diagnostics LOCAL_JSONL] --output NEW_DIRECTORY.\nSingle evaluation entry point; protocol comes from the frozen config. No automatic paid restart or migration.",
  );
} else {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    if (positionals.length !== 1) {
      throw new PilotError("INVALID_INPUT", "One explicit evaluation operation required");
    }
    if (
      ["audit", "replay"].includes(positionals[0]!) &&
      (values.config || values["env-file"] || values["allow-paid"] || values.state?.length !== 1)
    ) {
      throw new PilotError(
        "INVALID_INPUT",
        "Offline analysis requires one state; config/env/paid forbidden",
      );
    }
    const selected = values.config ? JSON.parse(await readFile(values.config, "utf8")) : undefined;
    const offline =
      values.state?.length === 1 ? JSON.parse(await readFile(values.state[0]!, "utf8")) : undefined;
    const pts =
      selected?.protocol === "perps-pts-sma-v1" ||
      offline?.format === "perps-pts-history-v1" ||
      offline?.format === "pts-preparation-v1" ||
      offline?.payload?.study?.record?.config?.version === 8;
    if (pts) {
      const { runPtsCommand } = await import("./pts-study/index.js");
      await runPtsCommand({
        command: positionals[0]!,
        configPath: values.config,
        state: values.state?.[0],
        envFile: values["env-file"],
        output: values.output,
        allowPaid: values["allow-paid"],
        signal: controller.signal,
      });
    } else if (positionals.length === 1 && positionals[0]!.startsWith("baseline-")) {
      if (
        values.config ||
        values["env-file"] ||
        values["allow-paid"] ||
        values.diagnostics ||
        values["acquisition-choice"] ||
        (values.state && values.state.length !== 1)
      ) {
        throw new PilotError(
          "INVALID_INPUT",
          "Baseline commands reject provider/config/env/paid options",
        );
      }
      const { runTradingBaseline } = await import("./trading-baseline/index.js");
      await runTradingBaseline({
        command: positionals[0]!,
        inventory: values.inventory,
        state: values.state?.[0],
        output: values.output,
        restoreTarget: values["restore-target"],
        signal: controller.signal,
      });
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
