import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PostgresStudioDirectory } from "../src/studio/directory.js";
import { PostgresStudioAccessRequests } from "../src/studio/access-requests.js";
import { createTestStore } from "./database.js";

test("creator requests are concurrent-idempotent, private and never enable access", async (t) => {
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
  const results = await Promise.all(
    Array.from({ length: 8 }, () => requests.request(owner.id, owner.access.workspaceId)),
  );
  assert.ok(results.every((r) => r.status === "pending"));
  assert.ok(results.every((r) => r.requestedAt?.getTime() === results[0]!.requestedAt?.getTime()));
  assert.equal(
    (await store.pool.query("SELECT count(*)::integer AS n FROM pickler.studio_access_requests"))
      .rows[0].n,
    1,
  );
  assert.equal((await directory.access(owner.id, null))!.enabled, false);
  assert.equal((await requests.read(other.id)).status, "not_requested");
  await assert.rejects(requests.request(other.id, owner.access.workspaceId));
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
  assert.equal((await requests.request(owner.id, owner.access.workspaceId)).status, "enabled");
  assert.equal(
    (await store.pool.query("SELECT count(*)::integer AS n FROM pickler.studio_access_requests"))
      .rows[0].n,
    1,
  );
});
