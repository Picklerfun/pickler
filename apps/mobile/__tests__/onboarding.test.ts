import { ONBOARDING_SHEETS, onboardingExit, shouldOnboard } from "../src/onboarding";

test("only after creating a wallet, and only once (D21, Review Focus 3)", () => {
  expect(shouldOnboard("up", false)).toBe(true);
  expect(shouldOnboard("up", true)).toBe(false);
  expect(shouldOnboard("in", false)).toBe(false);
});

test("closing lands on the held action, else Markets (D21, Review Focus 3)", () => {
  expect(onboardingExit("portfolio")).toBe("portfolio");
  expect(onboardingExit(undefined)).toBe("markets");
});

test("3 sheets, copy for what the app does: no sports, no Back it (D21)", () => {
  expect(ONBOARDING_SHEETS.map((s) => s.title)).toEqual(["AGENTS READ THE MARKET.", "PICK A SQUARE.", "ASK, OR TRADE."]);
  const all = ONBOARDING_SHEETS.map((s) => `${s.title} ${s.body}`).join(" ");
  expect(all).not.toMatch(/back it|lakers|celtics|chiefs|memecoin|token/i);
});
