import { resolve } from "node:path";
import { config } from "dotenv";
import { z } from "zod";
config({ path: resolve(process.cwd(), ".env"), quiet: true });
const schema = z.object({
  POLYMARKET_SIGNER_ADDRESS: z.string().optional(),
  POLYMARKET_SIGNER_PRIVATE_KEY: z.string().optional(),
  POLYMARKET_WALLET_ADDRESS: z.string().optional(),
  POLYMARKET_CLOB_API_KEY: z.string().optional(),
  POLYMARKET_CLOB_API_SECRET: z.string().optional(),
  POLYMARKET_CLOB_API_PASSPHRASE: z.string().optional(),
  POLYMARKET_BUILDER_API_KEY: z.string().optional(),
  POLYMARKET_BUILDER_SECRET: z.string().optional(),
  POLYMARKET_BUILDER_PASSPHRASE: z.string().optional(),
  POLYMARKET_TRADING_RUNTIME: z.enum(["off", "node"]).optional(),
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => {
      if (!URL.canParse(value)) {
        return false;
      }
      const url = new URL(value);
      return ["postgres:", "postgresql:"].includes(url.protocol) && url.port !== "6543";
    }, "Use a PostgreSQL direct or session-pooler connection, not transaction mode"),
  MODEL_BASE_URL: z.string().url(),
  MODEL_ID: z.string().min(1),
  MODEL_API_KEY: z.string().min(1),
  EXA_API_KEY: z.string().default(""),
  BALLDONTLIE_API_KEY: z.string().optional(),
  THE_ODDS_API_KEY: z.string().optional(),
  TENANT_ALPHA_TOKEN: z.string().min(32),
  TENANT_BETA_TOKEN: z.string().min(32),
});
export function readEnv(env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Configure required environment variables: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  }
  const value = result.data;
  const url = new URL(value.MODEL_BASE_URL);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  ) {
    throw new Error("MODEL_BASE_URL must use HTTPS or local loopback HTTP");
  }
  if (value.TENANT_ALPHA_TOKEN === value.TENANT_BETA_TOKEN) {
    throw new Error("Tenant tokens must be distinct");
  }
  return value;
}

export type Environment = ReturnType<typeof readEnv>;
