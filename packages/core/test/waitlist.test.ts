import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createJoinWaitlist,
  InvalidEmailError,
  type Applicant,
  type ApplicantRepository,
  type WaitlistRepository,
} from "../src/index.js";

const applicant = (email: string): Applicant => ({
  email,
  linePosition: 10,
  referralCode: "abc12345",
  referrals: 0,
  application: null,
});

function applicantsWith(tokens: Record<string, Applicant>): ApplicantRepository {
  return {
    findByToken: async (token) => tokens[token] ?? null,
    submit: async () => "submitted",
    isTickerAvailable: async () => true,
  };
}

test("waitlist stores the normalized email and a valid referral code", async () => {
  const received: [string, string | null][] = [];
  const waitlist: WaitlistRepository = {
    join: async (email, referralCode) => {
      received.push([email, referralCode]);
      return { position: 1205, alreadyJoined: false, applyToken: "token-1" };
    },
  };
  const join = createJoinWaitlist(waitlist, applicantsWith({}));

  assert.deepEqual(await join("  Creator@Example.COM ", { referralCode: " AbC12345 " }), {
    position: 1205,
    alreadyJoined: false,
    applyToken: "token-1",
  });
  await join("other@example.com", { referralCode: "../../drop" });
  assert.deepEqual(received, [
    ["creator@example.com", "abc12345"],
    ["other@example.com", null],
  ]);
});

test("waitlist rejects invalid emails without touching the repository", async () => {
  let calls = 0;
  const join = createJoinWaitlist(
    {
      join: async () => {
        calls += 1;
        return { position: 1, alreadyJoined: false, applyToken: null };
      },
    },
    applicantsWith({}),
  );

  for (const email of [
    "",
    "not-an-email",
    "a@b",
    "two words@example.com",
    `${"x".repeat(250)}@example.com`,
  ]) {
    await assert.rejects(join(email), InvalidEmailError);
  }
  assert.equal(calls, 0);
});

test("a repeat signup gets the apply token back only from the browser that holds it", async () => {
  const waitlist: WaitlistRepository = {
    join: async () => ({ position: 7, alreadyJoined: true, applyToken: null }),
  };
  const join = createJoinWaitlist(
    waitlist,
    applicantsWith({ mine: applicant("me@example.com"), theirs: applicant("them@example.com") }),
  );

  assert.equal((await join("me@example.com", { currentToken: "mine" })).applyToken, "mine");
  assert.equal((await join("me@example.com", { currentToken: "theirs" })).applyToken, null);
  assert.equal((await join("me@example.com")).applyToken, null);
});
