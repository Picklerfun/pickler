import type { Principal, Workspace } from "@pickler/core";
import type { AgentLedger } from "./budget/agent-ledger";
import type { PerpsQueueMessage } from "./routes/studio-perps";

/** Worker bindings. Secrets come from `wrangler secret put` / `.dev.vars`. */
export interface Env {
  TOKEN_LAUNCH_ENABLED?: string;
  TOKEN_PUBLIC_TRADING_ENABLED?: string;
  TOKEN_PUBLIC_RPC_DAILY_LIMIT?: string;
  TOKEN_LAUNCH_POLICY_JSON?: string;
  TOKEN_LAUNCH_AUTHORITY_KEY?: string;
  TOKEN_METADATA?: R2Bucket;
  ADVICE_ENABLED?: string;
  ADVICE_POLICY_JSON?: string;
  /**
   * "true" sells each fresh advice analysis with x402 (docs/specs/agent-advice-x402-v1.md); it
   * needs X402_RELAYER_PRIVATE_KEY and MONAD_RPC_URL too, and without them every request answers
   * 503 (fails closed). Anything other than "true" keeps the request free, as before.
   */
  ADVICE_X402_ENABLED?: string;
  /**
   * Secret. The testnet relayer EOA that submits `transferWithAuthorization` and pays its gas in
   * MON; it holds no AUSD. Never logged, returned or placed in an error.
   */
  X402_RELAYER_PRIVATE_KEY?: string;
  APP_ENV: string;
  TRADING_EXECUTOR?: Fetcher;
  TRADING_QUEUE?: Queue<{ kind: "trading-wakeup" }>;
  TRADING_ADMISSIONS_ENABLED?: string;
  ADMISSIONS_ENABLED?: string;
  DATABASE?: Hyperdrive;
  /** Loopback development only; hosted requests require DATABASE. */
  DATABASE_URL?: string;
  RESEARCH_QUEUE?: Queue<{ kind: "research-wakeup" | "advice-wakeup" } | PerpsQueueMessage>;
  /**
   * The Perpl paper runtime (docs/specs/perpl-paper-runtime-v1.md R3): "true" admits manual checks
   * and approvals; anything else answers 409 RUNTIME_DISABLED. Reads, closes and stops stay on.
   * Keep it equal to the research worker's.
   */
  PERPL_RUNTIME_ENABLED?: string;
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
  /** Read-only OAuth application; credentials stay in API runtime, never Web or Research. */
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  X_REDIRECT_URI?: string;
  X_TOKEN_ENCRYPTION_KEY?: string;
  X_TOKEN_ENCRYPTION_KEY_VERSION?: string;
  X_OAUTH_ENABLED?: string;
  X_READS_ENABLED?: string;
  X_API_POLICY_JSON?: string;
}

export interface Variables {
  requestId: string;
  principal: Principal;
  workspace: Workspace | null;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
