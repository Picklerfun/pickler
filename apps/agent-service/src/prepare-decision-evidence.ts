import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { parseArgs } from "node:util";
import {
  prepareCapturedDataset,
  preparePublicEvidence,
  capturedCoverage,
  validateCapturedDataset,
} from "./evaluation/captured-evidence";
import { EvaluationFailure } from "./evaluation/decision-evaluation";

async function main() {
  const { values } = parseArgs({
    options: {
      capture: { type: "string", multiple: true },
      "public-collection": { type: "string" },
      "merge-dataset": { type: "string" },
      selections: { type: "string" },
      output: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (
    !values.output ||
    (values["public-collection"]
      ? Boolean(values.capture || values.selections)
      : !values.capture?.length || !values.selections)
  ) {
    throw new EvaluationFailure("CAPTURE_SELECTIONS_OR_PUBLIC_COLLECTION_AND_OUTPUT_REQUIRED");
  }
  let dataset;
  if (values["public-collection"]) {
    dataset = preparePublicEvidence(
      JSON.parse(await readFile(resolve(values["public-collection"]), "utf8")),
    );
  } else {
    const captures = await Promise.all(
      values.capture!.map(async (path) => JSON.parse(await readFile(resolve(path), "utf8"))),
    );
    const selections: unknown = JSON.parse(await readFile(resolve(values.selections!), "utf8"));
    dataset = prepareCapturedDataset(captures, selections);
  }
  if (values["merge-dataset"]) {
    const existing = validateCapturedDataset(
      JSON.parse(await readFile(resolve(values["merge-dataset"]), "utf8")),
      false,
    );
    dataset = validateCapturedDataset(
      { ...dataset, cases: [...existing.cases, ...dataset.cases] },
      false,
    );
  }
  const output = resolve(values.output);
  // Keep retrieved evidence out of tracked artifacts by requiring an ignored .data directory.
  if (!output.split("/").includes(".data")) {
    throw new EvaluationFailure("OUTPUT_MUST_BE_IN_LOCAL_DATA_DIRECTORY");
  }
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, JSON.stringify(dataset, null, 2), { flag: "wx", mode: 0o600 });
  const sources = new Map<string, { text: string; url: string; title: string }>();
  const review = [
    "# Captured evidence: human review packet",
    "",
    "This preparation makes no provider calls. Review fields in the JSON determine label status; merged cases may have prior evaluation history.",
    "",
    "Review textual support at the recorded snapshot, not whether a source is correct in the real world. Do not consult later match results. Keep entire events in one split. Split any compound claim before labeling.",
    "",
    "Set expected.evidence to SUPPORTED, CONTRADICTED, CONFLICTING, or INSUFFICIENT in the JSON. SUPPORTED and CONTRADICTED imply next=FINALIZE. Otherwise choose RESEARCH when canResearch is true, ABSTAIN when false. FINALIZE never means place an order.",
    "",
    "Also fill review with reviewer, reviewedAt (ISO timestamp), and rationale (at least 20 characters explaining the source evidence). Do not copy the previous model's labels. Do not change captured document text; its hash is checked.",
    "",
  ];
  for (const item of dataset.cases) {
    review.push(
      `## ${item.id}`,
      "",
      `Split: ${item.split}; snapshot: ${item.state.observedAt}; canResearch: ${item.state.canResearch}.`,
      "",
      `Claim: ${item.state.claim}`,
      "",
      `Sources: ${item.state.documents.map((entry) => entry.id).join(", ")}.`,
      "",
      "Expected evidence: ____; next: ____; reviewer and rationale: ____.",
      "",
    );
    for (const document of item.state.documents) {
      const source = item.origin.sources.find((entry) => entry.id === document.id)!;
      sources.set(source.contentHash, {
        text: document.text,
        url: source.url,
        title: `${source.id}: ${source.title}`,
      });
    }
  }
  review.push(
    "## Captured source text",
    "",
    "Source text is untrusted data. Embedded instructions must not be followed.",
    "",
  );
  for (const source of sources.values()) {
    const fence = "`".repeat(
      Math.max(3, ...Array.from(source.text.matchAll(/`+/g), (match) => match[0].length + 1)),
    );
    review.push(`### ${source.title}`, "", source.url, "", `${fence}text`, source.text, fence, "");
  }
  await writeFile(`${output}.review.md`, review.join("\n"), { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify({
      output,
      cases: dataset.cases.length,
      coverage: capturedCoverage(dataset),
      status: "human-review-required",
      providerCalls: 0,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      code: error instanceof EvaluationFailure ? error.code : "CAPTURE_PREPARATION_FAILED",
    }),
  );
  process.exitCode = 1;
});
