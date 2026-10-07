import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";

const [mode, directory] = process.argv.slice(2);
if (mode === "prepare") {
  if (directory !== undefined && directory !== "alternate") {
    throw new Error("Expected the fixed alternate port slot or no slot");
  }
  const portSlot = directory === "alternate" ? 3 : 2;
  const root = await mkdtemp(join(tmpdir(), "pickler-workers-controlled-"));
  const identity = randomUUID();
  const project = `pickler-workers-${identity.slice(0, 8)}`;
  const source = await readFile(new URL("../../../supabase/config.toml", import.meta.url), "utf8");
  const config = source
    .replace(/^project_id = .+$/m, `project_id = "${project}"`)
    .replace(/^schemas = \[.+\]$/m, 'schemas = ["public", "graphql_public"]')
    .replace(/\b5452([0-9])\b/g, `555${portSlot}$1`)
    .replace(/^inspector_port = 8083$/m, `inspector_port = ${portSlot === 3 ? 8283 : 8183}`);
  await mkdir(join(root, "supabase"));
  await writeFile(join(root, "supabase/config.toml"), config);
  await writeFile(
    join(root, "controlled-stack.json"),
    JSON.stringify({ identity, project, portSlot }),
    {
      mode: 0o600,
    },
  );
  console.log(root);
} else if (["initialize", "expose-api"].includes(mode) && directory) {
  const {
    identity,
    project,
    portSlot = 2,
  } = JSON.parse(await readFile(join(directory, "controlled-stack.json"), "utf8"));
  const configPath = join(directory, "supabase/config.toml");
  const config = await readFile(configPath, "utf8");
  if (
    ![2, 3].includes(portSlot) ||
    !config.includes(`port = 555${portSlot}2`) ||
    !/^pickler-workers-[0-9a-f]{8}$/.test(project) ||
    !config.includes(`project_id = "${project}"`) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(identity)
  ) {
    throw new Error("Expected the generated dedicated stack configuration and identity");
  }
  const status = JSON.parse(await readFile(join(directory, "status.json"), "utf8"));
  const url = new URL(status.DB_URL);
  const api = new URL(status.API_URL);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== `555${portSlot}2` ||
    url.pathname !== "/postgres" ||
    url.search !== "" ||
    api.hostname !== "127.0.0.1" ||
    api.port !== `555${portSlot}1`
  ) {
    throw new Error("Refusing to mark any database except the dedicated controlled Supabase stack");
  }
  const pool = new Pool({ connectionString: status.DB_URL, max: 1 });
  try {
    if (mode === "expose-api") {
      const marker = await pool.query(
        "SELECT identity FROM pickler_worker_test.identity WHERE singleton = true",
      );
      if (marker.rows.length !== 1 || marker.rows[0].identity !== identity) {
        throw new Error("Controlled test database identity does not match this test stack");
      }
      const schemas = [
        "public",
        "graphql_public",
        "identity",
        "agents",
        "budget",
        "audit",
        "growth",
        "market",
      ];
      const missing = await pool.query(
        "SELECT name FROM unnest($1::text[]) AS name WHERE to_regnamespace(name) IS NULL",
        [schemas],
      );
      if (missing.rows.length > 0) {
        throw new Error("Apply Pickler migrations before exposing the product API schemas");
      }
      // Database-specific role settings override the running PostgREST environment.
      // The marker and dedicated endpoint have already fenced this operator mutation.
      await pool.query("BEGIN");
      await pool.query(
        "ALTER ROLE authenticator IN DATABASE postgres SET pgrst.db_schemas = 'public,graphql_public,identity,agents,budget,audit,growth,market'",
      );
      await pool.query("NOTIFY pgrst, 'reload config'");
      await pool.query("NOTIFY pgrst, 'reload schema'");
      await pool.query("COMMIT");
      await writeFile(
        configPath,
        config.replace(/^schemas = \[.+\]$/m, `schemas = ${JSON.stringify(schemas)}`),
      );
      console.log(
        "Dedicated product Data API schemas enabled; running config reloaded and restart config updated",
      );
    } else {
      // Refuse existing application storage. This is initialization of a fresh disposable stack.
      const existing = await pool.query(
        "SELECT to_regnamespace('pickler') AS application, to_regnamespace('pickler_worker_test') AS marker",
      );
      if (existing.rows[0].application || existing.rows[0].marker) {
        throw new Error(
          "Controlled stack initialization requires a fresh database without Pickler schemas",
        );
      }
      await pool.query("BEGIN");
      await pool.query("CREATE SCHEMA pickler_worker_test");
      await pool.query("REVOKE ALL ON SCHEMA pickler_worker_test FROM PUBLIC");
      await pool.query(
        "CREATE TABLE pickler_worker_test.identity (singleton boolean PRIMARY KEY CHECK(singleton), identity uuid NOT NULL)",
      );
      await pool.query("INSERT INTO pickler_worker_test.identity VALUES (true, $1)", [identity]);
      await pool.query("COMMIT");
      await writeFile(
        join(directory, "consumer.dev.vars"),
        `APP_ENV=local\nDATABASE_URL=${status.DB_URL}\nCONTROLLED_TEST_DATABASE_ID=${identity}\nADMISSIONS_ENABLED=true\n`,
        { mode: 0o600 },
      );
      console.log(
        "Dedicated storage initialized; private consumer bindings written to consumer.dev.vars",
      );
    }
  } finally {
    await pool.end();
  }
} else {
  throw new Error(
    "Usage: node prepare-controlled-stack.mjs prepare | initialize <temporary-stack-directory> | expose-api <temporary-stack-directory>",
  );
}
