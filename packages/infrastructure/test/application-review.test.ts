import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { AccessDeniedError, createApplicationReview, type Principal } from "@pickler/core";
import { PostgresApplicationReview } from "../src/applicants/postgres-application-review.js";
import { PostgresApplicants, PostgresWaitlist } from "../src/persistence/growth-store.js";
import { PostgresStudioDirectory } from "../src/studio/directory.js";
import { PostgresStudioAccessRequests } from "../src/studio/access-requests.js";
import { createTestStore } from "./database.js";

test("application decisions audit, filter and grant access to existing and future email accounts", async (t) => {
  const { pool } = await createTestStore(t);
  const directory = new PostgresStudioDirectory(pool);
  const access = new PostgresStudioAccessRequests(pool);
  const repository = new PostgresApplicationReview(pool);
  const review = createApplicationReview(repository);
  const operator = {
    kind: "user",
    id: randomUUID(),
    email: "Ops@Pickler.fun",
    isSuperAdmin: true,
  } as Extract<Principal, { kind: "user" }>;

  // Reproduce Supabase's identity lookup within this disposable local database.
  await pool.query("CREATE SCHEMA IF NOT EXISTS auth");
  await pool.query("CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text)");

  async function account(email: string, handle: string) {
    const id = randomUUID();
    await pool.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, email]);
    await pool.query("SELECT identity.create_profile($1, 'Creator', $2)", [id, handle]);
    await directory.onboard(id, email);
    return id;
  }

  async function application(email: string, ticker: string, handle: string) {
    const seat = await new PostgresWaitlist(pool).join(email, null);
    const outcome = await new PostgresApplicants(pool).submit(seat.applyToken!, {
      agentName: "Controlled creator",
      ticker,
      xHandle: handle,
      category: "Sports",
      personality: "Analyst",
      edge: "Reads injury reports first.",
      whyYou: "Six years of NBA props.",
    });
    assert.equal(outcome, "submitted");
    return (await repository.list({})).find((row) => row.email === email)!;
  }

  const existing = await account("Existing@Example.com", "existing_owner");
  const first = await application("existing@example.com", "$EXST", "@existing_bot");
  const future = await application("future@example.com", "$FUTR", "@future_bot");
  const refused = await application("rejected@example.com", "$NOPE", "@rejected_bot");
  assert.equal((await directory.access(existing, null))!.enabled, false);
  assert.equal((await access.read(existing, " EXISTING@example.com ")).application, "submitted");

  await assert.rejects(
    review.review({ ...operator, isSuperAdmin: false }, first.id, "invited", null),
    AccessDeniedError,
  );
  assert.equal((await directory.access(existing, null))!.enabled, false);

  const invited = await review.review(operator, first.id, "invited", "  Clear edge.  ");
  assert.equal(invited.reviewedBy, "ops@pickler.fun");
  assert.equal(invited.decisionNote, "Clear edge.");
  assert.ok(invited.reviewedAt instanceof Date);
  assert.ok(invited.invitedAt instanceof Date);
  assert.equal((await directory.access(existing, null))!.enabled, true);
  assert.equal((await access.read(existing, "existing@example.com")).status, "enabled");

  await review.review(operator, future.id, "invited", null);
  await review.review(operator, refused.id, "rejected", "Needs evidence.");
  const later = await account("FUTURE@example.com", "future_creator");
  const rejected = await account("rejected@example.com", "rejected_owner");
  const stranger = await account("stranger@example.com", "stranger_owner");
  assert.equal((await directory.access(later, null))!.enabled, true);
  assert.equal((await directory.access(rejected, null))!.enabled, false);
  assert.equal((await directory.access(stranger, null))!.enabled, false);
  assert.equal((await access.read(rejected, "rejected@example.com")).application, "rejected");
  assert.equal((await access.read(stranger, "stranger@example.com")).application, null);
  assert.equal((await repository.list({ status: "invited" })).length, 2);
  assert.equal((await repository.list({ status: "rejected" })).length, 1);
  assert.deepEqual(await repository.list({ status: "submitted" }), []);

  const repeated = await review.review(operator, first.id, "invited", null);
  assert.equal(repeated.invitedAt!.getTime(), invited.invitedAt!.getTime());
  assert.equal(await repository.review(999999, "invited", null, operator.email!), null);
  await assert.rejects(
    pool.query("SELECT growth.review_application($1, 'submitted', null, 'ops')", [first.id]),
  );
  await assert.rejects(
    pool.query("SELECT growth.review_application($1, 'invited', null, '')", [first.id]),
  );

  const permissions = await pool.query<{ proname: string; publicExecute: boolean }>(`
    SELECT p.proname, EXISTS (
      SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) AS "publicExecute"
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'growth'
      AND p.proname IN ('review_application', 'claim_invite', 'application_status_for')
  `);
  assert.equal(permissions.rows.length, 3);
  assert.ok(permissions.rows.every((row) => !row.publicExecute));
});
