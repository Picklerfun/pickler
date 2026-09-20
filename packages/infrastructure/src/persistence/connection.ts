import type { PoolConfig } from "pg";

export interface DatabaseConnectionOptions {
  environment: string;
  ca?: string | undefined;
  allowInsecureStaging?: boolean | undefined;
}

/** Invocation-local pools; hosted plaintext requires an explicit staging-only exception. */
export function databasePoolConfig(
  connectionString: string,
  options?: DatabaseConnectionOptions,
): PoolConfig {
  const config: PoolConfig = {
    connectionString,
    max: options ? 2 : 5,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    idleTimeoutMillis: 30_000,
  };
  if (!options) {
    return config;
  }
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Invalid DATABASE_URL");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("Invalid DATABASE_URL protocol");
  }
  // pg decodes the hostname, including encoded Unix socket paths.
  if (url.hostname.includes("%")) {
    throw new Error("DATABASE_URL requires an unencoded host");
  }
  // pg connection-string SSL parameters can override the explicit TLS object.
  for (const key of url.searchParams.keys()) {
    if (["host", "port"].includes(key.toLowerCase())) {
      throw new Error("Configure the database endpoint in the URL authority, not URL parameters");
    }
    if (key.toLowerCase().startsWith("ssl")) {
      throw new Error("Configure database TLS through connection options, not URL parameters");
    }
    // pg merges every query key into its config, including timeout overrides.
    if (key !== "application_name") {
      throw new Error("DATABASE_URL only supports the application_name query parameter");
    }
  }
  if (options.allowInsecureStaging && options.environment !== "staging") {
    throw new Error("Insecure hosted database connections are restricted to staging");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (options.environment === "local") {
    if (!local) {
      throw new Error("Local database mode requires a loopback host");
    }
    config.ssl = false;
  } else {
    if (
      local ||
      !url.hostname.endsWith(".pooler.supabase.com") ||
      !["5432", "6543"].includes(url.port)
    ) {
      throw new Error("Hosted connections require the Supabase pooler on port 5432 or 6543");
    }
    if (options.allowInsecureStaging) {
      config.ssl = false;
    } else {
      config.ssl = {
        rejectUnauthorized: true,
        servername: url.hostname,
        ...(options.ca ? { ca: options.ca } : {}),
      };
    }
  }
  return config;
}
