import { mkdir, rm, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import { z } from "zod";
import { validateDatasetV2, enrichedState } from "./evaluation/v2/context";
import {
  CampaignLedger,
  readJson,
  saveExclusive,
  historicalAccounting,
  existsJson,
} from "./evaluation/v2/ledger";
import { fingerprint, EvaluationFailure } from "./evaluation/decision-evaluation";
import { RevisionLedger } from "./evaluation/v3/ledger";
import { instructions, makePlanV3 } from "./evaluation/v3/provider";
import { policy } from "./evaluation/v3/policy";
import { runCases } from "./evaluation/v3/runner";
import { report, markdown } from "./evaluation/v3/report";
const app = fileURLToPath(new URL("../", import.meta.url));
const developmentIds = [
  "broncos-titans-2025-09-07-adkins-available",
  "buccaneers-falcons-2025-09-07-vea-friday-absent",
  "chargers-chiefs-2025-12-14-molden-doubtful",
  "packers-bears-2025-01-05-cox-confirmed",
];
async function main() {
  const { values } = parseArgs({
    options: {
      dataset: { type: "string" },
      prices: { type: "string" },
      phase: { type: "string", default: "dev" },
      "allow-paid": { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!values.dataset || !["dev", "holdout"].includes(values.phase!)) {
    throw new EvaluationFailure("V3_INPUT_REQUIRED");
  }
  const data = validateDatasetV2(await readJson(resolve(values.dataset)), true);
  const cases =
    values.phase === "dev"
      ? developmentIds.map((id) => data.cases.find((c) => c.base.id === id)!)
      : data.cases.filter((c) => c.base.split === "holdout");
  if (
    cases.some((c) => !c) ||
    (values.phase === "holdout" &&
      (cases.length !== 32 ||
        new Set(cases.map((c) => c.base.origin.eventId)).size < 8 ||
        cases.some(
          (c) => cases.filter((o) => o.base.origin.eventId === c.base.origin.eventId).length > 4,
        )))
  ) {
    throw new EvaluationFailure("V3_CORPUS_INVALID");
  }
  if (!values["allow-paid"]) {
    console.log(
      JSON.stringify({
        mode: "offline",
        cases: cases.length,
        maxCalls: cases.length * 3,
        version: instructions.version,
      }),
    );
    return;
  }
  if (!values.prices) {
    throw new EvaluationFailure("V3_PRICES_REQUIRED");
  }
  const rate = z
    .object({
      model: z.string(),
      input: z.number().positive(),
      output: z.number().nonnegative(),
      source: z.string().url().startsWith("https://"),
    })
    .strict();
  const prices = z
    .object({ checkedAt: z.string().datetime({ offset: true }), jev: rate, llm: rate })
    .strict()
    .parse(await readJson(resolve(values.prices)));
  const age = Date.now() - Date.parse(prices.checkedAt);
  if (
    age < 0 ||
    age > 7 * 86400000 ||
    prices.jev.model !== "jev-1.13.0" ||
    prices.jev.input !== 0.042 ||
    prices.jev.output !== 0
  ) {
    throw new EvaluationFailure("V3_PRICE_REVERIFICATION_REQUIRED");
  }
  config({ path: resolve(app, ".env"), quiet: true });
  if (process.env.MODEL_ID !== prices.llm.model) {
    throw new EvaluationFailure("V3_MODEL_CHANGED");
  }
  for (const c of cases) {
    for (const variant of ["llm-original", "jev-v2", "llm-backup"] as const) {
      makePlanV3(variant, enrichedState(c), process.env, prices.llm);
    }
  }
  const previousRoot = resolve(app, ".data/decision-evaluation-v2");
  const root = resolve(app, ".data/decision-evaluation-v3");
  // Share v2's execution lock: neither revision can admit requests concurrently.
  const lock = resolve(previousRoot, ".lock");
  await mkdir(lock, { mode: 0o700 });
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const identity = {
      datasetHash: fingerprint(data),
      instructions,
      policy,
      prices: { jev: prices.jev, llm: prices.llm },
      endpoint: process.env.MODEL_BASE_URL,
      developmentIds,
    };
    const frozen = await existsJson(resolve(root, "campaign.json"));
    if (frozen && fingerprint(frozen) !== fingerprint(identity)) {
      throw new EvaluationFailure("V3_FROZEN_CAMPAIGN_CHANGED");
    }
    if (!frozen) {
      await saveExclusive(resolve(root, "campaign.json"), identity);
    }
    for (const dir of ["requests", "policies"]) {
      await mkdir(resolve(root, dir), { recursive: true });
    }
    // A failed v3 batch blocks automatic continuation. Do not repair or retry started calls.
    for (const id of await readdir(resolve(root, "requests"))) {
      if (await existsJson(resolve(root, "requests", id, "failed.json"))) {
        throw new EvaluationFailure("V3_PREVIOUS_FAILURE_STOP");
      }
    }
    const dir = resolve(root, values.phase!);
    await mkdir(dir, { mode: 0o700 });
    const historical = await historicalAccounting(resolve(app, ".data/decision-evaluation-v1"));
    const previous = new CampaignLedger(previousRoot, historical);
    const previousAccounting = await previous.accounting();
    const ledger = new RevisionLedger(root, historical + previousAccounting.accountedUsd, previous);
    await saveExclusive(resolve(dir, "manifest.json"), {
      identity,
      caseIds: cases.map((c) => c.base.id),
      previousAccounting,
      historical,
      verifiedAt: prices.checkedAt,
    });
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    let run;
    try {
      run = await runCases(cases, ledger, process.env, prices.llm, controller.signal);
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
    const accounting = await ledger.accounting();
    const result = report(cases, run.observations, run.stopCode, accounting.unknownCharges);
    await saveExclusive(resolve(dir, "summary.json"), {
      ...result,
      failures: run.failures,
      observations: run.observations,
      accounting,
      previousAccounting,
      historical,
    });
    await saveExclusive(resolve(dir, "report.json"), { markdown: markdown(result) });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(resolve(dir, "report.md"), markdown(result), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ phase: values.phase, ...result, accounting }));
    if (run.stopCode) {
      process.exitCode = 1;
    }
  } finally {
    await rm(lock, { recursive: true });
  }
}
main().catch((e) => {
  console.error(
    JSON.stringify({
      code: e instanceof EvaluationFailure ? e.code : "V3_PREFLIGHT_OR_STORAGE_FAILURE",
    }),
  );
  process.exitCode = 1;
});
