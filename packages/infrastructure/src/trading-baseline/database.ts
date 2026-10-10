import { createHash, randomUUID } from "node:crypto";
import { chmod } from "node:fs/promises";
import { Pool, Query, type PoolClient } from "pg";
import { baselineProcess, BaselineFailure } from "./process.js";

export { BaselineFailure } from "./process.js";
export type BaselinePgTools =
  { kind: "native"; directory: string } | { kind: "docker"; container: string };
export interface BaselineDatabaseIdentity {
  host: string;
  port: number;
  database: string;
  systemIdentifier: string;
  serverVersion: string;
}
export interface BaselineTable {
  schema: string;
  name: string;
  rows: number;
  rowsSha256: string;
  columns: unknown[];
}
export interface BaselineDatabaseSnapshot {
  version: 1;
  identity: BaselineDatabaseIdentity;
  capturedAt: string;
  snapshot: string;
  tables: BaselineTable[];
  sequences: { schema: string; name: string; lastValue: string | null; isCalled: boolean }[];
  roles: string[];
  studies: { table: string; ids: string[] }[];
  inventorySha256: string;
  consistency: "per-database-repeatable-read-shared-with-pg-dump";
}
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;

export function localBaselineUrl(connectionString: string): URL {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new BaselineFailure("BASELINE_LOCAL_DATABASE_REQUIRED");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.search ||
    url.hash ||
    !/^\/[a-zA-Z0-9_-]+$/.test(url.pathname)
  ) {
    throw new BaselineFailure("BASELINE_LOCAL_DATABASE_REQUIRED");
  }
  return url;
}

function pgEnvironment(url: URL): Record<string, string> {
  return {
    PGHOST: url.hostname.replaceAll(/[\[\]]/g, ""),
    PGPORT: url.port || "5432",
    PGDATABASE: url.pathname.slice(1),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: "10",
    PGAPPNAME: "pickler-baseline-recovery-only",
  };
}

async function pgTool(
  connectionString: string,
  tools: BaselinePgTools,
  operation: "pg_dump" | "pg_restore",
  args: string[],
  signal: AbortSignal,
  files: { stdinFile?: string; stdoutFile?: string },
): Promise<void> {
  const url = localBaselineUrl(connectionString);
  const env = pgEnvironment(url);
  let command: string;
  let prefix: string[] = [];
  if (tools.kind === "docker") {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(tools.container)) {
      throw new BaselineFailure("BASELINE_INVALID_TOOLS");
    }
    const ports = JSON.parse(
      await baselineProcess({
        command: "docker",
        args: ["inspect", "--format", "{{json .NetworkSettings.Ports}}", tools.container],
        signal,
      }),
    ) as Record<string, { HostPort: string }[] | null>;
    if (!ports["5432/tcp"]?.some((p) => p.HostPort === env.PGPORT)) {
      throw new BaselineFailure("BASELINE_DATABASE_TOOL_MISMATCH");
    }
    env.PGHOST = "127.0.0.1";
    env.PGPORT = "5432";
    command = "docker";
    prefix = [
      "exec",
      "--interactive",
      ...Object.keys(env).flatMap((k) => ["--env", k]),
      tools.container,
      operation,
    ];
  } else {
    if (!tools.directory.startsWith("/")) {
      throw new BaselineFailure("BASELINE_INVALID_TOOLS");
    }
    command = `${tools.directory}/${operation}`;
  }
  await baselineProcess({ command, args: [...prefix, ...args], env, signal, ...files });
}

async function startRead(client: PoolClient) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  await client.query("SET LOCAL DateStyle = 'ISO, YMD'");
  await client.query("SET LOCAL extra_float_digits = 3");
}

async function inventory(client: PoolClient, connectionString: string, signal: AbortSignal) {
  const url = localBaselineUrl(connectionString);
  const identityRow = (
    await client.query(
      `SELECT current_database() AS database, current_setting('server_version') AS version,
            (SELECT system_identifier::text FROM pg_control_system()) AS system_identifier,
            clock_timestamp()::text AS captured_at, pg_export_snapshot() AS snapshot`,
    )
  ).rows[0];
  const relations = (
    await client.query(
      `SELECT n.nspname AS schema, c.relname AS name
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'm') AND n.nspname <> 'information_schema'
       AND n.nspname !~ '^pg_' ORDER BY n.nspname, c.relname`,
    )
  ).rows as { schema: string; name: string }[];
  const tables: BaselineTable[] = [];
  const studies: BaselineDatabaseSnapshot["studies"] = [];
  for (const relation of relations) {
    signal.throwIfAborted();
    const qualified = `${quote(relation.schema)}.${quote(relation.name)}`;
    const columns = (
      await client.query(
        `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
              a.attnotnull AS not_null, a.attgenerated AS generated, a.attidentity AS identity
       FROM pg_attribute a WHERE a.attrelid = $1::regclass AND a.attnum > 0
       AND NOT a.attisdropped ORDER BY a.attnum`,
        [qualified],
      )
    ).rows;
    const hash = createHash("sha256");
    let count = 0;
    await new Promise<void>((resolve, reject) => {
      const query = new Query({
        text: `SELECT encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex') AS hash
               FROM ONLY ${qualified} t ORDER BY hash`,
      });
      query.on("row", (row: { hash: string }) => {
        hash.update(`${row.hash}\n`);
        count++;
      });
      query.once("end", () => resolve());
      query.once("error", () => reject(new BaselineFailure("BASELINE_DATABASE_INVENTORY_FAILED")));
      client.query(query);
    });
    tables.push({ ...relation, columns, rows: count, rowsSha256: hash.digest("hex") });
    if (
      /^(perps_studies|paper_studies)$/.test(relation.name) &&
      columns.some((c) => c.name === "id")
    ) {
      const ids = (await client.query(`SELECT id::text AS id FROM ${qualified} ORDER BY id`)).rows;
      studies.push({ table: qualified, ids: ids.map((row) => row.id as string) });
    }
  }
  const sequenceNames = (
    await client.query(
      `SELECT n.nspname AS schema, c.relname AS name FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'S'
     AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
     ORDER BY n.nspname, c.relname`,
    )
  ).rows as { schema: string; name: string }[];
  const sequences: BaselineDatabaseSnapshot["sequences"] = [];
  for (const sequence of sequenceNames) {
    const row = (
      await client.query(
        `SELECT last_value::text AS value, is_called FROM ${quote(sequence.schema)}.${quote(sequence.name)}`,
      )
    ).rows[0];
    sequences.push({ ...sequence, lastValue: row.value, isCalled: row.is_called });
  }
  // Roles referenced by policies must exist on an isolated restore. Never export role secrets.
  const roles = (
    await client.query(
      `SELECT DISTINCT r.rolname AS name FROM pg_policy p
     CROSS JOIN LATERAL unnest(p.polroles) role(oid) JOIN pg_roles r ON r.oid = role.oid
     ORDER BY r.rolname`,
    )
  ).rows.map((row) => row.name as string);
  return {
    version: 1 as const,
    identity: {
      host: url.hostname,
      port: Number(url.port || 5432),
      database: identityRow.database as string,
      systemIdentifier: identityRow.system_identifier as string,
      serverVersion: identityRow.version as string,
    },
    capturedAt: new Date(identityRow.captured_at as string).toISOString(),
    snapshot: identityRow.snapshot as string,
    tables,
    sequences,
    studies,
    roles,
    inventorySha256: digest({ tables, sequences, studies }),
    consistency: "per-database-repeatable-read-shared-with-pg-dump" as const,
  };
}

/** The exported snapshot remains alive until BOTH the inventory and pg_dump finish. */
export async function exportBaselineDatabase(input: {
  connectionString: string;
  tools: BaselinePgTools;
  dumpPath: string;
  signal: AbortSignal;
}): Promise<BaselineDatabaseSnapshot> {
  localBaselineUrl(input.connectionString);
  const pool = new Pool({
    connectionString: input.connectionString,
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await startRead(client);
    const before = await inventory(client, input.connectionString, input.signal);
    await pgTool(
      input.connectionString,
      input.tools,
      "pg_dump",
      ["--format=custom", "--no-owner", "--no-acl", `--snapshot=${before.snapshot}`],
      input.signal,
      { stdoutFile: input.dumpPath },
    );
    // Sequences are not MVCC. Changes during capture make the backup explicitly incomplete.
    const after = await inventory(client, input.connectionString, input.signal);
    if (before.inventorySha256 !== after.inventorySha256) {
      throw new BaselineFailure("BASELINE_DATABASE_CHANGED_DURING_CAPTURE");
    }
    await chmod(input.dumpPath, 0o600);
    return before;
  } catch (error) {
    throw error instanceof BaselineFailure
      ? error
      : new BaselineFailure("BASELINE_DATABASE_EXPORT_FAILED");
  } finally {
    await client?.query("ROLLBACK").catch(() => undefined);
    client?.release();
    await pool.end();
  }
}

/** Creates its own new DB in a different cluster; no caller-supplied destination DB is restored. */
export async function restoreBaselineDatabase(input: {
  adminConnectionString: string;
  sources: BaselineDatabaseIdentity[];
  expected: BaselineDatabaseSnapshot;
  tools: BaselinePgTools;
  dumpPath: string;
  signal: AbortSignal;
}): Promise<{ database: string; verified: boolean; actual: BaselineDatabaseSnapshot }> {
  const adminUrl = localBaselineUrl(input.adminConnectionString);
  const admin = new Pool({
    connectionString: input.adminConnectionString,
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  let target: Pool | undefined;
  try {
    const identity = (
      await admin.query("SELECT system_identifier::text AS id FROM pg_control_system()")
    ).rows[0];
    if (
      input.sources.some(
        (s) =>
          s.systemIdentifier === identity.id ||
          (s.port === Number(adminUrl.port || 5432) &&
            [s.host, adminUrl.hostname].every((h) =>
              ["localhost", "127.0.0.1", "[::1]"].includes(h),
            )),
      )
    ) {
      throw new BaselineFailure("BASELINE_ORIGINAL_RESTORE_TARGET_FORBIDDEN");
    }
    const database = `pickler_baseline_check_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE ${quote(database)} TEMPLATE template0`);
    const existingRoles = (await admin.query("SELECT rolname FROM pg_roles")).rows.map(
      (r) => r.rolname,
    );
    for (const role of input.expected.roles) {
      if (!existingRoles.includes(role)) {
        await admin.query(`CREATE ROLE ${quote(role)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`);
      }
    }
    const url = new URL(adminUrl);
    url.pathname = `/${database}`;
    await pgTool(
      url.toString(),
      input.tools,
      "pg_restore",
      ["--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", "--dbname", database],
      input.signal,
      { stdinFile: input.dumpPath },
    );
    // Recovery copies are read-only evidence, not new budget/runner databases.
    await admin.query(`ALTER DATABASE ${quote(database)} SET default_transaction_read_only = on`);
    target = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 10000 });
    const client = await target.connect();
    let actual: BaselineDatabaseSnapshot;
    try {
      await startRead(client);
      actual = await inventory(client, url.toString(), input.signal);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
    return {
      database,
      actual,
      verified: actual.inventorySha256 === input.expected.inventorySha256,
    };
  } catch (error) {
    throw error instanceof BaselineFailure
      ? error
      : new BaselineFailure("BASELINE_DATABASE_RESTORE_FAILED");
  } finally {
    await target?.end();
    await admin.end();
  }
}
