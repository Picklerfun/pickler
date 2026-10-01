// What the screenshot comparison says about a pair of shots, without a browser.
import assert from "node:assert/strict";
import test from "node:test";
import { line, readNoise } from "./lib/compare-report.mjs";

const moved = (changed) => ({
  resized: false,
  changed,
  box: { left: 10, top: 20, right: 30, bottom: 40 },
  before: [1400, 1000],
  after: [1400, 1000],
});

test("identical shots say nothing", () => {
  assert.equal(line("landing-desktop.png", { ...moved(0), box: null }), null);
});

test("a shot that moved says how much and where", () => {
  assert.equal(
    line("agents-desktop.png", moved(0.25)),
    "DIFFERS  agents-desktop.png  25.000% of pixels, inside x 10–30, y 20–40",
  );
});

test("a shot that changed size is not compared pixel by pixel", () => {
  const said = line("apply-phone.png", {
    resized: true,
    changed: null,
    box: null,
    before: [390, 844],
    after: [390, 900],
  });

  assert.equal(said, "RESIZED  apply-phone.png  390×844 → 390×900 (not compared pixel by pixel)");
});

test("a noise file is read from this script's own output", () => {
  const noise = readNoise(
    "DIFFERS  token-desktop.png  0.031% of pixels, inside x 184–677, y 658–666\n" +
      "compare: 78 screen(s) identical, 0 within noise, 1 to look at, of 79.\n",
  );

  assert.deepEqual([...noise], [["token-desktop.png", 0.031]]);
});

test("a screen that moves by itself is noise up to three times what it moved", () => {
  const noise = new Map([["studio-activity-desktop.png", 0.174]]);

  assert.match(
    line("studio-activity-desktop.png", moved(0.005), noise),
    /^NOISE {4}studio-activity/,
  );
  assert.match(
    line("studio-activity-desktop.png", moved(0.006), noise),
    /^DIFFERS {2}studio-activity/,
  );
});

test("very small noise still allows 0.05%, and a screen with no noise allows none", () => {
  const noise = new Map([["account-phone.png", 0.001]]);

  assert.match(line("account-phone.png", moved(0.0005), noise), /^NOISE/);
  assert.match(line("account-phone.png", moved(0.0006), noise), /^DIFFERS/);
  assert.match(line("landing-phone.png", moved(0.0001), noise), /^DIFFERS/);
});
