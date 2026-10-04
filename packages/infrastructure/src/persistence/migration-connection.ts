import type { PoolConfig } from "pg";

/** Operator connection: session semantics and verified TLS, never Hyperdrive. */
export function migrationPoolConfig(url: string, ca?: string): PoolConfig {
  let endpoint: URL;
  try {
    endpoint = new URL(url);
  } catch {
    throw new Error("Invalid DATABASE_MIGRATION_URL");
  }
  if (!["postgres:", "postgresql:"].includes(endpoint.protocol)) {
    throw new Error("Invalid migration database protocol");
  }
  if (endpoint.hostname.includes("%")) {
    throw new Error("Migration database requires an unencoded host");
  }
  for (const key of endpoint.searchParams.keys()) {
    if (key !== "application_name") {
      throw new Error(
        "Migration URL only supports application_name; configure TLS with DATABASE_MIGRATION_CA_CERT",
      );
    }
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  const hosted =
    endpoint.hostname.endsWith(".pooler.supabase.com") ||
    /^db\.[a-z0-9]+\.supabase\.co$/.test(endpoint.hostname);
  if (!local && (!hosted || endpoint.port !== "5432" || !ca?.trim())) {
    throw new Error(
      "Hosted migrations require Supabase direct/session port 5432 and DATABASE_MIGRATION_CA_CERT",
    );
  }
  return {
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 600_000,
    lock_timeout: 30_000,
    ssl: local
      ? false
      : {
          rejectUnauthorized: true,
          servername: endpoint.hostname,
          ca: ca!.replaceAll("\\n", "\n"),
        },
  };
}
