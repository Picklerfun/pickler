import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AccessDeniedError,
  createStudioAccessRequests,
  type Principal,
  type StudioAccessRequestRepository,
} from "../src/index.js";

const principal = (over: Partial<Principal> = {}): Principal =>
  ({
    kind: "user",
    id: "user-1",
    tenantId: null,
    email: "creator@example.com",
    walletAccount: false,
    memberRole: null,
    isSuperAdmin: false,
    abilities: {} as never,
    ...over,
  }) as Principal;

function repository() {
  const calls: unknown[][] = [];
  const repo: StudioAccessRequestRepository = {
    async read(userId, email) {
      calls.push(["read", userId, email]);
      return { status: "not_requested", requestedAt: null, application: "submitted" };
    },
    async pending() {
      calls.push(["pending"]);
      return [];
    },
  };
  return { repo, calls };
}

describe("reading creator access", () => {
  it("passes the account's email so the answer carries its application", async () => {
    const { repo, calls } = repository();
    const read = await createStudioAccessRequests(repo).read(principal());
    assert.deepEqual(calls, [["read", "user-1", "creator@example.com"]]);
    assert.equal(read.application, "submitted");
    assert.equal(read.canReviewRequests, false);
  });

  it("says who may review, and is for users only", async () => {
    const { repo } = repository();
    const access = createStudioAccessRequests(repo);
    assert.equal((await access.read(principal({ isSuperAdmin: true }))).canReviewRequests, true);
    await assert.rejects(
      access.read({ kind: "service", id: "svc", tenantId: null, scopes: [] } as never),
      AccessDeniedError,
    );
    await assert.rejects(access.pending(principal()), AccessDeniedError);
    assert.deepEqual(await access.pending(principal({ isSuperAdmin: true })), []);
  });
});
