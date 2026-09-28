import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { compareDecisionAttempts, type AttemptInput } from "./evaluation/decision-comparison";
import { EvaluationFailure } from "./evaluation/decision-evaluation";

async function main() {
  const { values } = parseArgs({
    options: {
      attempt: { type: "string", multiple: true },
      output: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (!values.attempt?.length || !values.output) {
    throw new EvaluationFailure("ATTEMPTS_AND_OUTPUT_REQUIRED");
  }
  const output = resolve(values.output);
  if (!output.split("/").includes(".data")) {
    throw new EvaluationFailure("OUTPUT_MUST_BE_IN_LOCAL_DATA_DIRECTORY");
  }
  const inputs: AttemptInput[] = [];
  for (const path of values.attempt) {
    const directory = resolve(path);
    const manifest: unknown = JSON.parse(
      await readFile(resolve(directory, "manifest.json"), "utf8"),
    );
    // Validate IDs before using them in filenames. Only explicit completed-result files are read.
    const header = z
      .object({
        cases: z.array(
          z.object({
            id: z.string().regex(/^[a-z0-9-]{1,80}$/),
          }),
        ),
      })
      .parse(manifest);
    const results: unknown[] = [];
    for (const item of header.cases) {
      for (const provider of ["jev", "llm"]) {
        try {
          const result: unknown = JSON.parse(
            await readFile(resolve(directory, `${item.id}-${provider}.json`), "utf8"),
          );
          const identity = z
            .object({ caseId: z.literal(item.id), provider: z.literal(provider) })
            .safeParse(result);
          if (!identity.success) {
            throw new EvaluationFailure("COMPARISON_RESULT_IDENTITY_MISMATCH");
          }
          results.push(result);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
      }
    }
    inputs.push({ manifest, results });
  }
  const report = compareDecisionAttempts(inputs);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ output, ...report, rows: undefined }, null, 2));
}
main().catch((error: unknown) => {
  console.error(
    JSON.stringify({ code: error instanceof EvaluationFailure ? error.code : "COMPARISON_FAILED" }),
  );
  process.exitCode = 1;
});
