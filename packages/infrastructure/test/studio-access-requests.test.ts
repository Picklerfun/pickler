import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PostgresStudioDirectory } from "../src/studio/directory.js";
import { PostgresStudioAccessRequests } from "../src/studio/access-requests.js";
import { createTestStore } from "./database.js";

/* Requesting access from the studio was retired (docs/specs/landing-trade-v1.md §7); what the
   adapter still does is read a person's status and list the requests recorded before that. */
test("access reads are private, follow the enabled flag and never enable anything", async (t) => {
  const store = await createTestStore(t);
  const directory = new PostgresStudioDirectory(store.pool);
  const requests = new PostgresStudioAccessRequests(store.pool);
  async function person(handle: string) {
    const id = randomUUID();
    if ((await store.pool.query("SELECT to_regclass('auth.users') AS name")).rows[0].name) {
      await store.pool.query("INSERT INTO auth.users (id) VALUES ($1)", [id]);
    }
    await store.pool.query("SELECT identity.create_profile($1, 'Creator', $2)", [id, handle]);
    await directory.onboard(id);
    return { id, access: (await directory.access(id, null))! };
  }
  const owner = await person("request_owner");
  const other = await person("request_other");
  assert.equal((await requests.read(owner.id)).status, "not_requested");
  assert.deepEqual(await requests.pending(), []);

  // A request recorded before the retirement.
  await store.pool.query(
    "INSERT INTO pickler.studio_access_requests (user_id, workspace_id) VALUES ($1, $2)",
    [owner.id, owner.access.workspaceId],
  );
  const recorded = await requests.read(owner.id);
  assert.equal(recorded.status, "pending");
  assert.ok(recorded.requestedAt instanceof Date);
  assert.equal((await directory.access(owner.id, null))!.enabled, false);
  assert.equal((await requests.read(other.id)).status, "not_requested");
  assert.equal((await requests.pending())[0]!.userId, owner.id);
  assert.equal(
    (
      await store.pool.query(
        "SELECT relrowsecurity FROM pg_class WHERE oid='pickler.studio_access_requests'::regclass",
      )
    ).rows[0].relrowsecurity,
    true,
  );

  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    owner.id,
  ]);
  assert.equal((await requests.read(owner.id)).status, "enabled");
  assert.deepEqual(await requests.pending(), []);
});
