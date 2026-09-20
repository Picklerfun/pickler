import test from "node:test";
import assert from "node:assert/strict";
import { withFixtureUserCleanup } from "./fixture-user-cleanup.js";

test("a failure after granting access revokes a user before agent creation completes", async () => {
  const enabled = new Set<string>();
  let closed = false;
  const agentCreationFailure = new Error("agent creation failed");
  const db = {
    async query(text: string, [userId]: string[]) {
      assert.match(text, /SET enabled=false WHERE user_id=\$1/);
      enabled.delete(userId!);
    },
    async end() {
      closed = true;
    },
  };

  await assert.rejects(
    withFixtureUserCleanup(db, async (trackCreatedUser) => {
      trackCreatedUser("created-user");
      enabled.add("created-user");
      throw agentCreationFailure;
    }),
    (error) => error === agentCreationFailure,
  );

  assert.deepEqual([...enabled], []);
  assert.equal(closed, true);
});

test("cleanup attempts remaining users and closes the pool when revocation fails", async () => {
  const attemptedUsers: string[] = [];
  let closed = false;
  const revocationFailure = new Error("revocation failed");
  const db = {
    async query(_text: string, [userId]: string[]) {
      attemptedUsers.push(userId!);
      if (userId === "first-user") {
        throw revocationFailure;
      }
    },
    async end() {
      closed = true;
    },
  };

  await assert.rejects(
    withFixtureUserCleanup(db, async (trackCreatedUser) => {
      trackCreatedUser("first-user");
      trackCreatedUser("second-user");
    }),
    (error) => error instanceof AggregateError && error.errors[0] === revocationFailure,
  );

  assert.deepEqual(attemptedUsers, ["first-user", "second-user"]);
  assert.equal(closed, true);
});
