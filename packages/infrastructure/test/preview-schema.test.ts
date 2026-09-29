import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestStore } from "./database.js";

test("migration 0017 adds the preview tables and the draft status", async (t) => {
  const store = await createTestStore(t);
  const tables = await store.pool.query(
    "SELECT to_regclass('pickler.preview_runs') IS NOT NULL AS runs, to_regclass('pickler.preview_events') IS NOT NULL AS events",
  );
  assert.deepEqual(tables.rows[0], { runs: true, events: true });
  const statuses = await store.pool.query<{ status: string }>(
    "SELECT unnest(enum_range(NULL::agents.agent_status))::text AS status",
  );
  assert.ok(statuses.rows.some((row) => row.status === "draft"));
});

test("a preview row refuses an unknown status and a half-recorded adoption", async (t) => {
  const store = await createTestStore(t);
  const userId = randomUUID();
  if ((await store.pool.query("SELECT to_regclass('auth.users') AS name")).rows[0].name) {
    await store.pool.query("INSERT INTO auth.users (id) VALUES ($1)", [userId]);
  }
  await store.pool.query("SELECT identity.create_profile($1, 'Maker', 'maker_one')", [userId]);
  const workspace = await store.pool.query<{ id: string }>(
    "INSERT INTO identity.workspaces (owner_user_id, name) VALUES ($1, 'w') RETURNING id",
    [userId],
  );
  const insert = (status: string, adoptedAt: number | null) =>
    store.pool.query(
      `INSERT INTO pickler.preview_runs
         (id, user_id, workspace_id, tenant_id, status, created_at, expires_at, config, fingerprint, adopted_at)
       VALUES ($1, $2, $3::uuid, $3::text, $4, 1, 2, '{}'::jsonb, 'f', $5)`,
      [randomUUID(), userId, workspace.rows[0]!.id, status, adoptedAt],
    );
  await insert("queued", null);
  await assert.rejects(insert("paused", null), { code: "23514" });
  await assert.rejects(insert("completed", 5), { code: "23514" });
});
