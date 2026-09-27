import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { config } from "dotenv";
import { decisionCases } from "./evaluation/decision-cases";
import { validateCapturedDataset } from "./evaluation/captured-evidence";
import {
  callProvider,
  costUsd,
  EvaluationBudget,
  EvaluationFailure,
  fingerprint,
  grade,
  makePlan,
  needsConsistencyReview,
  rubricForState,
  rulesAssessment,
  type Provider,
  type Rates,
  type EvidenceCase,
} from "./evaluation/decision-evaluation";

const appDirectory = fileURLToPath(new URL("../", import.meta.url));
type Row = {
  caseId: string;
  provider: string;
  status: "started" | "completed" | "failed";
  elapsedMs?: number;
  estimatedCostUsd?: number;
  code?: string;
  grade?: ReturnType<typeof grade>;
  consistencyReview?: boolean;
};

async function main() {
  const { values } = parseArgs({
    options: {
      provider: { type: "string", default: "rules" },
      split: { type: "string", default: "dev" },
      limit: { type: "string", default: "4" },
      offset: { type: "string", default: "0" },
      dataset: { type: "string" },
      shadow: { type: "boolean", default: false },
      attempt: { type: "string" },
      "allow-paid": { type: "boolean", default: false },
      "budget-usd": { type: "string" },
      "max-calls": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const provider = values.provider!;
  const split = values.split!;
  const limit = Number(values.limit);
  const offset = Number(values.offset);
  const attempt = values.attempt ?? `offline-${Date.now()}`;
  if (
    !["rules", "jev", "llm", "all"].includes(provider) ||
    !["dev", "holdout"].includes(split) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 16 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    !/^[a-z0-9-]{1,60}$/.test(attempt)
  ) {
    throw new EvaluationFailure("INVALID_OPTIONS");
  }
  const shadow = values.shadow!;
  if (shadow && !values.dataset) {
    throw new EvaluationFailure("SHADOW_REQUIRES_CAPTURED_DATASET");
  }
  const paid = provider !== "rules";
  if (
    paid &&
    (!values["allow-paid"] || !values.attempt || !values["budget-usd"] || !values["max-calls"])
  ) {
    throw new EvaluationFailure("PAID_RUN_REQUIRES_ATTEMPT_BUDGET_MAX_CALLS_AND_ALLOW_PAID");
  }
  const budget = paid
    ? new EvaluationBudget(Number(values["budget-usd"]), Number(values["max-calls"]))
    : undefined;
  // Offline execution never reads credentials.
  if (paid) {
    config({ path: resolve(appDirectory, ".env"), quiet: true });
  }
  let llmRates: Rates | undefined;
  if (["llm", "all"].includes(provider)) {
    const input = Number(process.env.EVAL_LLM_INPUT_USD_PER_MILLION);
    const output = Number(process.env.EVAL_LLM_OUTPUT_USD_PER_MILLION);
    const source = process.env.EVAL_LLM_PRICE_SOURCE;
    if (
      !Number.isFinite(input) ||
      input <= 0 ||
      !Number.isFinite(output) ||
      output <= 0 ||
      !source?.startsWith("https://")
    ) {
      throw new EvaluationFailure("SET_VERIFIED_EVAL_LLM_RATES_AND_PRICE_SOURCE");
    }
    llmRates = { input, output, source };
  }
  let dataset: (Omit<EvidenceCase, "expected"> & { expected: EvidenceCase["expected"] | null })[] =
    decisionCases;
  let datasetContent: unknown = decisionCases;
  if (values.dataset) {
    const reviewed = validateCapturedDataset(
      JSON.parse(await readFile(resolve(values.dataset), "utf8")),
      !shadow,
    );
    datasetContent = reviewed;
    dataset = reviewed.cases.map((item) => ({ ...item, expected: shadow ? null : item.expected }));
  }
  const partition = dataset.filter((item) => item.split === split);
  if (offset + limit > partition.length) {
    throw new EvaluationFailure("CASE_RANGE_EXCEEDS_PARTITION");
  }
  const cases = partition.slice(offset, offset + limit);
  const activeRubric = rubricForState(cases[0]!.state);
  const providers: (Provider | "rules")[] =
    provider === "all" ? ["rules", "jev", "llm"] : [provider as Provider | "rules"];
  // Validate every provider before claiming an attempt or contacting any provider.
  for (const name of providers) {
    if (name !== "rules") {
      for (const fixture of cases) {
        makePlan(name, fixture.state, process.env, llmRates);
      }
    }
  }
  const parent = resolve(appDirectory, ".data/decision-evaluation-v1");
  await mkdir(parent, { recursive: true });
  const directory = resolve(parent, attempt);
  await mkdir(directory, { mode: 0o700 }); // EEXIST deliberately prevents replay/overwrite.
  const save = async (name: string, value: unknown) =>
    writeFile(resolve(directory, name), JSON.stringify(value, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  await save("manifest.json", {
    version: 1,
    synthetic: !values.dataset,
    mode: shadow ? "shadow-unscored" : "graded",
    createdAt: new Date().toISOString(),
    split,
    offset,
    provider,
    rubric: activeRubric,
    rubricHash: fingerprint(activeRubric),
    datasetHash: fingerprint(datasetContent),
    cases,
    llmRates,
    maximumUsd: budget?.maximumUsd ?? 0,
    maximumCalls: budget?.maximumCalls ?? 0,
    note: "Evidence classification only, not forecasting or profitability validation. Synthetic labels are author-defined; captured labels require recorded human review. Cost is an estimate. Labels, review notes and provenance metadata are never sent to providers.",
  });
  const rows: Row[] = [];
  let stopCode: string | undefined;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    execution: for (const fixture of cases) {
      for (const name of providers) {
        const started = Date.now();
        const row: Row = { caseId: fixture.id, provider: name, status: "started" };
        if (controller.signal.aborted) {
          stopCode = "CANCELLED";
          break execution;
        }
        if (name === "rules") {
          const assessment = rulesAssessment(fixture.state);
          Object.assign(row, {
            status: "completed",
            elapsedMs: Date.now() - started,
            estimatedCostUsd: 0,
            grade: fixture.expected ? grade(assessment, fixture.expected) : undefined,
            consistencyReview: needsConsistencyReview(assessment, fixture.state),
          });
          await save(`${fixture.id}-${name}.json`, { ...row, assessment });
          rows.push(row);
          continue;
        }
        const plan = makePlan(name, fixture.state, process.env, llmRates);
        try {
          budget!.reserve(plan.reservedUsd);
        } catch {
          stopCode = "BUDGET_OR_CALL_LIMIT";
          break execution;
        }
        // Persist admission BEFORE network I/O. Interrupted/ambiguous attempts are never resumed.
        await save(`${fixture.id}-${name}-started.json`, {
          ...row,
          requestedModel: plan.model,
          requestHash: fingerprint(plan.body),
          rates: plan.rates,
          reservedUsd: plan.reservedUsd,
        });
        try {
          const result = await callProvider(
            name,
            plan,
            AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]),
          );
          const estimatedCostUsd = costUsd(result.usage, plan.rates);
          Object.assign(row, {
            status: "completed",
            elapsedMs: Date.now() - started,
            estimatedCostUsd,
            grade: fixture.expected ? grade(result.assessment, fixture.expected) : undefined,
            consistencyReview: needsConsistencyReview(result.assessment, fixture.state),
          });
          await save(`${fixture.id}-${name}.json`, { ...row, ...result, rates: plan.rates });
          rows.push(row);
          budget!.settle(plan.reservedUsd, estimatedCostUsd);
        } catch (error) {
          stopCode = error instanceof EvaluationFailure ? error.code : "EVALUATION_FAILED";
          if (row.status !== "completed") {
            Object.assign(row, {
              status: "failed",
              elapsedMs: Date.now() - started,
              code: stopCode,
            });
            await save(`${fixture.id}-${name}-failed.json`, {
              ...row,
              billingUnknown: true,
              reservedUsd: plan.reservedUsd,
            });
            rows.push(row);
          }
          break execution;
        }
      }
    }
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    const summary = providers.map((name) => {
      const entries = rows.filter((row) => row.provider === name);
      const completed = entries.filter((row) => row.status === "completed");
      return {
        provider: name,
        graded: completed.filter((row) => row.grade).length,
        planned: cases.length,
        attempted: entries.length,
        completed: completed.length,
        failures: entries.filter((row) => row.status === "failed").length,
        evidenceMatches: shadow ? null : completed.filter((row) => row.grade?.evidenceMatch).length,
        nextMatches: shadow ? null : completed.filter((row) => row.grade?.nextMatch).length,
        exactMatches: shadow ? null : completed.filter((row) => row.grade?.exactMatch).length,
        unsafeFinalizations: shadow
          ? null
          : completed.filter((row) => row.grade?.unsafeFinalize).length,
        consistencyReviews: completed.filter((row) => row.consistencyReview).length,
        estimatedKnownCostUsd: completed.reduce((sum, row) => sum + (row.estimatedCostUsd ?? 0), 0),
        totalElapsedMs: entries.reduce((sum, row) => sum + (row.elapsedMs ?? 0), 0),
      };
    });
    await save("summary.json", {
      mode: shadow ? "shadow-unscored" : "graded",
      stopCode: stopCode ?? null,
      summary,
      rows,
      accountedUsdIncludingUnsettledReservations: budget?.accountedUsd ?? 0,
    });
    const table = [
      values.dataset ? "# Captured evidence evaluation" : "# Synthetic decision evaluation",
      "",
      `Mode: ${shadow ? "shadow-unscored (no accuracy measurement)" : "graded"}. Split: ${split}. Stop: ${stopCode ?? "none"}.`,
      "",
      "Counts use completed cases; inspect planned/attempted counts before comparing. Costs exclude unknown charges from failed requests. Synthetic labels are author-defined; graded captured labels have recorded review metadata. Shadow runs omit grades and do not establish accuracy.",
      "",
      "| Provider | Planned | Attempted | Completed | Evidence correct | Next correct | Both correct | Unsafe finalize | Known USD estimate |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...summary.map(
        (entry) =>
          `| ${entry.provider} | ${entry.planned} | ${entry.attempted} | ${entry.completed} | ${entry.evidenceMatches ?? "n/a"} | ${entry.nextMatches ?? "n/a"} | ${entry.exactMatches ?? "n/a"} | ${entry.unsafeFinalizations ?? "n/a"} | ${entry.estimatedKnownCostUsd.toFixed(8)} |`,
      ),
      "",
      "## Per-case results",
      "",
      "| Case | Provider | Status | Evidence correct | Next correct | Unsafe finalize |",
      "| --- | --- | --- | --- | --- | --- |",
      ...rows.map(
        (row) =>
          `| ${row.caseId} | ${row.provider} | ${row.status} | ${row.grade?.evidenceMatch ?? "n/a"} | ${row.grade?.nextMatch ?? "n/a"} | ${row.grade?.unsafeFinalize ?? "n/a"} |`,
      ),
      "",
    ].join("\n");
    await writeFile(resolve(directory, "report.md"), table, { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ directory, stopCode: stopCode ?? null, summary }, null, 2));
  }
  if (stopCode) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  // Never print provider bodies, configuration values, or exception messages.
  const code =
    error instanceof EvaluationFailure ? error.code : "EVALUATION_SETUP_OR_STORAGE_FAILED";
  console.error(JSON.stringify({ code }));
  process.exitCode = 1;
});
