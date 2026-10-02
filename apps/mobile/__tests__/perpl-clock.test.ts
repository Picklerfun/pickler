import { CLOCK_SKEW_MAX_MS, clockSkewMs, describeClockSkew, KEY_REJECTED_COPY } from "../src/perpl/clock";

test("clockSkewMs is server minus phone, or null without a server time", () => {
  expect(clockSkewMs(1_000_000, 1_000_000)).toBe(0);
  expect(clockSkewMs(1_030_000, 1_000_000)).toBe(30_000);
  expect(clockSkewMs(1_000_000, 1_030_000)).toBe(-30_000);
  expect(clockSkewMs(null, 1_000_000)).toBeNull();
});

test("describeClockSkew warns beyond 20 s in either direction, with whole seconds in the copy", () => {
  expect(CLOCK_SKEW_MAX_MS).toBe(20_000);
  expect(describeClockSkew(null)).toBeNull();
  expect(describeClockSkew(20_000)).toBeNull();
  expect(describeClockSkew(-20_000)).toBeNull();
  expect(describeClockSkew(20_001)).toEqual({
    title: "Your phone's clock is off by 20 s.",
    body: "Perpl rejects signatures more than 30 s off — turn on Set automatically in Settings › General › Date & Time.",
  });
  expect(describeClockSkew(-125_400)?.title).toBe("Your phone's clock is off by 125 s.");
});

test("the key-rejected copy points at the clock first", () => {
  expect(KEY_REJECTED_COPY).toBe("Check the phone clock first; if it is right, Perpl may not be available in your region.");
});
