import { createRuntime, type Environment } from "@pickler/agent-runtime";
import { researchDatabase } from "./database.js";
import { createResearchWorker } from "./worker.js";
import { PostgresResearchStore } from "@pickler/infrastructure";

export interface Env extends Environment {
  APP_ENV: string;
  TRADING_QUEUE?: Queue<{ kind: "trading-wakeup" }>;
  DATABASE?: Hyperdrive;
  RESEARCH_QUEUE: Queue<{ kind: "research-wakeup" }>;
  ADMISSIONS_ENABLED: string;
}

export default createResearchWorker({
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
