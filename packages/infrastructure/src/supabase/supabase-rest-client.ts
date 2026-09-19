import { DataSourceUnavailableError } from "@pickler/core";

export interface SupabaseConfig {
  /** Project URL, e.g. https://<ref>.supabase.co */
  url: string;
  /** Server-only secret key (sb_secret_…) or legacy service_role JWT. */
  secretKey: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Postgres schema holding the functions (sent as Content-Profile). Defaults to public. */
  schema?: string;
}

export interface SupabaseRestClient {
  /** Calls a Postgres function through PostgREST and returns its parsed JSON body. */
  rpc(fn: string, args?: Record<string, unknown>): Promise<unknown>;
}

// Plain fetch keeps the adapter portable to edge runtimes such as Cloudflare Workers.
export function createSupabaseRestClient(config: SupabaseConfig): SupabaseRestClient {
  const baseUrl = new URL("/rest/v1/rpc/", config.url);
  const doFetch = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? 5000;
  const headers: Record<string, string> = {
    apikey: config.secretKey,
    "Content-Type": "application/json",
  };
  if (config.schema) {
    headers["Content-Profile"] = config.schema;
  }
  // Legacy JWT keys also travel as a bearer token; new sb_* keys must not.
  if (!config.secretKey.startsWith("sb_")) {
    headers.Authorization = `Bearer ${config.secretKey}`;
  }

  return {
    async rpc(fn, args = {}) {
      const source = `supabase.rpc.${fn}`;
      let response: Response;
      try {
        response = await doFetch(new URL(fn, baseUrl), {
          method: "POST",
          headers,
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        throw new DataSourceUnavailableError(source, { cause });
      }
      if (!response.ok) {
        throw new DataSourceUnavailableError(source, {
          cause: new Error(`HTTP ${response.status}`),
        });
      }
      try {
        return await response.json();
      } catch (cause) {
        throw new DataSourceUnavailableError(source, { cause });
      }
    },
  };
}
