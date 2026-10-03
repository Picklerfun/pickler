import type { Principal, Workspace } from "@pickler/core";
import type { AgentLedger } from "./budget/agent-ledger";

/** Worker bindings. Secrets come from `wrangler secret put` / `.dev.vars`. */
export interface Env {
  ADVICE_ENABLED?: string;
  ADVICE_POLICY_JSON?: string;
  APP_ENV: string;
  TRADING_EXECUTOR?: Fetcher;
  TRADING_QUEUE?: Queue<{ kind: "trading-wakeup" }>;
  TRADING_ADMISSIONS_ENABLED?: string;
  ADMISSIONS_ENABLED?: string;
  DATABASE?: Hyperdrive;
  /** Loopback development only; hosted requests require DATABASE. */
  DATABASE_URL?: string;
  RESEARCH_QUEUE?: Queue<{ kind: "research-wakeup" | "advice-wakeup" }>;
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
  /** Turnkey parent organisation credentials. Never placed inside a sub-organisation. */
  TURNKEY_API_PUBLIC_KEY?: string;
  TURNKEY_API_PRIVATE_KEY?: string;
  TURNKEY_PARENT_ORG_ID?: string;
  /**
   * Pickler's delegated API key: the only credential of the non-root "Pickler" user each person
   * creates inside their own sub-organization, with no rights beyond that wallet's policies. The
   * public half (compressed P-256 hex) goes into the create_users activity; without it the agent
   * wallet ceremony answers 503 and every other signing route is unaffected. The private half is
   * held by Pickler, unused until live trading, and never logged.
   */
  TURNKEY_DELEGATED_API_PUBLIC_KEY?: string;
  TURNKEY_DELEGATED_API_PRIVATE_KEY?: string;
  /** WebAuthn relying party: "localhost" in development, the site domain in production. */
  TURNKEY_RPID?: string;
  /** Shown in the operating system's passkey prompt. */
  TURNKEY_APP_NAME?: string;
  /**
   * The chain wallet balances are read from. Absent means Monad testnet, the same default the
   * web carries in NEXT_PUBLIC_SIWE_CHAIN_ID; an unsupported id fails composition rather than
   * quietly reading the wrong network's balances.
   */
  CHAIN_ID?: string;
  /**
   * The Perpl network the public market board reads: "testnet" or "mainnet". Absent, or anything
   * else, serves the sample board, labelled as a sample.
   */
  PERPL_BOARD_NETWORK?: string;
  /** Provider endpoint for balance reads; absent falls back to the public, rate-limited one. */
  MONAD_RPC_URL?: string;
  /**
   * The domain a sign-in message must name. Absent leaves the wallet routes unmounted rather than
   * mounted and unable to reject a signature harvested for another site.
   */
  SIWE_DOMAIN?: string;
  /** Non-deliverable domain for synthetic wallet addresses, e.g. "wallet.pickler.fun". */
  WALLET_EMAIL_DOMAIN?: string;
  /**
   * Pickler's X app bearer token (app-only, read access), for Connect X's verification reads. A
   * secret: it never leaves the API. Absent or empty, Connect X says it is not open yet and its
   * challenge and verify routes answer 503 X_UNAVAILABLE.
   */
  X_BEARER_TOKEN?: string;
}

export interface Variables {
  requestId: string;
  principal: Principal;
  workspace: Workspace | null;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
