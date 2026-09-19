import { config } from "dotenv";
import { createRuntime, type Environment } from "@pickler/agent-runtime";

config({ quiet: true });
const [tenantId, agentId] = process.argv.slice(2);
if (!tenantId || !agentId) {
  throw new Error("Usage: validate:agent <tenant UUID> <agent UUID>");
}
const required = [
  "DATABASE_URL",
  "MODEL_BASE_URL",
  "MODEL_ID",
  "MODEL_API_KEY",
  "EXA_API_KEY",
] as const;
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing ${key}`);
  }
}
const env: Environment = {
  DATABASE_URL: process.env.DATABASE_URL!,
  MODEL_BASE_URL: process.env.MODEL_BASE_URL!,
  MODEL_ID: process.env.MODEL_ID!,
  MODEL_API_KEY: process.env.MODEL_API_KEY!,
  EXA_API_KEY: process.env.EXA_API_KEY!,
  BALLDONTLIE_API_KEY: process.env.BALLDONTLIE_API_KEY,
  THE_ODDS_API_KEY: process.env.THE_ODDS_API_KEY,
};
const runtime = createRuntime(env);
try {
  const result = await runtime.checkConnections({ tenantId, agentId });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await runtime.repository.close();
}
