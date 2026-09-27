import { readFile, mkdir, readdir, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { createHash } from "node:crypto";
import { config as dotenv } from "dotenv";
import { z } from "zod";
import {
  PilotError,
  runQuantCase,
  settlePaperOrder,
  type QuantState,
  type QuantPlugin,
  type PaperOrder,
} from "@pickler/core";
import { QuantData, PolymarketPaperResolution } from "@pickler/infrastructure";
import { createQuantReviewer } from "@pickler/agent-runtime/composition/quant-review";
import { lockStudy, atomicWrite } from "./files.js";
import { saveQuant } from "./quant-report.js";
import { historicalQuant } from "./quant-history.js";
const schema = z
  .object({
    version: z.literal(2),
    protocol: z.literal("btc-quant-jev-v1"),
    id: z.string().regex(/^[a-z0-9-]{1,60}$/),
    plugins: z
      .array(z.enum(["polymarket", "coinbase", "jev"]))
      .refine((v) => new Set(v).size === v.length),
    jevInputPerMillion: z.number().positive(),
    maxNewReservedUsd: z.number().positive().max(0.1),
    historicalStudies: z.array(z.string().regex(/^[a-z0-9-]{1,60}$/)),
  })
  .strict();
const [command, argument, approval] = process.argv.slice(2);
if (!argument || !["preflight", "history", "run", "settle", "report"].includes(command ?? "")) {
  throw new Error("Usage: paper:quant preflight|history|run|settle|report CONFIG [--allow-paid]");
}
const path = resolve(argument),
  configuration = schema.parse(JSON.parse(await readFile(path, "utf8"))),
  original = JSON.stringify(configuration);
const root = resolve(".data/paper-studies"),
  directory = join(root, configuration.id);
await mkdir(directory, { recursive: true, mode: 0o700 });
let stopping = false;
const guard = async (plugin: QuantPlugin) => {
  if (JSON.stringify(schema.parse(JSON.parse(await readFile(path, "utf8")))) !== original) {
    throw new PilotError("CONFIG_CHANGED", "Configuration changed");
  }
  if (!configuration.plugins.includes(plugin)) {
    throw new PilotError("PLUGIN_DISABLED", plugin);
  }
  // Read-only settlement ignores purchase STOP, but still respects plugin permissions.
  if (command !== "settle" && command !== "report") {
    if (stopping) {
      throw new PilotError("STUDY_STOPPED", "Stopped");
    }
    try {
      await access(join(directory, "STOP"));
      throw new PilotError("STUDY_STOPPED", "Stopped");
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  }
};
const data = new QuantData(guard),
  resolver = new PolymarketPaperResolution();
if (command === "history") {
  await historicalQuant(data, directory);
  process.exit(0);
}
if (command === "preflight") {
  for (const kind of ["btc-5m", "btc-15m"] as const) {
    const markets = await data.study.discover(kind, AbortSignal.timeout(45000));
    console.log(JSON.stringify({ kind, eligible: markets.length }));
    if (markets[0]) {
      const input = await data.input(markets[0], AbortSignal.timeout(45000));
      console.log(
        JSON.stringify({
          kind,
          lookback: input.rule.lookbackSeconds,
          candles: input.candles.length,
          tickerAgeMs: Date.now() - input.ticker.observedAt,
        }),
      );
    }
  }
  process.exit(0);
}
const release = await lockStudy(directory);
let campaignRelease: (() => Promise<void>) | undefined;
try {
  let state: QuantState;
  try {
    state = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  } catch (error) {
    if (
      !(error && typeof error === "object" && "code" in error && error.code === "ENOENT") ||
      command !== "run"
    ) {
      throw error;
    }
    state = {
      version: 2,
      protocol: "btc-quant-jev-v1",
      id: configuration.id,
      createdAt: Date.now(),
      deadline: Date.now() + 2 * 3600000,
      settlementDeadline: Date.now() + 26 * 3600000,
      priorReservedUsd: 0,
      maxNewReservedUsd: configuration.maxNewReservedUsd,
      jevInputPerMillion: configuration.jevInputPerMillion,
      cases: [],
      paidStopped: false,
    };
  }
  if (
    state.version !== 2 ||
    state.protocol !== configuration.protocol ||
    state.id !== configuration.id
  ) {
    throw new Error("QUANT_STATE_MISMATCH");
  }
  const save = () => saveQuant(directory, state);
  const settlement = async () => {
    for (const row of state.cases
      .filter(
        (r) => r.forecast && r.identities && !r.resolution && r.nextResolutionAt <= Date.now(),
      )
      .slice(0, 4)) {
      try {
        const up = row.forecast!.probabilities.find((p) => p.label === "Up")!;
        const identity = row.identities!.find((i) => i.outcomeId === up.outcomeId)!;
        const result = await resolver.resolutionFor(identity, AbortSignal.timeout(20000), () =>
          guard("polymarket"),
        );
        if (result) {
          if (row.fill) {
            const order: PaperOrder = {
              id: row.id,
              tenantId: `local-study:${state.id}`,
              agentId: row.kind,
              runId: row.id,
              marketId: row.marketId,
              outcomeId: row.fill.book.outcomeId,
              status: "filled",
              virtualBudget: "10",
              createdAt: row.startedAt,
              finishedAt: row.finishedAt,
              reason: null,
              fill: row.fill,
            };
            const resolution =
              order.outcomeId === up.outcomeId
                ? result
                : await resolver.resolution(order, AbortSignal.timeout(20000), () =>
                    guard("polymarket"),
                  );
            if (!resolution) {
              throw new PilotError("PAPER_RESOLUTION_UNAVAILABLE", "Other outcome pending");
            }
            const settled = settlePaperOrder(order, resolution, Date.now());
            row.settlement = { payout: settled.payout, realizedPnl: settled.realizedPnl };
          }
          row.resolution = result;
          delete row.resolutionError;
        }
      } catch (error) {
        row.resolutionError = error instanceof PilotError ? error.code : "RESOLUTION_FAILED";
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
      throw new Error("Explicit --allow-paid required");
    }
    campaignRelease = await lockStudy(join(root, "quant-campaign"));
    // Every previous study must be declared. Never reset the shared five-dollar authorization.
    const known = [];
    for (const name of await readdir(root)) {
      if (name === configuration.id || name === "quant-campaign") {
        continue;
      }
      try {
        const s = JSON.parse(await readFile(join(root, name, "state.json"), "utf8"));
        known.push({
          name,
          reserved: (s.cases as { reservedApiUsd?: number; reservedUsd?: number }[]).reduce(
            (a, c) => a + (c.reservedApiUsd ?? c.reservedUsd ?? 0),
            0,
          ),
        });
      } catch (error) {
        if (!(
          error &&
          typeof error === "object" &&
          "code" in error &&
          ["ENOENT", "ENOTDIR"].includes(String(error.code))
        )) {
          throw error;
        }
      }
    }
    if (known.some((k) => !configuration.historicalStudies.includes(k.name))) {
      throw new Error("UNDECLARED_HISTORICAL_BUDGET");
    }
    const prior = known.reduce((a, k) => a + k.reserved, 0);
    if (prior + configuration.maxNewReservedUsd > 5) {
      throw new Error("CAMPAIGN_BUDGET_EXCEEDED");
    }
    dotenv({ path: resolve(".env"), quiet: true });
    const reviewer = createQuantReviewer(process.env.TYPESAFE_API_KEY ?? "", () => guard("jev"));
    const snapshot = { configuration, reviewer: reviewer.metadata };
    const snapshotPath = join(directory, "configuration.json");
    try {
      if ((await readFile(snapshotPath, "utf8")) !== JSON.stringify(snapshot, null, 2)) {
        throw new Error("QUANT_SNAPSHOT_CHANGED");
      }
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
      await atomicWrite(snapshotPath, JSON.stringify(snapshot, null, 2));
    }
    state.priorReservedUsd = prior;
    for (const row of state.cases) {
      if (row.status === "started") {
        row.status = "interrupted";
        row.reason = "INTERRUPTED";
        row.finishedAt = Date.now();
        if (row.reservedUsd) {
          state.paidStopped = true;
        }
      }
    }
    await atomicWrite(
      join(directory, "campaign-link.json"),
      JSON.stringify(
        {
          priorStudies: known,
          priorReservedUsd: prior,
          originalCeilingUsd: 5,
          configSha256: createHash("sha256").update(original).digest("hex"),
        },
        null,
        2,
      ),
    );
    await save();
    const stop = () => {
      stopping = true;
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    const visited = new Set<string>(
      state.cases.map((c) => `${c.kind}:${c.input?.item.windowStart ?? 0}`),
    );
    try {
      while (!stopping && Date.now() < state.settlementDeadline) {
        try {
          await access(join(directory, "STOP"));
          break;
        } catch (error) {
          if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
            throw error;
          }
        }
        if (Date.now() < state.deadline && !state.paidStopped) {
          for (const kind of ["btc-5m", "btc-15m"] as const) {
            const period = kind === "btc-5m" ? 300000 : 900000,
              start = Math.floor(Date.now() / period) * period,
              key = `${kind}:${start}`;
            // One admission slot per window: first minute plus a 30-second scheduling tolerance.
            if (Date.now() < start + 60000 || Date.now() > start + 90000 || visited.has(key)) {
              continue;
            }
            visited.add(key);
            try {
              const items = await data.study.discover(kind, AbortSignal.timeout(30000));
              if (items[0]) {
                await runQuantCase(state, items[0], {
                  now: Date.now,
                  save,
                  guard,
                  input: (i, s) => data.input(i, s),
                  refresh: (i, s) => data.study.refresh(i, s),
                  review: reviewer.review,
                });
              }
            } catch (error) {
              await atomicWrite(
                join(directory, "last-error.json"),
                JSON.stringify({
                  at: Date.now(),
                  kind,
                  code: error instanceof PilotError ? error.code : "DISCOVERY_FAILED",
                }),
              );
            }
            if (state.paidStopped) {
              await atomicWrite(join(directory, "STOP"), "PAID_REVIEW_FAILED\n");
              break;
            }
          }
        }
        // Failures stop new work; explicit settle remains available without model credentials.
        if (state.paidStopped) {
          break;
        }
        await settlement();
        if (Date.now() >= state.deadline && !state.cases.some((c) => c.forecast && !c.resolution)) {
          break;
        }
        await setTimeout(10000);
      }
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      await save();
    }
    if (Date.now() >= state.deadline) {
      await atomicWrite(join(directory, "STOP"), "ADMISSIONS_COMPLETE\n");
    }
  }
  console.log(`Report: ${join(directory, "index.html")}`);
} finally {
  await campaignRelease?.();
  await release();
}
