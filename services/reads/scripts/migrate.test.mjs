import assert from "node:assert/strict";
import { test } from "node:test";
import { pendingMigrations, wrapMigration } from "./migrate.mjs";

test("pendingMigrations: sólo NNNN_*.sql, ordenadas, sin las aplicadas", () => {
  const files = ["0002_seed_agents.sql", "notas.md", "0001_schema.sql", "0003_cron.sql"];
  assert.deepEqual(pendingMigrations(files, new Set(["0001_schema.sql"])), ["0002_seed_agents.sql", "0003_cron.sql"]);
  assert.deepEqual(pendingMigrations(files, new Set()), ["0001_schema.sql", "0002_seed_agents.sql", "0003_cron.sql"]);
});

test("wrapMigration: transacción con el insert al ledger al final", () => {
  const sql = wrapMigration("0001_schema.sql", "create table mobile.x (id int);");
  assert.equal(sql, "begin;\ncreate table mobile.x (id int);\ninsert into mobile.migrations (name) values ('0001_schema.sql');\ncommit;");
});
