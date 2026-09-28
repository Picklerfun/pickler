import { runBenchmarkLoop, reconcileCases } from "@pickler/trading/evaluation";
import { readFile, mkdir, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { config as dotenv } from "dotenv";
import { z } from "zod";
import {
  BENCHMARK_PROTOCOL,
  benchmarkEvaluationReady,
  comparisonSlots,
  settleBenchmarkCase,
  recoverBenchmark,
  reserveBenchmarkReviews,
  performBenchmarkReview,
  quantForecast,
  quantProposal,
  type BenchmarkState,
  type BenchmarkPorts,
  type QuantPlugin,
} from "@pickler/trading/strategies";
import { PilotError } from "@pickler/core";
import {
  QuantData,
  PolymarketPaperResolution,
  comparisonTransport,
  type PublicRequestDiagnostic,
} from "@pickler/infrastructure";
import {
  createQuantReviewer,
  quantReviewPrompt,
} from "@pickler/agent-runtime/composition/quant-review";
import {
  createCompactQuantReviewer,
  compactQuantPrompt,
} from "@pickler/agent-runtime/composition/compact-quant-review";
import { atomicWrite, lockStudy } from "./files.js";
import { keepAwake, historicalReservations, serialExecutor } from "./comparison-host.js";
import { comparisonProbeInput } from "./comparison-probe.js";
import {
  prepareBenchmarkScenarios,
  verifyBenchmarkScenarios,
  sha256,
  type BenchmarkScenario,
} from "./benchmark-cases.js";
import { saveBenchmark, compareBenchmarkStudies } from "./benchmark-report.js";

export const benchmarkConfigSchema = z
  .object({
    version: z.literal(4),
    protocol: z.literal(BENCHMARK_PROTOCOL),
    id: z.string().regex(/^[a-z0-9-]{1,60}$/),
    plugins: z
      .array(z.enum(["polymarket", "coinbase", "jev"]))
      .refine((p) => new Set(p).size === p.length),
    jevInputPerMillion: z.number().positive(),
    maxNewReservedUsd: z.number().positive().max(1.25),
    invalidAnswerPolicy: z.enum(["stop-study", "block-case"]).optional(),
    historicalStudies: z
      .array(z.string().regex(/^[a-z0-9-]{1,60}$/))
      .refine((p) => new Set(p).size === p.length),
  })
  .strict();
const experiment = {
  protocol: BENCHMARK_PROTOCOL,
  hours: 6,
  maxCalls: 386,
  maxFiveMinute: 72,
  maxFifteenMinute: 24,
  virtualUnits: 10,
  minimumEdgeExclusive: 0.03,
  vetoThreshold: 0.9,
  maxConcurrent: 2,
  seed: 20260928,
  bootstrapReplicates: 2000,
};
const reviewers = {
  current: { model: "jev-1.13.0", version: "1.1.0", prompt: quantReviewPrompt },
  compact: { model: "jev-1.13.0", version: "1.0.0", prompt: compactQuantPrompt },
};
export async function runBtcBenchmark(
  args: string[],
  options: { signal?: AbortSignal; root?: string; envFile?: string } = {},
) {
  options.signal?.throwIfAborted();
  const [command, argument, ...extra] = args;
  if (
    !argument ||
    !["prepare", "diagnose", "evaluate", "run", "settle", "report", "compare"].includes(
      command ?? "",
    )
  ) {
    throw new Error(
      "Usage: paper:benchmark prepare|evaluate|run|settle|report CONFIG [--allow-paid] | diagnose CONFIG --case CASE_ID --allow-paid | compare OUTPUT_DIRECTORY STATE...",
    );
  }
  if (command === "compare") {
    console.log(await compareBenchmarkStudies(argument, extra));
  } else {
    const path = resolve(argument),
      configuration = benchmarkConfigSchema.parse(JSON.parse(await readFile(path, "utf8"))),
      original = JSON.stringify(configuration);
    const root = options.root ?? resolve(".data/paper-studies"),
      directory = join(root, configuration.id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const release = await lockStudy(directory);
    let campaignRelease: (() => Promise<void>) | undefined, awakeRelease: (() => void) | undefined;
    let stopping = false;
    const stop = () => {
      stopping = true;
    };
    options.signal?.addEventListener("abort", stop, { once: true });
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    try {
      options.signal?.throwIfAborted();
      const guard = async (plugin: QuantPlugin) => {
        options.signal?.throwIfAborted();
        if (
          JSON.stringify(benchmarkConfigSchema.parse(JSON.parse(await readFile(path, "utf8")))) !==
          original
        ) {
          throw new PilotError("CONFIG_CHANGED", "Configuration changed");
        }
        if (!configuration.plugins.includes(plugin)) {
          throw new PilotError("PLUGIN_DISABLED", plugin);
        }
        if (command === "diagnose" || command === "evaluate" || command === "run") {
          if (stopping) {
            throw new PilotError("STUDY_STOPPED", "Stopped");
          }
          try {
            await access(join(directory, "STOP"));
            throw new PilotError("STUDY_STOPPED", "Stopped");
          } catch (e) {
            if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT")) {
              throw e;
            }
          }
        }
      };
      const exclusive = serialExecutor(),
        write = serialExecutor();
      let state: BenchmarkState;
      let scenarios: BenchmarkScenario[];
      if (command === "prepare") {
        try {
          await access(join(directory, "state.json"));
          throw new Error("STUDY_ALREADY_EXISTS");
        } catch (e) {
          if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT")) {
            throw e;
          }
        }
        const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
        if (
          execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
            encoding: "utf8",
          }).trim()
        ) {
          throw new Error("COMMIT_BEFORE_FREEZING_EXPERIMENT");
        }
        scenarios = prepareBenchmarkScenarios();
        const scenariosHash = sha256(JSON.stringify(scenarios));
        await atomicWrite(join(directory, "scenarios.json"), JSON.stringify(scenarios, null, 2));
        await atomicWrite(
          join(directory, "configuration.json"),
          JSON.stringify({ configuration, reviewers, experiment, commit, scenariosHash }, null, 2),
        );
        state = {
          version: 4,
          protocol: BENCHMARK_PROTOCOL,
          id: configuration.id,
          createdAt: Date.now(),
          deadline: null,
          settlementDeadline: null,
          priorReservedUsd: 0,
          maxNewReservedUsd: configuration.maxNewReservedUsd,
          jevInputPerMillion: configuration.jevInputPerMillion,
          paidStopped: null,
          invalidAnswerPolicy: configuration.invalidAnswerPolicy ?? "stop-study",
          evaluation: "pending",
          reviews: [],
          cases: [],
          slots: [],
          interruptions: [],
        };
      } else {
        state = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
        scenarios = JSON.parse(await readFile(join(directory, "scenarios.json"), "utf8"));
        verifyBenchmarkScenarios(scenarios);
        if (
          state.version !== 4 ||
          state.protocol !== BENCHMARK_PROTOCOL ||
          state.id !== configuration.id ||
          state.maxNewReservedUsd !== configuration.maxNewReservedUsd ||
          state.jevInputPerMillion !== configuration.jevInputPerMillion ||
          (state.invalidAnswerPolicy ?? "stop-study") !==
            (configuration.invalidAnswerPolicy ?? "stop-study")
        ) {
          throw new Error("BENCHMARK_STATE_MISMATCH");
        }
      }
      const save = () => {
        const snapshot = structuredClone(state);
        return write(() => saveBenchmark(directory, snapshot, scenarios));
      };
      if (command === "prepare" || command === "report") {
        await save();
      } else {
        const diagnostics: PublicRequestDiagnostic[] = await readFile(
          join(directory, "requests.json"),
          "utf8",
        )
          .then(JSON.parse)
          .catch((e: NodeJS.ErrnoException) => {
            if (e.code === "ENOENT") {
              return [];
            }
            throw e;
          });
        const transport = comparisonTransport({
          guard,
          report: async (r) => {
            diagnostics.push(r);
            const snapshot = JSON.stringify(diagnostics, null, 2);
            await write(() => atomicWrite(join(directory, "requests.json"), snapshot));
          },
        });
        const resolver = new PolymarketPaperResolution(transport);
        const settlement = () =>
          reconcileCases(state.cases, {
            resolver,
            guard: () => guard("polymarket"),
            save,
            now: Date.now,
            signal: options.signal ?? new AbortController().signal,
            settle: settleBenchmarkCase,
          });
        if (command === "settle") {
          recoverBenchmark(state, Date.now());
          await save();
          await settlement();
          await save();
        } else {
          if (
            command === "diagnose"
              ? extra.length !== 3 ||
                extra[0] !== "--case" ||
                !scenarios.some((c) => c.id === extra[1]) ||
                extra[2] !== "--allow-paid"
              : extra.length !== 1 || extra[0] !== "--allow-paid"
          ) {
            throw new Error("EXPLICIT_PAID_APPROVAL_REQUIRED");
          }
          campaignRelease = await lockStudy(join(root, "quant-campaign"));
          const known = await historicalReservations(
            root,
            state.id,
            configuration.historicalStudies,
          );
          state.priorReservedUsd = known.reduce((s, k) => s + k.reserved, 0);
          state.priorBenchmarkReservedUsd = known
            .filter((k) => k.benchmarkReviews !== undefined)
            .reduce((s, k) => s + k.reserved, 0);
          state.priorBenchmarkReviewCount = known.reduce(
            (s, k) => s + (k.benchmarkReviews ?? 0),
            0,
          );
          if (state.priorReservedUsd + state.maxNewReservedUsd > 5 + 1e-12) {
            throw new Error("CAMPAIGN_BUDGET_EXCEEDED");
          }
          const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
          if (
            execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
              encoding: "utf8",
            }).trim()
          ) {
            throw new Error("COMMIT_BEFORE_PAID_ACCEPTANCE");
          }
          const expected = {
            configuration,
            reviewers,
            experiment,
            commit,
            scenariosHash: sha256(JSON.stringify(scenarios)),
          };
          if (
            JSON.stringify(
              JSON.parse(await readFile(join(directory, "configuration.json"), "utf8")),
            ) !== JSON.stringify(expected)
          ) {
            throw new Error("FROZEN_EXPERIMENT_CHANGED");
          }
          await atomicWrite(
            join(directory, "campaign-link.json"),
            JSON.stringify(
              {
                priorStudies: known,
                originalCeilingUsd: 5,
                priorReservedUsd: state.priorReservedUsd,
              },
              null,
              2,
            ),
          );
          await guard("jev");
          if (state.paidStopped) {
            throw new Error("PAID_ADMISSIONS_ALREADY_STOPPED");
          }
          dotenv({ path: options.envFile ?? resolve(".env"), quiet: true });
          const reviewerGuard = async () => {
            await guard("jev");
            if (state.paidStopped) {
              throw new PilotError("PAID_ADMISSIONS_STOPPED", "Stopped");
            }
          };
          const current = createQuantReviewer(process.env.TYPESAFE_API_KEY ?? "", reviewerGuard),
            compact = createCompactQuantReviewer(process.env.TYPESAFE_API_KEY ?? "", reviewerGuard);
          const data = new QuantData(guard, transport);
          const ports: BenchmarkPorts = {
            now: Date.now,
            guard,
            save,
            exclusive,
            hash: async (v) => sha256(v),
            versions: {
              current: JSON.stringify(current.metadata),
              compact: JSON.stringify(compact.metadata),
            },
            input: (i, s) => data.input(i, s),
            refresh: (i, s) => data.study.refresh(i, s),
            review: (name, i, f, p, s, report) =>
              (name === "current" ? current : compact).review(i, f, p, s, report),
          };
          if (command === "evaluate" || command === "diagnose") {
            if (state.evaluation !== "pending" || state.reviews.length) {
              throw new Error("EVALUATION_ALREADY_ATTEMPTED_NO_RETRY");
            }
            state.evaluation = "started";
            await save();
            const input = comparisonProbeInput(Date.now()),
              forecast = quantForecast(input, input.observedAt),
              proposal = quantProposal(input, forecast, input.observedAt, "central-v1").proposal!;
            const cases =
              command === "diagnose"
                ? [scenarios.find((c) => c.id === extra[1])!]
                : [
                    { id: "contract", split: "contract" as const, input, forecast, proposal },
                    ...scenarios,
                  ];
            for (const c of cases) {
              const names: ("current" | "compact")[] =
                command === "diagnose" ? ["current"] : ["current", "compact"];
              const requests = names.map((reviewer) => ({
                id: `${c.id}:${reviewer}`,
                phase: command === "diagnose" ? ("contract" as const) : c.split,
                caseId: c.id,
                reviewer,
                version: ports.versions[reviewer],
                contextHash: sha256(
                  JSON.stringify({
                    input: c.input,
                    forecast: c.forecast,
                    proposal: c.proposal,
                    reviewer: ports.versions[reviewer],
                  }),
                ),
              }));
              if (!(await reserveBenchmarkReviews(state, requests, ports))) {
                break;
              }
              for (const request of requests) {
                await performBenchmarkReview(
                  state,
                  state.reviews.find((r) => r.id === request.id)!,
                  c.input,
                  c.forecast,
                  c.proposal,
                  ports,
                  AbortSignal.timeout(40000),
                );
                if (state.paidStopped) {
                  break;
                }
              }
              console.log(
                JSON.stringify({
                  phase: c.split,
                  case: c.id,
                  completedCalls: state.reviews.filter((r) => r.result?.status === "completed")
                    .length,
                  paidStopped: state.paidStopped,
                }),
              );
              if (state.paidStopped) {
                break;
              }
            }
            if (state.paidStopped) {
              state.evaluation = "failed";
            } else {
              state.evaluation = state.reviews.some((r) => r.result?.status === "failed")
                ? "completed_with_errors"
                : "completed";
            }
            await save();
            if (state.paidStopped) {
              await atomicWrite(join(directory, "STOP"), `${state.paidStopped}\n`);
              process.exitCode = 1;
            }
          } else {
            if (!benchmarkEvaluationReady(state)) {
              throw new Error("TECHNICAL_EVALUATION_NOT_COMPLETE");
            }
            if (state.deadline !== null) {
              throw new Error("RUN_ALREADY_STARTED_NO_AUTOMATIC_RESUME");
            }
            awakeRelease = await keepAwake();
            const started = Date.now();
            state.deadline = started + 21600000;
            state.settlementDeadline = state.deadline + 86400000;
            state.slots = comparisonSlots(started, state.deadline);
            await save();
            await runBenchmarkLoop(state, {
              ports,
              signal: options.signal ?? new AbortController().signal,
              discover: (kind, signal) => data.study.discover(kind, signal),
              guard,
              save,
              settle: settlement,
              stopped: () => stopping,
              admissionEnded: () => {
                awakeRelease?.();
                awakeRelease = undefined;
              },
              now: Date.now,
              sleep: (ms) => setTimeout(ms),
            });
            if (Date.now() >= state.deadline) {
              await atomicWrite(join(directory, "STOP"), "ADMISSIONS_COMPLETE\n");
            }
            await save();
          }
        }
      }
      console.log(`Report: ${join(directory, "index.html")}`);
    } finally {
      awakeRelease?.();
      options.signal?.removeEventListener("abort", stop);
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      await campaignRelease?.();
      await release();
    }
  }
}
