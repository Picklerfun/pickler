import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApplicantNotFoundError,
  ApplicationAlreadySubmittedError,
  ApplicationValidationError,
  createCheckTicker,
  createSubmitApplication,
  effectiveLinePosition,
  HandleTakenError,
  normalizeTicker,
  normalizeXHandle,
  TickerTakenError,
  validateApplication,
  type Applicant,
  type ApplicantRepository,
  type ApplicationInput,
  type SubmitOutcome,
} from "../src/index.js";

const input: ApplicationInput = {
  agentName: "  Halftime ",
  ticker: "half",
  xHandle: "https://x.com/halftimebot",
  category: "Sports",
  personality: "Analyst",
  edge: "It reads injury reports before the books move.",
  whyYou: "Six years of NBA props.",
};

const applicant: Applicant = {
  email: "a@b.co",
  linePosition: 1205,
  referralCode: "abc12345",
  referrals: 0,
  application: null,
};

function repository(
  outcome: SubmitOutcome,
  stored: Applicant | null = applicant,
): ApplicantRepository & { submitted: unknown[] } {
  const submitted: unknown[] = [];
  return {
    submitted,
    findByToken: async () => stored,
    submit: async (_token, application) => {
      submitted.push(application);
      return outcome;
    },
    isTickerAvailable: async (ticker) => ticker !== "$HALF",
  };
}

test("tickers and X handles are normalized", () => {
  assert.equal(normalizeTicker("$half"), "$HALF");
  assert.equal(normalizeTicker("  pick2 "), "$PICK2");
  assert.equal(normalizeTicker("$H"), null);
  assert.equal(normalizeTicker("$2HALF"), null);
  assert.equal(normalizeTicker("$TOOLONG"), null);
  assert.equal(normalizeXHandle("@@halftime_bot"), "@halftime_bot");
  assert.equal(normalizeXHandle("https://twitter.com/halftimebot/"), "@halftimebot");
  assert.equal(normalizeXHandle("half time"), null);
  assert.equal(normalizeXHandle("a".repeat(16)), null);
});

test("validation returns every problem at once", () => {
  const bad = {
    ...input,
    agentName: " ",
    ticker: "$",
    xHandle: "no spaces allowed",
    category: "Cooking",
    personality: "",
    edge: "x".repeat(141),
    whyYou: "",
  };
  try {
    validateApplication(bad);
    assert.fail("expected a validation error");
  } catch (error) {
    assert.ok(error instanceof ApplicationValidationError);
    assert.deepEqual(error.issues.map((i) => i.field).sort(), [
      "agentName",
      "category",
      "edge",
      "personality",
      "ticker",
      "whyYou",
      "xHandle",
    ]);
  }
});

test("submitting stores the normalized application and returns the applicant", async () => {
  const repo = repository("submitted");
  const result = await createSubmitApplication(repo)("token", input);

  assert.equal(result, applicant);
  assert.deepEqual(repo.submitted[0], {
    agentName: "Halftime",
    ticker: "$HALF",
    xHandle: "@halftimebot",
    category: "Sports",
    personality: "Analyst",
    edge: input.edge,
    whyYou: input.whyYou,
  });
});

test("submission failures map to business errors", async () => {
  const cases: [SubmitOutcome, new (...args: never[]) => Error][] = [
    ["not_found", ApplicantNotFoundError],
    ["already_submitted", ApplicationAlreadySubmittedError],
    ["ticker_taken", TickerTakenError],
    ["handle_taken", HandleTakenError],
  ];
  for (const [outcome, errorType] of cases) {
    await assert.rejects(createSubmitApplication(repository(outcome))("token", input), errorType);
  }
  await assert.rejects(
    createSubmitApplication(repository("submitted"))(null, input),
    ApplicantNotFoundError,
  );
});

test("invalid answers never reach the repository", async () => {
  const repo = repository("submitted");
  await assert.rejects(
    createSubmitApplication(repo)("token", { ...input, category: "Cooking" }),
    ApplicationValidationError,
  );
  assert.equal(repo.submitted.length, 0);
});

test("ticker check normalizes before asking the repository", async () => {
  const check = createCheckTicker(repository("submitted"));
  assert.deepEqual(await check("half"), { ticker: "$HALF", available: false });
  assert.deepEqual(await check("$pick"), { ticker: "$PICK", available: true });
  await assert.rejects(check("$"), ApplicationValidationError);
});

test("referrals move an applicant up but never past the front", () => {
  assert.equal(effectiveLinePosition({ linePosition: 1205, referrals: 3 }), 1145);
  assert.equal(effectiveLinePosition({ linePosition: 30, referrals: 5 }), 1);
});
