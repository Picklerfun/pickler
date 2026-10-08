import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { migrateDatabase, migrationsFolder } from "../src/persistence/migrate-database.js";

test("profile migration preserves existing OAuth grants and private permissions", async (t) => {
  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      "postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler",
  );
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  const admin = new Pool({ connectionString: url.href, max: 1 });
  const name = `pickler_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.href, max: 1 });
  const folder = await mkdtemp(join(tmpdir(), "pickler-x-profile-"));
  t.after(async () => {
    await pool.end();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
    await rm(folder, { recursive: true, force: true });
  });
  const journal = JSON.parse(await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 34);
  await mkdir(join(folder, "meta"));
  await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
  for (const entry of journal.entries) {
    await copyFile(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  await migrateDatabase(pool, folder);
  const user = randomUUID();
  const workspace = randomUUID();
  const agent = randomUUID();
  await pool.query("SELECT identity.create_profile($1,'Maker','migration_maker')", [user]);
  await pool.query(
    "INSERT INTO identity.workspaces (id,owner_user_id,name) VALUES ($1,$2,'Controlled')",
    [workspace, user],
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO agents.agents (id,workspace_id,name,handle) VALUES ($1,$2,'Controlled','migration_agent')",
      [agent, workspace],
    );
    await client.query(
      "INSERT INTO identity.handles (handle,agent_id) VALUES ('migration_agent',$1)",
      [agent],
    );
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  await pool.query(
    "INSERT INTO agents.x_accounts (agent_id,x_user_id,handle,verified_at,verification_method) VALUES ($1,'123','ControlledX',now(),'oauth')",
    [agent],
  );
  await pool.query(
    "INSERT INTO agents.x_oauth_grants (agent_id,user_id,workspace_id,tenant_id,status,tokens,key_version,scopes,expires_at) VALUES ($1,$2,$3,'controlled','connected','unchanged-ciphertext',1,'[\"users.read\",\"tweet.read\",\"offline.access\"]',now()+interval '1 hour')",
    [agent, user, workspace],
  );
  const before = (await pool.query("SELECT * FROM agents.x_oauth_grants")).rows[0];

  await migrateDatabase(pool);
  await migrateDatabase(pool);

  const { display_name, profile_image_url, ...after } = (
    await pool.query("SELECT * FROM agents.x_oauth_grants")
  ).rows[0];
  assert.deepEqual(after, before);
  assert.equal(display_name, null);
  assert.equal(profile_image_url, null);
  assert.equal(
    (
      await pool.query(
        "SELECT relrowsecurity FROM pg_class WHERE oid='agents.x_oauth_grants'::regclass",
      )
    ).rows[0].relrowsecurity,
    true,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS grants FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='agents.x_oauth_grants'::regclass AND a.grantee=0",
      )
    ).rows[0].grants,
    0,
  );
  const roles = await pool.query(
    "SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')",
  );
  for (const { rolname: role } of roles.rows) {
    assert.equal(
      (
        await pool.query(
          "SELECT has_column_privilege($1,'agents.x_oauth_grants','profile_image_url','SELECT') AS allowed",
          [role],
        )
      ).rows[0].allowed,
      false,
    );
  }
});
