import {
  createAdviceRuntime,
  createPerpsRuntime,
  createRuntime,
  type Environment,
} from "@pickler/agent-runtime";
import { researchDatabase } from "./database.js";
import { createResearchWorker, type ResearchMessage } from "./worker.js";
import { PostgresResearchStore } from "@pickler/infrastructure";

export interface Env extends Environment {
  APP_ENV: string;
  ADVICE_ENABLED?: string;
  ADVICE_POLICY_JSON?: string;
  ADVICE_JEV_API_KEY?: string;
  TRADING_QUEUE?: Queue<{ kind: "trading-wakeup" }>;
  DATABASE?: Hyperdrive;
  RESEARCH_QUEUE: Queue<ResearchMessage>;
  ADMISSIONS_ENABLED: string;
  /** The Perpl paper runtime (docs/specs/perpl-paper-runtime-v1.md R3); anything but "true" is off. */
  PERPL_RUNTIME_ENABLED?: string;
  PERPS_RUNTIME_POLICY_JSON?: string;
  PERPS_JEV_API_KEY?: string;
  /** Hourly and manual checks a UTC day across every agent; above it, `RUNTIME_CEILING`. */
  PERPL_RUNTIME_DAILY_CHECKS?: string;
  /** The chain the agent wallets' AUSD is read on (default Monad testnet, as the API). */
  CHAIN_ID?: string;
  MONAD_RPC_URL?: string;
}

export default createResearchWorker({
  adviceRuntime: (env) => {
    const database = researchDatabase(env);
    return createAdviceRuntime({ ...env, DATABASE_URL: database.url }, database.options);
  },
  perpsRuntime: (env) => {
    const database = researchDatabase(env);
    return createPerpsRuntime({ ...env, DATABASE_URL: database.url }, database.options);
  },
  perpsActions: (env) => {
    const database = researchDatabase(env);
    return createPerpsRuntime({ ...env, DATABASE_URL: database.url }, database.options);
  },
  runtime: (env) => {
    if (!env.MODEL_BASE_URL || !env.MODEL_ID || !env.MODEL_API_KEY) {
      throw new Error("Model bindings unavailable");
    }
    const database = researchDatabase(env);
    return createRuntime({ ...env, DATABASE_URL: database.url }, database.options);
  },
  repository: (env) => {
    const database = researchDatabase(env);
    return new PostgresResearchStore(database.url, undefined, database.options);
  },
});
