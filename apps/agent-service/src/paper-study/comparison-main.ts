import { assertLegacyRead } from "../evaluation-host/legacy.js";
assertLegacyRead(process.argv[2], ["replay", "settle", "report"]);
import { readFile, mkdir, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { config as dotenv } from "dotenv";
import { z } from "zod";
import {
  PilotError,
  COMPARISON_PROTOCOL,
  comparisonSlots,
  markMissedSlots,
  runComparisonCase,
  settleComparisonCase,
  type ComparisonState,
  type QuantPlugin,
  type ComparisonPorts,
  type ComparisonCase,
} from "@pickler/core";
import {
  QuantData,
  PolymarketPaperResolution,
  comparisonTransport,
  type PublicRequestDiagnostic,
} from "@pickler/infrastructure";
import { createQuantReviewer } from "@pickler/agent-runtime/composition/quant-review";
import { lockStudy, atomicWrite } from "./files.js";
import { saveComparison, replayComparison } from "./comparison-report.js";
import { comparisonProbeInput, settleComparisonProbe } from "./comparison-probe.js";
import { serialExecutor, historicalReservations, keepAwake } from "./comparison-host.js";
const schema = z
  .object({
    version: z.literal(3),
    protocol: z.literal(COMPARISON_PROTOCOL),
    id: z.string().regex(/^[a-z0-9-]{1,60}$/),
    plugins: z
      .array(z.enum(["polymarket", "coinbase", "jev"]))
      .refine((p) => new Set(p).size === p.length),
    jevInputPerMillion: z.number().positive(),
    maxNewReservedUsd: z.number().positive().max(0.25),
    historicalStudies: z
      .array(z.string().regex(/^[a-z0-9-]{1,60}$/))
      .refine((p) => new Set(p).size === p.length),
  })
  .strict();
const [command, argument, approval] = process.argv.slice(2);
if (!argument || !["replay", "probe", "run", "settle", "report"].includes(command ?? "")) {
  throw new Error(
    "Usage: paper:compare replay STATE | probe|run|settle|report CONFIG [--allow-paid]",
  );
}
// This path does not read configuration, environment, credentials or instantiate providers.
if (command === "replay") {
  console.log(
    JSON.stringify(
      {
        notice: "Retrospective proposals only; no executed purchases or P&L.",
        cases: replayComparison(JSON.parse(await readFile(resolve(argument), "utf8"))),
      },
      null,
      2,
    ),
  );
} else {
  const path = resolve(argument),
    configuration = schema.parse(JSON.parse(await readFile(path, "utf8"))),
    original = JSON.stringify(configuration);
  const root = resolve(".data/paper-studies"),
    directory = join(root, configuration.id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const release = await lockStudy(directory);
  let campaignRelease: (() => Promise<void>) | undefined, awakeRelease: (() => void) | undefined;
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    const guard = async (plugin: QuantPlugin) => {
      if (JSON.stringify(schema.parse(JSON.parse(await readFile(path, "utf8")))) !== original) {
        throw new PilotError("CONFIG_CHANGED", "Configuration changed");
      }
      if (!configuration.plugins.includes(plugin)) {
        throw new PilotError("PLUGIN_DISABLED", plugin);
      }
      if (command === "probe" || command === "run") {
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
    let state: ComparisonState;
    try {
      state = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
    } catch (e) {
      if (
        !(e && typeof e === "object" && "code" in e && e.code === "ENOENT") ||
        command !== "probe"
      ) {
        throw e;
      }
      state = {
        version: 3,
        protocol: COMPARISON_PROTOCOL,
        id: configuration.id,
        createdAt: Date.now(),
        deadline: null,
        settlementDeadline: null,
        priorReservedUsd: 0,
        maxNewReservedUsd: configuration.maxNewReservedUsd,
        jevInputPerMillion: configuration.jevInputPerMillion,
        paidStopped: null,
        cases: [],
        slots: [],
        interruptions: [],
      };
    }
    if (
      state.version !== 3 ||
      state.protocol !== configuration.protocol ||
      state.id !== configuration.id ||
      state.maxNewReservedUsd !== configuration.maxNewReservedUsd ||
      state.jevInputPerMillion !== configuration.jevInputPerMillion
    ) {
      throw new Error("COMPARISON_STATE_MISMATCH");
    }
    const exclusive = serialExecutor(),
      write = serialExecutor();
    const save = () => {
      const snapshot = structuredClone(state);
      return write(() => saveComparison(directory, snapshot));
    };
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
    const data = new QuantData(guard, transport),
      resolver = new PolymarketPaperResolution(transport);
    const settlement = async () => {
      for (const row of state.cases
        .filter(
          (r) =>
            r.forecast &&
            r.identities &&
            r.nextResolutionAt <= Date.now() &&
            r.resolutions.length < r.identities.length,
        )
        .slice(0, 4)) {
        try {
          for (const identity of row.identities!) {
            if (row.resolutions.some((r) => r.outcomeId === identity.outcomeId)) {
              continue;
            }
            const result = await resolver.resolutionFor(identity, AbortSignal.timeout(20000), () =>
              guard("polymarket"),
            );
            if (result) {
              row.resolutions.push(result);
            }
          }
          settleComparisonCase(row, Date.now());
          delete row.resolutionError;
        } catch (e) {
          row.resolutionError = e instanceof PilotError ? e.code : "RESOLUTION_FAILED";
        }
        row.nextResolutionAt = Date.now() + 60000;
        await save();
      }
    };
    if (command === "report") {
      await save();
    } else if (command === "settle") {
      await settlement();
      await save();
    } else {
      if (approval !== "--allow-paid") {
        throw new Error("EXPLICIT_PAID_APPROVAL_REQUIRED");
      }
      campaignRelease = await lockStudy(join(root, "quant-campaign"));
      const known = await historicalReservations(root, state.id, configuration.historicalStudies);
      state.priorReservedUsd = known.reduce((s, k) => s + k.reserved, 0);
      if (state.priorReservedUsd + state.maxNewReservedUsd > 5 + 1e-12) {
        throw new Error("CAMPAIGN_BUDGET_EXCEEDED");
      }
      await guard("jev");
      dotenv({ path: resolve(".env"), quiet: true });
      const reviewer = createQuantReviewer(process.env.TYPESAFE_API_KEY ?? "", async () => {
        await guard("jev");
        if (state.paidStopped) {
          throw new PilotError("PAID_ADMISSIONS_STOPPED", "Paid admissions stopped");
        }
      });
      const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
        encoding: "utf8",
      }).trim();
      if (dirty) {
        throw new Error("COMMIT_IMPLEMENTATION_BEFORE_PAID_ACCEPTANCE");
      }
      const snapshot = JSON.stringify(
        { configuration, reviewer: reviewer.metadata, commit },
        null,
        2,
      );
      try {
        if ((await readFile(join(directory, "configuration.json"), "utf8")) !== snapshot) {
          throw new Error("COMPARISON_SNAPSHOT_CHANGED");
        }
      } catch (e) {
        if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT")) {
          throw e;
        }
        await atomicWrite(join(directory, "configuration.json"), snapshot);
      }
      await atomicWrite(
        join(directory, "campaign-link.json"),
        JSON.stringify(
          {
            priorStudies: known,
            priorReservedUsd: state.priorReservedUsd,
            originalCeilingUsd: 5,
            configSha256: createHash("sha256").update(original).digest("hex"),
          },
          null,
          2,
        ),
      );
      for (const row of [...(state.probe ? [state.probe] : []), ...state.cases]) {
        if (row.status === "started") {
          row.status = "interrupted";
          row.reason = "INTERRUPTED";
          row.finishedAt = Date.now();
          for (const d of row.policies.filter((p) => p.status === "pending")) {
            d.status = "blocked";
            d.reasons = ["INTERRUPTED"];
          }
          if (row.reviews.length) {
            state.paidStopped = "INTERRUPTED_REVIEW";
          }
        }
      }
      for (const slot of state.slots.filter((s) => s.status === "started")) {
        slot.status = "interrupted";
        slot.reason = "INTERRUPTED";
      }
      await save();
      const ports: ComparisonPorts = {
        now: Date.now,
        save,
        guard,
        exclusive,
        reviewerVersion: JSON.stringify(reviewer.metadata),
        input: (i, s) => data.input(i, s),
        refresh: (i, s) => data.study.refresh(i, s),
        review: reviewer.review,
      };
      if (command === "probe") {
        if (state.probe) {
          throw new Error("PROBE_ALREADY_ATTEMPTED_NO_RETRY");
        }
        const input = comparisonProbeInput(Date.now());
        await runComparisonCase(
          state,
          input.item,
          {
            ...ports,
            now: () => input.observedAt,
            input: async () => structuredClone(input),
            refresh: async () => input.item,
          },
          true,
        );
        const probe = state.probe as ComparisonCase | undefined;
        if (probe?.policies.every((p) => p.status === "filled")) {
          settleComparisonProbe(probe, Math.max(Date.now(), input.observedAt));
        } else {
          state.paidStopped ??= "PROBE_NOT_ACCEPTED";
        }
        await save();
        if (state.paidStopped) {
          await atomicWrite(join(directory, "STOP"), `${state.paidStopped}\n`);
          process.exitCode = 1;
        }
      } else {
        if (
          !state.probe ||
          !state.probe.policies.every((p) => p.settlement) ||
          state.probe.reviews.some((r) => r.result?.status !== "completed" || r.result.veto)
        ) {
          throw new Error("LIVE_PROBE_NOT_ACCEPTED");
        }
        awakeRelease = await keepAwake();
        if (state.deadline === null) {
          const started = Date.now();
          state.deadline = started + 7200000;
          state.settlementDeadline = state.deadline + 86400000;
          state.slots = comparisonSlots(started, state.deadline);
          await save();
        }
        const active = new Set<Promise<void>>();
        let previousTick = Date.now();
        let lastReportAt = 0;
        let settlementTask: Promise<void> | undefined;
        try {
          while (!stopping && Date.now() < state.settlementDeadline!) {
            await guard("polymarket");
            const now = Date.now();
            if (now - previousTick > 15000) {
              state.interruptions.push({ at: now, gapMs: now - previousTick });
            }
            previousTick = now;
            markMissedSlots(state, now);
            if (now >= state.deadline) {
              awakeRelease?.();
              awakeRelease = undefined;
            }
            for (const slot of state.slots.filter(
              (s) =>
                s.status === "pending" &&
                now >= s.start + 60000 &&
                now <= s.start + 90000 &&
                now < state.deadline!,
            )) {
              if (active.size >= 2) {
                break;
              }
              slot.status = "started";
              await save();
              const task = (async () => {
                try {
                  const items = await data.study.discover(slot.kind, AbortSignal.timeout(30000));
                  const item = items.find((i) => i.windowStart === slot.start);
                  if (!item) {
                    slot.status = "failed";
                    slot.reason = "NO_ELIGIBLE_MARKET";
                    return;
                  }
                  slot.marketId = item.market.id;
                  await runComparisonCase(state, item, ports);
                  const row = state.cases.find((r) => r.marketId === item.market.id);
                  slot.status = row?.status === "completed" ? "evaluated" : "failed";
                  if (row?.reason) {
                    slot.reason = row.reason;
                  }
                } catch (e) {
                  slot.status = "failed";
                  slot.reason = e instanceof PilotError ? e.code : "DISCOVERY_FAILED";
                } finally {
                  await save();
                }
              })();
              active.add(task);
              void task.then(
                () => active.delete(task),
                () => {
                  stopping = true;
                  active.delete(task);
                },
              );
            }
            // Resolution cannot block admission of coincident windows.
            if (!settlementTask) {
              settlementTask = settlement();
              void settlementTask.then(
                () => {
                  settlementTask = undefined;
                },
                () => {
                  stopping = true;
                  settlementTask = undefined;
                },
              );
            }
            if (now - lastReportAt >= 10000) {
              await save();
              lastReportAt = now;
            }
            if (
              now >= state.deadline &&
              active.size === 0 &&
              !state.cases.some(
                (r) => r.forecast && r.resolutions.length < (r.identities?.length ?? 0),
              )
            ) {
              break;
            }
            await setTimeout(1000);
          }
        } finally {
          stopping = true;
          await Promise.allSettled([...active, ...(settlementTask ? [settlementTask] : [])]);
        }
        if (Date.now() >= state.deadline) {
          await atomicWrite(join(directory, "STOP"), "ADMISSIONS_COMPLETE\n");
        }
        await save();
      }
    }
    console.log(`Report: ${join(directory, "index.html")}`);
  } finally {
    awakeRelease?.();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await campaignRelease?.();
    await release();
  }
}
