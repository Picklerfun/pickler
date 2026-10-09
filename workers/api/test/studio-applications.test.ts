import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import {
  AccessDeniedError,
  AuthenticationRequiredError,
  type ApplicationReviewEntry,
  type ApplicationReviewRepository,
  type Principal,
} from "@pickler/core";
import { studioApplicationSchema, studioApplicationsSchema } from "@pickler/api-schema";
import { authenticated } from "../src/middleware/auth.js";
import { studioApplicationRoutes } from "../src/routes/studio-applications.js";
import type { AppEnv } from "../src/env.js";

const userId = "11111111-1111-4111-8111-111111111111";
const at = new Date("2026-10-08T12:00:00Z");

const entry = (over: Partial<ApplicationReviewEntry> = {}): ApplicationReviewEntry => ({
  id: 7,
  email: "creator@example.com",
  agentName: "Halftime",
  ticker: "$HALF",
  xHandle: "@halftimebot",
  category: "Sports",
  personality: "Analyst",
  edge: "Reads injury reports first.",
  whyYou: "Six years of NBA props.",
  status: "submitted",
  submittedAt: at,
  reviewedAt: null,
  reviewedBy: null,
  decisionNote: null,
  invitedAt: null,
  ...over,
});

function setup({
  admin = false,
  wired = true,
  repository: injectedRepository,
}: {
  admin?: boolean;
  wired?: boolean;
  repository?: ApplicationReviewRepository;
} = {}) {
  const principal = {
    kind: "user",
    id: userId,
    tenantId: null,
    email: "ops@pickler.fun",
    isSuperAdmin: admin,
  } as Principal;
  const calls: unknown[][] = [];
  const repository: ApplicationReviewRepository = {
    async list(filter) {
      calls.push(["list", filter]);
      return [entry()];
    },
    async review(id, decision, note, reviewer) {
      calls.push(["review", id, decision, note, reviewer]);
      return id === 7
        ? entry({ status: decision, reviewedAt: at, reviewedBy: reviewer, decisionNote: note })
        : null;
    },
  };
  const app = new Hono<AppEnv>();
  app.use(
    "*",
    authenticated(
      async (credentials) => {
        if (!credentials.bearerToken) {
          throw new AuthenticationRequiredError();
        }
        return { principal, workspace: null };
      },
      { userOnly: true },
    ),
  );
  app.onError((error, c) => {
    if (error instanceof AuthenticationRequiredError) {
      return c.json({ error: "UNAUTHORIZED" }, 401);
    }
    return c.json(
      { error: error instanceof AccessDeniedError ? "FORBIDDEN" : "BAD_REQUEST" },
      error instanceof AccessDeniedError ? 403 : 400,
    );
  });
  app.route("/", studioApplicationRoutes(wired ? (injectedRepository ?? repository) : undefined));
  const call = app.request.bind(app);
  app.request = ((path, init = {}) =>
    call(path, {
      ...init,
      headers: {
        Authorization: "Bearer controlled",
        ...Object.fromEntries(new Headers(init.headers)),
      },
    })) as typeof app.request;
  return { app, anonymous: call, calls };
}

const review = (body: unknown) => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

test("the inbox needs a session, then the allowlist", async () => {
  const { app, anonymous, calls } = setup();
  assert.equal((await anonymous("/applications")).status, 401);
  assert.equal((await app.request("/applications")).status, 403);
  assert.equal((await app.request("/applications/7", review({ status: "invited" }))).status, 403);
  assert.deepEqual(calls, []);
});

test("an operator lists, filtered by status, and the answer is the wire shape", async () => {
  const { app, calls } = setup({ admin: true });
  const all = await app.request("/applications");
  assert.equal(all.status, 200);
  assert.equal(all.headers.get("cache-control"), "private, no-store");
  const parsed = studioApplicationsSchema.parse(await all.json());
  assert.equal(parsed.applications[0]?.email, "creator@example.com");
  assert.equal(parsed.applications[0]?.submittedAt, at.toISOString());
  const some = await app.request("/applications?status=invited");
  assert.equal(some.status, 200);
  assert.deepEqual(calls, [
    ["list", { status: null }],
    ["list", { status: "invited" }],
  ]);
  assert.equal((await app.request("/applications?status=pending")).status, 400);
});

test("an operator decides, with a note, and the decision comes back", async () => {
  const { app, calls } = setup({ admin: true });
  const decided = await app.request(
    "/applications/7",
    review({ status: "rejected", note: "Thin edge." }),
  );
  assert.equal(decided.status, 200);
  const parsed = studioApplicationSchema.parse(await decided.json());
  assert.equal(parsed.status, "rejected");
  assert.equal(parsed.reviewedBy, "ops@pickler.fun");
  assert.equal(parsed.decisionNote, "Thin edge.");
  assert.deepEqual(calls, [["review", 7, "rejected", "Thin edge.", "ops@pickler.fun"]]);
});

test("a bad decision, a bad id and an unknown application are refused by status", async () => {
  const { app } = setup({ admin: true });
  assert.equal((await app.request("/applications/7", review({ status: "submitted" }))).status, 400);
  assert.equal(
    (await app.request("/applications/7", review({ status: "invited", extra: 1 }))).status,
    400,
  );
  assert.equal((await app.request("/applications/abc", review({ status: "invited" }))).status, 400);
  assert.equal((await app.request("/applications/99", review({ status: "invited" }))).status, 404);
});

test("without a repository the routes say so rather than pretending", async () => {
  const { app } = setup({ admin: true, wired: false });
  assert.equal((await app.request("/applications")).status, 503);
});

test("PostgreSQL inbox IDs remain numeric across listing and a decision", async (t) => {
  const { createTestStore } = await import("@pickler/infrastructure/testing");
  const { PostgresApplicationReview, PostgresWaitlist, PostgresApplicants } =
    await import("@pickler/infrastructure");
  const { pool } = await createTestStore(t);
  const seat = await new PostgresWaitlist(pool).join("wire@example.com", null);
  await new PostgresApplicants(pool).submit(seat.applyToken!, {
    agentName: "Wire test",
    ticker: "$WIRE",
    xHandle: "@wire_test",
    category: "Sports",
    personality: "Analyst",
    edge: "Public evidence.",
    whyYou: "Controlled integration test.",
  });
  const { app } = setup({ admin: true, repository: new PostgresApplicationReview(pool) });

  const response = await app.request("/applications");
  assert.equal(response.status, 200);
  const inbox = studioApplicationsSchema.parse(await response.json());
  const application = inbox.applications[0]!;
  assert.equal(typeof application.id, "number");
  const decided = await app.request(
    `/applications/${application.id}`,
    review({ status: "invited" }),
  );
  assert.equal(decided.status, 200);
  const saved = studioApplicationSchema.parse(await decided.json());
  assert.equal(saved.id, application.id);
  assert.equal(saved.status, "invited");
  assert.equal(saved.reviewedBy, "ops@pickler.fun");
  assert.ok(saved.invitedAt);
});
