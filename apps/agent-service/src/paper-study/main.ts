import { readFile, access, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { config as dotenv } from "dotenv";
import {
  PilotError,
  STUDY_PLUGINS,
  recoverStudy,
  hasUnsettledStudyRouting,
  runStudyCase,
  settleStudy,
  type StudyState,
  type StudyKind,
  type StudyPlugin,
  type StudyPorts,
} from "@pickler/core";
import { PolymarketStudyData, PolymarketPaperResolution } from "@pickler/infrastructure";
import { createJevStudyModel } from "@pickler/agent-runtime/composition/jev-study-model";
import { readConfig, lockStudy, saveStudy, atomicWrite } from "./files.js";

const [command, configArgument, approval] = process.argv.slice(2);
if (!configArgument || !["preflight", "run", "report"].includes(command ?? "")) {
  throw new Error("Usage: paper:study preflight|report|run CONFIG.json [--allow-paid]");
}
const path = resolve(configArgument);
const configuration = await readConfig(path);
const directory = resolve(".data/paper-studies", configuration.id);
const original = JSON.stringify(configuration);
let stopRequested = false;
async function guard(kind: StudyKind, plugin?: StudyPlugin) {
  if (command === "run") {
    for (const name of await readdir(resolve(".data/paper-studies"))) {
      const raw = await readFile(resolve(".data/paper-studies", name, "state.json"), "utf8").catch(
        (e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT" || e.code === "ENOTDIR") {
            return "null";
          }
          throw e;
        },
      );
      if ((JSON.parse(raw)?.version ?? 1) >= 4) {
        throw new Error("LEGACY_RUN_CANNOT_ACCOUNT_FOR_V4_CAMPAIGN");
      }
    }
  }
  if (stopRequested) {
    throw new PilotError("STUDY_STOPPED", "Operator stopped the study");
  }
  try {
    await access(join(directory, "STOP"));
    throw new PilotError("STUDY_STOPPED", "Operator stopped the study");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  const current = await readConfig(path);
  if (JSON.stringify(current) !== original) {
    throw new PilotError(
      "CONFIG_CHANGED",
      "Configuration changed; create a new study after reviewing its budget",
    );
  }
  const agent = current.agents.find((a) => a.kind === kind);
  if (!agent?.enabled || (plugin && !agent.plugins.includes(plugin))) {
    throw new PilotError("PLUGIN_DISABLED", "Study capability disabled");
  }
}
if (command === "report") {
  const release = await lockStudy(directory);
  try {
    await saveStudy(
      directory,
      JSON.parse(await readFile(join(directory, "state.json"), "utf8")) as StudyState,
    );
  } finally {
    await release();
  }
} else if (command === "preflight") {
  const data = new PolymarketStudyData("", guard);
  for (const agent of configuration.agents.filter((a) => a.enabled)) {
    try {
      const markets = await data.discover(agent.kind, AbortSignal.timeout(55000));
      console.log(JSON.stringify({ kind: agent.kind, eligibleMarkets: markets.length }));
    } catch (error) {
      console.log(
        JSON.stringify({
          kind: agent.kind,
          error: error instanceof PilotError ? error.code : "CONNECTION_FAILED",
        }),
      );
      process.exitCode = 1;
    }
  }
} else {
  if (approval !== "--allow-paid" || !configuration.pricing?.jevInputPerMillion) {
    throw new Error(
      "Explicit --allow-paid and current DeepSeek/Jev/Exa pricing are required; no calls made",
    );
  }
  dotenv({ path: resolve(".env"), quiet: true });
  for (const key of [
    "TYPESAFE_API_KEY",
    "MODEL_BASE_URL",
    "MODEL_ID",
    "MODEL_API_KEY",
    ...(configuration.agents.some((a) => a.enabled && a.kind === "sports") ? ["EXA_API_KEY"] : []),
  ]) {
    if (!process.env[key]) {
      throw new Error(`Missing ${key}`);
    }
  }
  const release = await lockStudy(directory);
  try {
    const model = createJevStudyModel(
      {
        TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY!,
        MODEL_BASE_URL: process.env.MODEL_BASE_URL!,
        MODEL_ID: process.env.MODEL_ID!,
        MODEL_API_KEY: process.env.MODEL_API_KEY!,
      },
      guard,
    );
    let state: StudyState;
    try {
      state = JSON.parse(await readFile(join(directory, "state.json"), "utf8")) as StudyState;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
      state = {
        version: 1,
        config: configuration,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        cases: [],
        events: [],
        model: model.metadata,
        plugins: STUDY_PLUGINS,
      };
    }
    if (
      state.version !== 1 ||
      JSON.stringify(state.plugins) !== JSON.stringify(STUDY_PLUGINS) ||
      JSON.stringify(state.config) !== original ||
      JSON.stringify(state.model) !== JSON.stringify(model.metadata)
    ) {
      throw new Error("STUDY_SNAPSHOT_CHANGED");
    }
    recoverStudy(state, Date.now());
    const save = () => saveStudy(directory, state);
    await save();
    const data = new PolymarketStudyData(process.env.EXA_API_KEY ?? "", guard);
    const resolution = new PolymarketPaperResolution();
    let currentKind: StudyKind = "btc-5m";
    const ports: StudyPorts = {
      now: Date.now,
      save,
      guard,
      discover: (kind, signal) => data.discover(kind, signal),
      evidence: (item, signal, usage) => data.evidence(item, signal, usage),
      forecast: model.forecast,
      refresh: (item, signal) => data.refresh(item, signal),
      book: (outcome, signal) => data.markets(currentKind).book(outcome, signal),
      conditions: (market, outcome, signal) =>
        data.markets(currentKind).conditions(market, outcome, signal),
      resolution: (order, signal, check) => resolution.resolution(order, signal, check),
    };
    let stopping = false;
    const stop = () => {
      stopping = true;
      stopRequested = true;
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    try {
      const deadline = state.createdAt + configuration.hours * 3600000;
      const finalDeadline = deadline + configuration.settlementGraceHours * 3600000;
      while (!stopping && Date.now() < finalDeadline) {
        for (const agent of configuration.agents.filter((a) => a.enabled)) {
          await guard(agent.kind);
          const previous =
            state.events
              .filter((e) => e.kind === agent.kind && e.code.startsWith("DISCOVERY_"))
              .at(-1)?.time ?? 0;
          const period =
            agent.kind === "sports" ? 3600000 : agent.kind === "btc-5m" ? 300000 : 900000;
          if (
            Date.now() >= deadline ||
            state.cases.length >= configuration.maxCases ||
            (agent.kind === "sports"
              ? Date.now() - previous < period
              : Math.floor(previous / period) >= Math.floor(Date.now() / period))
          ) {
            continue;
          }
          state.events.push({ time: Date.now(), kind: agent.kind, code: "DISCOVERY_STARTED" });
          await save();
          try {
            const candidates = await ports.discover(agent.kind, AbortSignal.timeout(55000));
            const candidate = candidates.find(
              (item) => !state.cases.some((row) => row.marketId === item.market.id),
            );
            if (candidate) {
              currentKind = agent.kind;
              await runStudyCase(state, candidate, ports);
              if (hasUnsettledStudyRouting(state)) {
                await atomicWrite(join(directory, "STOP"), "STUDY_ROUTING_REVIEW_REQUIRED");
                stop();
                break;
              }
            } else {
              state.events.push({
                time: Date.now(),
                kind: agent.kind,
                code: "NO_ELIGIBLE_MARKETS",
              });
            }
          } catch (error) {
            state.events.push({
              time: Date.now(),
              kind: agent.kind,
              code: error instanceof PilotError ? error.code : "PROVIDER_FAILED",
            });
          }
          await save();
        }
        if (stopping) {
          break;
        }
        await settleStudy(state, ports);
        await save();
        if (
          Date.now() >= deadline &&
          !state.cases.some((row) => row.paper && !row.paper.settlement)
        ) {
          break;
        }
        await setTimeout(15000);
      }
      state.events.push({
        time: Date.now(),
        kind: "session",
        code: stopping ? "STOPPED" : "SESSION_FINISHED",
      });
      await save();
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
    console.log(`Report: ${join(directory, "index.html")}`);
  } finally {
    await release();
  }
}
