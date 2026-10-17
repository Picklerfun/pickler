import { lstat, readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { PilotError } from "@pickler/core";
import { type EvaluationCommand } from "@pickler/trading/evaluation";
import { researchJsonPath } from "./pts-study/research-path.js";

async function readOfflineState(file: string, signal: AbortSignal) {
  const path = await researchJsonPath(file);
  const info = await lstat(path);
  if (!info.isFile() || info.size < 1 || info.size > 256 * 1024 * 1024) {
    throw new PilotError("INVALID_INPUT", "Bounded regular offline JSON state required");
  }
  // Legacy v1 packets retain their existing 256 MiB bound. Research manifests additionally
  // enforce 64 KiB before any referenced source/policy file or provider composition is opened.
  const text = await readFile(path, { encoding: "utf8", signal });
  const after = await lstat(path);
  if (after.ino !== info.ino || after.size !== info.size || after.mtimeMs !== info.mtimeMs) {
    throw new PilotError("AUDIT_HASH_MISMATCH", "Offline state changed while reading");
  }
  return JSON.parse(text);
}

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
    acceptance: { type: "string" },
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
    const offline =
      values.state?.length === 1
        ? await readOfflineState(values.state[0]!, controller.signal)
        : undefined;
    if (typeof offline?.format === "string" && offline.format.startsWith("pts-research-input-")) {
      if (
        positionals[0] !== "audit" ||
        values.config ||
        values["env-file"] ||
        values["allow-paid"] ||
        values.diagnostics ||
        values["acquisition-choice"] ||
        values.inventory ||
        values["restore-target"] ||
        values.acceptance ||
        values.state?.length !== 1 ||
        !values.output
      ) {
        throw new PilotError(
          "INVALID_INPUT",
          "Offline research accepts only audit --state MANIFEST --output NEW_DIRECTORY",
        );
      }
      const { runPtsResearch } = await import("./pts-study/research.js");
      await runPtsResearch({
        command: "audit",
        state: values.state[0],
        output: values.output,
        signal: controller.signal,
      });
    } else {
      const selected = values.config
        ? JSON.parse(await readFile(values.config, "utf8"))
        : undefined;
      const hourlyBreakout =
        selected?.protocol === "perps-hourly-breakout-fixed-screen-v1" ||
        offline?.format === "hourly-breakout-source-capture-v1" ||
        offline?.format === "hourly-breakout-financial-audit-v1";
      if (values.acceptance && !hourlyBreakout) {
        throw new PilotError(
          "INVALID_INPUT",
          "Acceptance records belong only to hourly breakout v10",
        );
      }
      const pts =
        selected?.protocol === "perps-pts-sma-v1" ||
        selected?.protocol === "perps-pts-intraday-sma-v1" ||
        offline?.format === "perps-pts-history-v1" ||
        offline?.format === "pts-preparation-v1" ||
        (offline?.protocol === "perps-decision-audit-export-v2" &&
          [8, 9].includes(offline?.studyVersion)) ||
        offline?.payload?.study?.record?.config?.version === 8 ||
        offline?.payload?.study?.record?.config?.version === 9;
      if (hourlyBreakout) {
        if (
          values.diagnostics ||
          values["acquisition-choice"] ||
          values.inventory ||
          values["restore-target"] ||
          (values.state && values.state.length !== 1)
        ) {
          throw new PilotError(
            "INVALID_INPUT",
            "Hourly breakout rejects unrelated provider/legacy options",
          );
        }
        const { runHourlyBreakoutCommand } = await import("./hourly-breakout/index.js");
        await runHourlyBreakoutCommand({
          command: positionals[0]!,
          configPath: values.config,
          state: values.state?.[0],
          envFile: values["env-file"],
          output: values.output,
          allowPaid: values["allow-paid"],
          acceptancePath: values.acceptance,
          signal: controller.signal,
        });
      } else if (pts) {
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
