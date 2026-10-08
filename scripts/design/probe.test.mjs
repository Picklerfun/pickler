// The token check's pieces. Finding the colours in a computed value, and the verdict on what a page
// paints, are judged without a page; the values below are what Chromium hands back for the
// declarations named. The probes are then run in a real page over a passing and a failing fixture.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after } from "node:test";
import { openBrowser } from "./lib/browser.mjs";
import { hex } from "./lib/colour.mjs";
import { COLOUR, coloursIn, paintedColours, resolveTokens } from "./lib/probe.mjs";
import { strays } from "./lib/strays.mjs";

test("a shadow list gives up every colour in it, in order", () => {
  assert.deepEqual(
    coloursIn(
      "rgba(255, 255, 255, 0.3) 0px 2px 0px 0px inset, rgba(200, 240, 58, 0.32) 0px 0px 24px 0px",
    ),
    ["rgba(255, 255, 255, 0.3)", "rgba(200, 240, 58, 0.32)"],
  );
});

test("a gradient gives up its stops, transparent ones included", () => {
  assert.deepEqual(
    coloursIn("radial-gradient(120% 80% at 50% 0%, rgb(27, 31, 107) 0%, rgba(0, 0, 0, 0) 100%)"),
    ["rgb(27, 31, 107)", "rgba(0, 0, 0, 0)"],
  );
});

test("a drop-shadow filter gives up its colour", () => {
  assert.deepEqual(coloursIn("drop-shadow(rgba(90, 216, 255, 0.55) 0px 0px 12px)"), [
    "rgba(90, 216, 255, 0.55)",
  ]);
});

test("a colour mixed by the browser is still a colour", () => {
  assert.deepEqual(coloursIn("color(srgb 0.78 0.94 0.23 / 0.6) 0px 0px 12px 0px"), [
    "color(srgb 0.78 0.94 0.23 / 0.6)",
  ]);
});

test("a value with no colour in it gives up nothing", () => {
  assert.deepEqual(coloursIn("none"), []);
  assert.deepEqual(coloursIn("blur(16px)"), []);
});

// The verdict, from what the two probes return. Scope 0 is the page; scope 1 a dark surface.
const TOKENS = {
  names: ["--pk-ink", "--pk-panel", "--pk-glow"],
  values: [
    ["rgb(11, 13, 26)", "rgb(255, 255, 255)", "rgba(200, 240, 58, 0.32)"],
    ["rgb(245, 246, 250)", "rgb(21, 24, 42)", "rgba(200, 240, 58, 0.32)"],
  ],
};
const paint = (value, role, scope = 0) => ({ value, role, scope, selector: `div.${role}` });

test("a paint some token of its own surface holds is no stray, in any role", () => {
  const painted = [
    paint("rgb(11, 13, 26)", "text"),
    paint("rgba(200, 240, 58, 0.32)", "box-shadow"),
    paint("rgba(200, 240, 58, 0.32)", "filter", 1),
    paint("rgb(21, 24, 42)", "background-image", 1),
    paint("rgba(0, 0, 0, 0)", "background-image"),
  ];

  assert.deepEqual(strays(TOKENS, painted), []);
});

test("a paint no token holds is a stray, once per colour and role", () => {
  const painted = [
    paint("rgba(255, 255, 255, 0.23)", "box-shadow"),
    paint("rgba(255, 255, 255, 0.23)", "box-shadow"),
    paint("rgba(255, 255, 255, 0.23)", "outline"),
  ];

  const found = strays(TOKENS, painted).map(({ paint, count }) => [paint.role, count]);

  assert.deepEqual(found, [
    ["box-shadow", 2],
    ["outline", 1],
  ]);
});

test("a colour only the other surface holds is a stray on this one", () => {
  const found = strays(TOKENS, [paint("rgb(21, 24, 42)", "fill", 0)]);

  assert.equal(found.length, 1);
  assert.equal(found[0].paint.role, "fill");
});

/* The probes themselves, in a real page. Playwright is installed on the machine and not in the
 * repository, so where there is no browser — the `source` CI job — these are skipped, not failed. */
const FIXTURES = new URL("./fixtures/paint/", import.meta.url);
const css = readFileSync(new URL("tokens.css", FIXTURES), "utf8");
let browser = null;
// A reason to skip, or false: node:test skips on any string, the empty one included.
let unavailable = false;
try {
  browser = await openBrowser();
} catch (error) {
  unavailable = `no browser: ${error.message.split("\n")[0]}`;
}
after(() => browser?.close());

async function judge(fixture) {
  const page = await browser.newPage();
  const body = readFileSync(new URL(fixture, FIXTURES), "utf8");
  await page.setContent(`<!doctype html><style>${css}</style><body>${body}</body>`);
  const tokens = await page.evaluate(resolveTokens);
  const painted = await page.evaluate(paintedColours, COLOUR);
  await page.close();
  return strays(tokens, painted).map(({ paint, colour }) => `${paint.role} ${hex(colour)}`);
}

test(
  "in a page, every paint read from a token of its surface passes",
  { skip: unavailable },
  async () => {
    assert.deepEqual(await judge("pass.html"), []);
  },
);

test(
  "in a page, a literal in each role the check reads is caught",
  { skip: unavailable },
  async () => {
    assert.deepEqual((await judge("fail.html")).sort(), [
      "background #15182A",
      "background-image #123456",
      "box-shadow #FF0000",
      "fill #ABCDEF",
      "filter #0000FF",
      "outline #FF00FF",
      "stroke #FEDCBA",
      "text-shadow #00FF00",
    ]);
  },
);

test(
  "zero-area clips do not paint, including a pre-hydration native form shim",
  { skip: unavailable },
  async () => {
    const page = await browser.newPage();
    try {
      for (const position of ["absolute", "fixed"]) {
        await page.setContent(`<!doctype html><style>${css}</style><body>
        <select aria-hidden="true" tabindex="-1" style="position:${position};width:1px;height:1px;clip:rect(0px,0px,0px,0px);background:#123456"><option>hidden</option></select>
      </body>`);
        assert.equal(await page.locator("select").evaluate((node) => node.checkVisibility()), true);
        const tokens = await page.evaluate(resolveTokens);
        const painted = await page.evaluate(paintedColours, COLOUR);
        assert.deepEqual(strays(tokens, painted), [], position);
      }
    } finally {
      await page.close();
    }
  },
);

test(
  "nonzero clips and inactive static clips still reject literal paint",
  { skip: unavailable },
  async () => {
    const page = await browser.newPage();
    try {
      for (const [position, clip] of [
        ["absolute", "rect(0px,10px,10px,0px)"],
        ["static", "rect(0px,0px,0px,0px)"],
      ]) {
        await page.setContent(`<!doctype html><style>${css}</style><body>
        <div style="position:${position};width:20px;height:20px;clip:${clip};background:#123456"></div>
      </body>`);
        const tokens = await page.evaluate(resolveTokens);
        const painted = await page.evaluate(paintedColours, COLOUR);
        assert.ok(strays(tokens, painted).some(({ paint }) => paint.role === "background"));
      }
    } finally {
      await page.close();
    }
  },
);
