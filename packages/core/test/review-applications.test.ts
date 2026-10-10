import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AccessDeniedError,
  ApplicationNotFoundError,
  createApplicationReview,
  DECISION_NOTE_MAX,
  ReviewValidationError,
  type ApplicationReviewEntry,
  type ApplicationReviewRepository,
  type Principal,
} from "../src/index.js";

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
  submittedAt: new Date("2026-10-08T12:00:00Z"),
  reviewedAt: null,
  reviewedBy: null,
  decisionNote: null,
  invitedAt: null,
  ...over,
});

const principal = (over: Partial<Principal> = {}): Principal =>
  ({
    kind: "user",
    id: "user-1",
    tenantId: null,
    email: "Ops@Pickler.fun",
    walletAccount: false,
    memberRole: null,
    isSuperAdmin: true,
    abilities: {} as never,
    ...over,
  }) as Principal;

function repository() {
  const calls: unknown[][] = [];
  const repo: ApplicationReviewRepository = {
    async list(filter) {
      calls.push(["list", filter]);
      return [entry()];
    },
    async review(id, decision, note, reviewer) {
      calls.push(["review", id, decision, note, reviewer]);
      return id === 7
        ? entry({ status: decision, reviewedBy: reviewer, decisionNote: note })
        : null;
    },
  };
  return { repo, calls };
}

describe("reviewing applications", () => {
  it("is for super admins only", async () => {
    const { repo, calls } = repository();
    const review = createApplicationReview(repo);
    await assert.rejects(review.list(principal({ isSuperAdmin: false })), AccessDeniedError);
    await assert.rejects(
      review.review(principal({ isSuperAdmin: false }), 7, "invited", null),
      AccessDeniedError,
    );
    await assert.rejects(
      review.list({ kind: "service", id: "svc", tenantId: null, scopes: [] } as never),
      AccessDeniedError,
    );
    assert.deepEqual(calls, []);
  });

  it("lists with the status asked for", async () => {
    const { repo, calls } = repository();
    const review = createApplicationReview(repo);
    await review.list(principal(), { status: "submitted" });
    await review.list(principal());
    assert.deepEqual(calls, [
      ["list", { status: "submitted" }],
      ["list", {}],
    ]);
    await assert.rejects(
      review.list(principal(), { status: "pending" as never }),
      ReviewValidationError,
    );
  });

  it("records the decision with the reviewer's email, lower-cased, and a trimmed note", async () => {
    const { repo, calls } = repository();
    const review = createApplicationReview(repo);
    const decided = await review.review(principal(), 7, "invited", "  Strong beat.  ");
    assert.deepEqual(calls, [["review", 7, "invited", "Strong beat.", "ops@pickler.fun"]]);
    assert.equal(decided.status, "invited");
    assert.equal(decided.reviewedBy, "ops@pickler.fun");
  });

  it("falls back to the user id when the principal carries no email, and drops an empty note", async () => {
    const { repo, calls } = repository();
    const review = createApplicationReview(repo);
    await review.review(principal({ email: undefined }), 7, "rejected", "   ");
    assert.deepEqual(calls, [["review", 7, "rejected", null, "user-1"]]);
  });

  it("refuses an unknown decision, a bad id and a long note before touching the repository", async () => {
    const { repo, calls } = repository();
    const review = createApplicationReview(repo);
    await assert.rejects(
      review.review(principal(), 7, "submitted" as never, null),
      ReviewValidationError,
    );
    await assert.rejects(review.review(principal(), 0, "invited", null), ReviewValidationError);
    await assert.rejects(review.review(principal(), 1.5, "invited", null), ReviewValidationError);
    await assert.rejects(
      review.review(principal(), 7, "invited", "x".repeat(DECISION_NOTE_MAX + 1)),
      ReviewValidationError,
    );
    assert.deepEqual(calls, []);
  });

  it("says when the application does not exist", async () => {
    const { repo } = repository();
    const review = createApplicationReview(repo);
    await assert.rejects(review.review(principal(), 99, "invited", null), ApplicationNotFoundError);
  });
});
