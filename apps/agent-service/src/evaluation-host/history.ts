import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PilotError } from "@pickler/core";
import {
  EVALUATION_PROTOCOLS,
  reconcileQuant,
  reconcileCases,
  type EvaluationCommand,
} from "@pickler/trading/evaluation";
import {
  settleComparisonCase,
  type StudyState,
  type QuantState,
  type ComparisonState,
} from "@pickler/trading/strategies";
import {
  PolymarketPaperResolution,
  QuantData,
  comparisonTransport,
  type PublicRequestDiagnostic,
} from "@pickler/infrastructure";
import { studyConfigSchema, saveStudy, lockStudy, atomicWrite } from "../paper-study/files.js";
import { saveQuant } from "../paper-study/quant-report.js";
import { saveComparison, replayComparison } from "../paper-study/comparison-report.js";
import { historicalQuant } from "../paper-study/quant-history.js";
import { quantConfigSchema, comparisonConfigSchema } from "./history-config.js";

/** Historical formats have no model or execution factory. Their stored version is never rewritten. */
export async function runHistoricalEvaluation(
  command: EvaluationCommand,
  raw: unknown,
  root: string,
  signal: AbortSignal,
  verifyConfiguration: () => Promise<void> = async () => {},
) {
  const version = (raw as { version: number }).version;
  const protocol =
    version === 1
      ? "paper-study-v1"
      : version === 2
        ? "btc-quant-jev-v1"
        : version === 3
          ? "btc-policy-comparison-v1"
          : null;
  if (
    !protocol ||
    !(EVALUATION_PROTOCOLS[protocol].commands as readonly string[]).includes(command)
  ) {
    throw new PilotError(
      "EVALUATION_COMMAND_INVALID",
      "Historical adapters permit only explicit read/reconciliation commands",
    );
  }

  const config =
    version === 1
      ? studyConfigSchema.parse(raw)
      : version === 2
        ? quantConfigSchema.parse(raw)
        : comparisonConfigSchema.parse(raw);
  const directory = join(root, config.id);
  // Refuse missing state before acquiring a lock that could create an empty directory.
  await readFile(join(directory, "state.json"), "utf8");
  const release = await lockStudy(directory);
  try {
    signal.throwIfAborted();
    const state = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
    if (
      state.version !== version ||
      (version === 1 ? state.config?.id : state.id) !== config.id ||
      (version !== 1 && state.protocol !== (config as { protocol: string }).protocol)
    ) {
      throw new PilotError(
        "HISTORICAL_STATE_MISMATCH",
        "Historical identity/version differs from configuration",
      );
    }
    const guard = async () => {
      signal.throwIfAborted();
      await verifyConfiguration();
      if (!("plugins" in config) || !config.plugins.includes("polymarket")) {
        throw new PilotError(
          "PLUGIN_DISABLED",
          "Polymarket must remain enabled for reconciliation",
        );
      }
    };
    const diagnostics: PublicRequestDiagnostic[] =
      version === 3
        ? await readFile(join(directory, "requests.json"), "utf8")
            .then(JSON.parse)
            .catch((error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") {
                return [];
              }
              throw error;
            })
        : [];
    const resolver = new PolymarketPaperResolution(
      version === 3
        ? comparisonTransport({
            guard: async () => guard(),
            report: async (record) => {
              diagnostics.push(record);
              await atomicWrite(
                join(directory, "requests.json"),
                JSON.stringify(diagnostics, null, 2),
              );
            },
          })
        : undefined,
    );
    if (version === 1) {
      await saveStudy(directory, state as StudyState);
    } else if (version === 2) {
      const value = state as QuantState;
      const save = () => saveQuant(directory, value);
      if (command === "replay") {
        console.log(
          JSON.stringify(
            {
              notice: "Retrospective proposals only; no executed purchases or P&L.",
              cases: replayComparison(value),
            },
            null,
            2,
          ),
        );
        return;
      }

      if (command === "settle") {
        await reconcileQuant(value, { resolver, guard, save, now: Date.now, signal });
      }
      if (command === "history") {
        await historicalQuant(
          new QuantData(async (plugin) => {
            signal.throwIfAborted();
            await verifyConfiguration();
            if (!("plugins" in config) || !config.plugins.includes(plugin)) {
              throw new PilotError("PLUGIN_DISABLED", plugin);
            }
          }),
          directory,
        );
      }
      await save();
    } else {
      const value = state as ComparisonState;
      const save = () => saveComparison(directory, value);
      if (command === "settle") {
        await reconcileCases(value.cases, {
          resolver,
          guard,
          save,
          now: Date.now,
          signal,
          settle: settleComparisonCase,
        });
      }
      await save();
    }
  } finally {
    await release();
  }
}
