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
import { RevisionLedger } from "./evaluation/v4/ledger";
import { instructions, makePlanV3 } from "./evaluation/v3/provider";
import { policy } from "./evaluation/v4/policy";
import { runCases } from "./evaluation/v4/runner";
import { report, markdown } from "./evaluation/v4/report";
const app = fileURLToPath(new URL("../", import.meta.url));
async function main() {
  const { values } = parseArgs({
    options: {
      dataset: { type: "string" },
      prices: { type: "string" },
      phase: { type: "string", default: "diagnostic" },
      "allow-paid": { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!values.dataset || !["diagnostic", "fresh"].includes(values.phase!)) {
    throw new EvaluationFailure("V4_INPUT_REQUIRED");
  }
  const data = validateDatasetV2(await readJson(resolve(values.dataset)), true);
  const historicalDataset = validateDatasetV2(
    await readJson(resolve(app, ".data/decision-v2-frozen-delegated-01.json")),
    true,
  );
  const excludedEvents = new Set([
    ...historicalDataset.developmentEventIds,
    ...historicalDataset.cases.map((c) => c.base.origin.eventId),
  ]);
  if (
    data.cases.length !== 12 ||
    new Set(data.cases.map((c) => c.base.origin.eventId)).size !== 3 ||
    data.cases.some(
      (c) =>
        excludedEvents.has(c.base.origin.eventId) ||
        data.cases.filter((o) => o.base.origin.eventId === c.base.origin.eventId).length > 4,
    )
  ) {
    throw new EvaluationFailure("V4_FRESH_CORPUS_INVALID");
  }
  const diagnosticCase = structuredClone(data.cases[0]!);
  diagnosticCase.base.id = "v4-controlled-format-diagnostic";
  diagnosticCase.base.state.claim = "The calibration player is available for the calibration game.";
  diagnosticCase.base.state.documents = [
    {
      id: "calibration-source",
      text: "The calibration player is ruled out of the calibration game on September 1, 2025.",
    },
  ];
  const diagnosticEvent = {
    eventId: "calibration-game",
    date: "2025-09-01",
    provenance: [
      {
        sourceId: "calibration-source",
        note: "Explicitly synthetic diagnostic fixture, not sports evidence.",
      },
    ],
  };
  diagnosticCase.context = {
    target: diagnosticEvent,
    documents: [{ sourceId: "calibration-source", event: diagnosticEvent }],
    glossary: [],
  };
  diagnosticCase.base.origin.sources = [
    {
      id: "calibration-source",
      url: "https://example.com/calibration",
      title: "Synthetic calibration",
      publishedAt: null,
      retrievedAt: new Date().toISOString(),
      truncated: false,
      contentHash: fingerprint(diagnosticCase.base.state.documents[0]!.text),
    },
  ];
  diagnosticCase.proposal = {
    assessment: { evidence: "CONTRADICTED", next: "FINALIZE" },
    rationale: "Synthetic calibration explicitly rules the player out.",
  };
  const cases = values.phase === "diagnostic" ? [diagnosticCase] : data.cases;
  if (!values["allow-paid"]) {
    console.log(
      JSON.stringify({
        mode: "offline",
        cases: cases.length,
        maxCalls: values.phase === "diagnostic" ? 1 : cases.length * 3,
        version: policy.version,
      }),
    );
    return;
  }
  if (!values.prices) {
    throw new EvaluationFailure("V4_PRICES_REQUIRED");
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
    throw new EvaluationFailure("V4_PRICE_REVERIFICATION_REQUIRED");
  }
  config({ path: resolve(app, ".env"), quiet: true });
  if (process.env.MODEL_ID !== prices.llm.model) {
    throw new EvaluationFailure("V4_MODEL_CHANGED");
  }
  for (const c of cases) {
    for (const variant of ["llm-original", "jev-v2", "llm-backup"] as const) {
      makePlanV3(variant, enrichedState(c), process.env, prices.llm);
    }
  }
  const previousRoot = resolve(app, ".data/decision-evaluation-v2");
  const root = resolve(app, ".data/decision-evaluation-v4");
  const v3Root = resolve(app, ".data/decision-evaluation-v3");
  // Share v2's execution lock: no revision can admit requests concurrently.
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
      protocol:
        "One synthetic diagnostic, then 12 fresh cases; instructions v3, policy v4. User authorized 2026-09-26; delegated references remain non-human.",
    };
    const frozen = await existsJson(resolve(root, "campaign.json"));
    if (frozen && fingerprint(frozen) !== fingerprint(identity)) {
      throw new EvaluationFailure("V4_FROZEN_CAMPAIGN_CHANGED");
    }
    if (!frozen) {
      await saveExclusive(resolve(root, "campaign.json"), identity);
    }
    for (const dir of ["requests", "policies"]) {
      await mkdir(resolve(root, dir), { recursive: true });
    }
    // A failed v4 batch blocks automatic continuation. Do not repair or retry started calls.
    for (const id of await readdir(resolve(root, "requests"))) {
      if (await existsJson(resolve(root, "requests", id, "failed.json"))) {
        throw new EvaluationFailure("V4_PREVIOUS_FAILURE_STOP");
      }
    }
    const dir = resolve(root, values.phase!);
    await mkdir(dir, { mode: 0o700 });
    const historical = await historicalAccounting(resolve(app, ".data/decision-evaluation-v1"));
    const previous = new CampaignLedger(previousRoot, historical);
    const previousAccounting = await previous.accounting();
    const v3 = new CampaignLedger(v3Root, 0);
    const v3Accounting = await v3.accounting();
    if (values.phase === "fresh") {
      const diagnosticRun = (await existsJson(resolve(root, "diagnostic/summary.json"))) as
        { stopCode: string | null; observations: unknown[] } | undefined;
      if (!diagnosticRun || diagnosticRun.stopCode || diagnosticRun.observations.length !== 1) {
        throw new EvaluationFailure("V4_SUCCESSFUL_DIAGNOSTIC_REQUIRED");
      }
    }
    const ledger = new RevisionLedger(root, historical, [previous, v3]);
    const current = await ledger.accounting();
    const maxCalls = values.phase === "diagnostic" ? 1 : 36;
    if (previousAccounting.calls + v3Accounting.calls + current.calls + maxCalls > 176) {
      throw new EvaluationFailure("V4_WORST_CASE_CALL_LIMIT");
    }
    await saveExclusive(resolve(dir, "manifest.json"), {
      identity,
      caseIds: cases.map((c) => c.base.id),
      previousAccounting,
      v3Accounting,
      historical,
      verifiedAt: prices.checkedAt,
    });
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    let run;
    try {
      run = await runCases(
        cases,
        ledger,
        process.env,
        prices.llm,
        controller.signal,
        fetch,
        values.phase === "diagnostic",
      );
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
    const accounting = await ledger.accounting();
    const result = report(
      cases,
      run.observations,
      run.stopCode,
      accounting.unknownCharges + previousAccounting.unknownCharges + v3Accounting.unknownCharges,
    );
    await saveExclusive(resolve(dir, "summary.json"), {
      ...result,
      failures: run.failures,
      observations: run.observations,
      accounting,
      previousAccounting,
      v3Accounting,
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
      code: e instanceof EvaluationFailure ? e.code : "V4_PREFLIGHT_OR_STORAGE_FAILURE",
    }),
  );
  process.exitCode = 1;
});
