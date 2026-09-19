import type { Principal, Workspace } from "@pickler/core";
import type { AgentLedger } from "./budget/agent-ledger";

/** Worker bindings. Secrets come from `wrangler secret put` / `.dev.vars`. */
export interface Env {
  APP_ENV: string;
  HYPERDRIVE?: Hyperdrive;
  DATABASE_URL?: string;
  RESEARCH_QUEUE?: Queue<{ type: "wake" }>;
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
  /** Supabase Auth issuer, e.g. https://<ref>.supabase.co/auth/v1 (no trailing slash). */
  JWT_ISSUER: string;
  JWT_AUDIENCE?: string;
  SUPER_ADMIN_EMAILS?: string;
  /** Comma-separated browser origins allowed by CORS, e.g. https://pickler.fun,http://localhost:3000 */
  ALLOWED_ORIGINS?: string;
  ENCRYPTION_KEY?: string;
  /** Retained legacy binding only; new API budget authority is PostgreSQL. */
  AGENT_LEDGER?: DurableObjectNamespace<AgentLedger>;
}

export interface Variables {
  requestId: string;
  principal: Principal;
  workspace: Workspace | null;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
