import { createRuntime, type Environment } from "@pickler/agent-runtime";
import { createResearchWorker } from "./worker.js";
import { PostgresResearchStore } from "@pickler/infrastructure";

export interface Env extends Environment {
  APP_ENV: string;
  RESEARCH_QUEUE: Queue<{ kind: "research-wakeup" }>;
  ADMISSIONS_ENABLED: string;
}

export default createResearchWorker({
  runtime: (env) => {
    if (!env.MODEL_BASE_URL || !env.MODEL_ID || !env.MODEL_API_KEY) {
      throw new Error("Model bindings unavailable");
    }
    return createRuntime({ ...env, APP_ENV: env.APP_ENV || "staging" });
  },
  repository: (env) =>
    new PostgresResearchStore(env.DATABASE_URL, undefined, {
      environment: env.APP_ENV || "staging",
      ca: env.DATABASE_CA_CERT,
      allowInsecureStaging: env.ALLOW_INSECURE_STAGING_DATABASE === "true",
    }),
});
