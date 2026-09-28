import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { validateCapturedDataset } from "./evaluation/captured-evidence";
import {
  upgradeDataset,
  validateDatasetV2,
  enrichedState,
  reviewHash,
  contextSchema,
} from "./evaluation/v2/context";
import { readJson, saveExclusive } from "./evaluation/v2/ledger";
import { assessmentSchema, EvaluationFailure } from "./evaluation/decision-evaluation";

async function main() {
  const { values } = parseArgs({
    options: {
      dataset: { type: "string" },
      history: { type: "string" },
      annotations: { type: "string" },
      output: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (!values.dataset || !values.history || !values.annotations || !values.output) {
    throw new EvaluationFailure("V2_PREPARATION_INPUTS_REQUIRED");
  }
  const output = resolve(values.output);
  if (!output.split("/").includes(".data")) {
    throw new EvaluationFailure("OUTPUT_MUST_BE_IN_LOCAL_DATA_DIRECTORY");
  }
  const history = validateCapturedDataset(await readJson(resolve(values.history)), false);
  if (history.cases.some((item) => !item.origin.eventId)) {
    throw new EvaluationFailure("V2_HISTORY_EVENT_IDS_REQUIRED");
  }
  const developmentEventIds = [...new Set(history.cases.map((item) => item.origin.eventId!))];
  const annotations = z
    .record(
      z.string(),
      z
        .object({
          context: contextSchema,
          proposal: z
            .object({ assessment: assessmentSchema, rationale: z.string().min(20) })
            .strict(),
        })
        .strict(),
    )
    .parse(await readJson(resolve(values.annotations)));
  const input = await readJson(resolve(values.dataset));
  const rawVersion = z.object({ schemaVersion: z.number() }).parse(input).schemaVersion;
  const upgraded =
    rawVersion === 1 ? upgradeDataset(input, developmentEventIds) : validateDatasetV2(input, false);
  const dataset = validateDatasetV2(
    {
      ...upgraded,
      developmentEventIds,
      cases: upgraded.cases.map((item) => {
        if (!annotations[item.base.id]) {
          throw new EvaluationFailure("V2_MISSING_ANNOTATION");
        }
        return { ...item, ...annotations[item.base.id], review: null };
      }),
    },
    false,
  );
  if (Object.keys(annotations).length !== dataset.cases.length) {
    throw new EvaluationFailure("V2_EXTRA_ANNOTATION");
  }
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await saveExclusive(output, dataset);
  const lines = [
    "# Evaluator v2 joint review packet",
    "",
    "Status: assistant proposals only; no human approval has been recorded. Review every claim, source, context assignment and proposed label. Unknown means unknown; do not fill dates from memory. No model results are included.",
    "",
    "After review, record reviewer, reviewedAt, rationale and approvedHash in each case's review field. The displayed hash covers original evidence, context and proposal. Any edit requires recomputing the hash and reviewing again. Assistant preparation must never be attributed to a human.",
    "",
  ];
  for (const item of dataset.cases) {
    lines.push(
      `## ${item.base.id}`,
      "",
      `Split: ${item.base.split}. Claim: ${item.base.state.claim}`,
      "",
      `Proposal: ${item.proposal!.assessment.evidence} / ${item.proposal!.assessment.next}`,
      "",
      item.proposal!.rationale,
      "",
      `Review hash: ${reviewHash(item)}`,
      "",
      "Context:",
      "",
      "```json",
      JSON.stringify(item.context, null, 2),
      "```",
      "",
    );
    const state = enrichedState(item);
    for (const fragment of state.fragments) {
      const source = item.base.origin.sources.find((source) => source.id === fragment.sourceId)!;
      const fence = "`".repeat(
        Math.max(3, ...Array.from(fragment.text.matchAll(/`+/g), (match) => match[0].length + 1)),
      );
      lines.push(
        `### ${fragment.id}`,
        "",
        `Source: ${source.url}`,
        `Published: ${source.publishedAt ?? "unknown"}; captured: ${source.retrievedAt}; truncated: ${source.truncated}.`,
        "",
        fence + "text",
        fragment.text,
        fence,
        "",
      );
    }
  }
  await writeFile(output + ".review.md", lines.join("\n"), { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify({ output, cases: dataset.cases.length, reviewed: 0, providerCalls: 0 }),
  );
}
main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      code: error instanceof EvaluationFailure ? error.code : "V2_PREPARATION_FAILED",
    }),
  );
  process.exitCode = 1;
});
