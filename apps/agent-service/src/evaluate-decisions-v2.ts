import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { config } from "dotenv";
import { enrichedState, validateDatasetV2, contextVersion } from "./evaluation/v2/context";
import { instructionsVersion, v2Instructions, makePlanV2 } from "./evaluation/v2/provider";
import { policy } from "./evaluation/v2/policy";
import {
  CampaignLedger,
  readJson,
  saveExclusive,
  existsJson,
  historicalAccounting,
} from "./evaluation/v2/ledger";
import { runCases } from "./evaluation/v2/runner";
import {
  summarize,
  markdownReport,
  type Observation,
  type FailureRow,
} from "./evaluation/v2/report";
import { EvaluationFailure, fingerprint } from "./evaluation/decision-evaluation";

const appDirectory = fileURLToPath(new URL("../", import.meta.url));
const price = z
  .object({
    model: z.string().min(1),
    input: z.number().positive(),
    output: z.number().nonnegative(),
    source: z.string().url().startsWith("https://"),
  })
  .strict();
async function main() {
  const { values } = parseArgs({
    options: {
      dataset: { type: "string" },
      phase: { type: "string", default: "dev" },
      attempt: { type: "string" },
      offset: { type: "string", default: "0" },
      limit: { type: "string" },
      prices: { type: "string" },
      "allow-paid": { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (!values.dataset || !["dev", "holdout"].includes(values.phase!)) {
    throw new EvaluationFailure("V2_DATASET_AND_PHASE_REQUIRED");
  }
  const dataset = validateDatasetV2(await readJson(resolve(values.dataset)), values["allow-paid"]);
  const phaseCases = dataset.cases.filter((item) => item.base.split === values.phase);
  if (
    (values.phase === "dev" && phaseCases.length !== 12) ||
    (values.phase === "holdout" &&
      (phaseCases.length !== 32 ||
        new Set(phaseCases.map((item) => item.base.origin.eventId)).size < 8 ||
        phaseCases.some(
          (item) =>
            phaseCases.filter((other) => other.base.origin.eventId === item.base.origin.eventId)
              .length > 4,
        )))
  ) {
    throw new EvaluationFailure("V2_PHASE_CORPUS_REQUIREMENTS");
  }
  const offset = Number(values.offset);
  const limit = values.limit ? Number(values.limit) : phaseCases.length;
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    offset + limit > phaseCases.length
  ) {
    throw new EvaluationFailure("INVALID_V2_CASE_RANGE");
  }
  const cases = phaseCases.slice(offset, offset + limit);
  if (!values["allow-paid"]) {
    console.log(
      JSON.stringify(
        {
          mode: "offline-preflight",
          selected: cases.length,
          phase: values.phase,
          reviewed: cases.filter((item) => item.review).length,
          maxCalls: cases.length * 4,
          maxAdditionalCampaignUsd: 0.5,
          report: summarize(phaseCases, [], false, 0),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!values.attempt || !/^[a-z0-9-]{1,60}$/.test(values.attempt) || !values.prices) {
    throw new EvaluationFailure("V2_ATTEMPT_AND_VERIFIED_PRICES_REQUIRED");
  }
  const prices = z
    .object({ checkedAt: z.string().datetime({ offset: true }), jev: price, llm: price })
    .strict()
    .parse(await readJson(resolve(values.prices)));
  const age = Date.now() - Date.parse(prices.checkedAt);
  if (
    age < 0 ||
    age > 7 * 86_400_000 ||
    prices.jev.model !== "jev-1.13.0" ||
    prices.jev.input !== 0.042 ||
    prices.jev.output !== 0
  ) {
    throw new EvaluationFailure("V2_REVERIFY_PRICES_OR_MODEL");
  }
  config({ path: resolve(appDirectory, ".env"), quiet: true });
  if (process.env.MODEL_ID !== prices.llm.model) {
    throw new EvaluationFailure("V2_MODEL_CONFIGURATION_CHANGED");
  }
  for (const item of cases) {
    for (const variant of ["llm-original", "jev-original", "jev-v2", "llm-backup"] as const) {
      makePlanV2(variant, enrichedState(item), process.env, prices.llm);
    }
  }
  const root = resolve(appDirectory, ".data/decision-evaluation-v2");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = resolve(root, ".lock");
  await mkdir(lock, { mode: 0o700 }); // Existing or stale lock requires operator inspection.
  try {
    const previousAccountedUsd = await historicalAccounting(
      resolve(appDirectory, ".data/decision-evaluation-v1"),
    );
    const identity = {
      datasetHash: fingerprint(dataset),
      contextVersion,
      instructionsVersion,
      instructionsHash: fingerprint(v2Instructions),
      policy,
      prices: { jev: prices.jev, llm: prices.llm },
      endpoint: process.env.MODEL_BASE_URL,
    };
    const existing = await existsJson(resolve(root, "campaign.json"));
    if (existing && fingerprint(existing) !== fingerprint(identity)) {
      throw new EvaluationFailure("V2_FROZEN_CAMPAIGN_CHANGED");
    }
    if (!existing) {
      await saveExclusive(resolve(root, "campaign.json"), identity);
    }
    await mkdir(resolve(root, "requests"), { recursive: true });
    await mkdir(resolve(root, "policies"), { recursive: true });
    const directory = resolve(root, values.attempt);
    await mkdir(directory, { mode: 0o700 });
    await saveExclusive(resolve(directory, "manifest.json"), {
      identity,
      cases,
      phase: values.phase,
      offset,
      limit,
      previousAccountedUsd,
      priceVerification: prices,
    });
    const ledger = new CampaignLedger(root, previousAccountedUsd);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    let execution;
    try {
      execution = await runCases(cases, ledger, process.env, prices.llm, controller.signal);
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
    const observations: Observation[] = [];
    const failures: FailureRow[] = [];
    for (const id of await readdir(resolve(root, "requests"))) {
      const request = resolve(root, "requests", id);
      const completed = (await existsJson(resolve(request, "completed.json"))) as
        | {
            caseId: string;
            variant: Observation["strategy"] | "llm-backup";
            result: { assessment: Observation["assessment"] };
            cost: number;
            elapsedMs: number;
          }
        | undefined;
      if (
        completed &&
        completed.variant !== "llm-backup" &&
        phaseCases.some((item) => item.base.id === completed.caseId)
      ) {
        observations.push({
          caseId: completed.caseId,
          strategy: completed.variant,
          assessment: completed.result.assessment,
          cost: completed.cost,
          elapsedMs: completed.elapsedMs,
          backupCalls: 0,
        });
      }
      const failure = await existsJson(resolve(request, "failed.json"));
      if (failure) {
        failures.push(failure as FailureRow);
      }
    }
    for (const item of phaseCases) {
      const row = (await existsJson(resolve(root, "policies", `${item.base.id}.json`))) as
        Observation | undefined;
      if (row) {
        observations.push(row);
      }
    }
    const accounting = await ledger.accounting();
    const report = summarize(
      phaseCases,
      observations,
      execution.stopCode === null && failures.length === 0,
      accounting.unknownCharges,
      failures,
    );
    await saveExclusive(resolve(directory, "summary.json"), {
      ...report,
      stopCode: execution.stopCode,
      failures,
      accounting,
      previousAccountedUsd,
      observations,
    });
    await writeFile(
      resolve(directory, "report.md"),
      markdownReport(report) +
        `\nExperimental accounting (including pending reservations): USD ${accounting.accountedUsd.toFixed(9)}. Calls: ${accounting.calls}. Unknown charges: ${accounting.unknownCharges}. Stop reason: ${execution.stopCode ?? "none"}.\n`,
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    console.log(
      JSON.stringify({ directory, stopCode: execution.stopCode, accounting, gate: report.gate }),
    );
    if (execution.stopCode) {
      process.exitCode = 1;
    }
  } finally {
    await rm(lock, { recursive: true });
  }
}
main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      code: error instanceof EvaluationFailure ? error.code : "V2_SETUP_OR_STORAGE_FAILED",
    }),
  );
  process.exitCode = 1;
});
