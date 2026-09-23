# Design system v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Pickler one token system across two surfaces — a light marketplace and a night-blue studio — and build the five redesigned screens on it.

**Architecture:** `packages/ui/src/styles.css` already redefines semantic token names per `data-surface`. Keep the names, change the values, rename the switch from `public|console` to `light|dark`, and let nesting the opposite value invert any subtree. Seventeen files consume those names and inherit the change. Playwright scripts verify the rendered page, not this document.

**Tech Stack:** CSS custom properties, CSS modules, Next.js 16, React 19, `next/font/google` (Archivo variable + Instrument Sans), Playwright 1.63 (global, not a repo dependency), `node:test` with `tsx`.

**Spec:** `docs/specs/design-system-v2.md`. Read it before Task 1.

---

## Orientation

**Where the truth lives, and it is not this plan.** For the token tasks, this document carries the
exact values, read out of the canvases and checked. For the five screen tasks it does not carry the
markup, and that is deliberate rather than an omission: the canvas _is_ the specification, it is
readable through DesignSync, and a previous plan in this repository produced twenty-one defects
whose dominant shape was a specification that disagreed with the source. Markup transcribed here
from memory would be a fourth-hand copy of something the implementer can read first-hand.

So each screen task gives three things instead: the canvas to read, its structural inventory taken
from the file, and the Playwright assertions that define done. The assertions are the contract.

**Reading a canvas.** The design MCP (`claude-design`) fails to connect, and `DesignSync` — which
reaches the same project — is not exposed to subagents. So three canvases are extracted to disk,
outside the repository so they are not committed:

```
/Users/Juvenal/Development/Pickler/canvas/Pickler Studio v4.dc.html
/Users/Juvenal/Development/Pickler/canvas/Pickler Studio Empty.dc.html
/Users/Juvenal/Development/Pickler/canvas/Pickler Auth Passkey Flow.dc.html
```

The other three — Landing Waitlist, Portfolio Light and Account — arrive inline rather than on disk,
so their tasks carry a written specification instead. That is the better handover anyway: these
screens are built from tokens, and a canvas's inline styles are values without meaning. A
specification says which token, which is the thing that has to be right.

Canvases are 50–105 KB and arrive as a `.dc.html` with inline styles and an `x-dc` template
dialect (`sc-for`, `sc-if`, `{{ binding }}`). Read them for structure, spacing and copy. Do not port
the dialect; the bindings show what is data and what is static.

**Two facts about the tree.** Tokens live in `packages/ui/src/styles.css`: lines 1–104 are tokens,
105–561 are the components that use them. Seventeen files consume `--pk-*` names, three of them TSX
(`packages/ui/src/chart.tsx`, `apps/web/src/features/landing/components/launching-now.tsx`,
`apps/web/src/features/auth/components/steps/passkey-step.tsx`).

**Commands:**

| Purpose               | Command                                                 |
| --------------------- | ------------------------------------------------------- |
| Dev server            | `npm run dev` (serves `http://localhost:3000`)          |
| Dev server with data  | see below — **not** `npm run dev`                       |
| The API fixture       | `node --import tsx scripts/design/fixture-api.mjs 8787` |
| A verification script | `node scripts/design/<name>.mjs`                        |
| Types                 | `npm run typecheck`                                     |
| Lint and format       | `npm run lint` · `npx prettier --check .`               |
| Everything            | `npm test`                                              |
| Web build             | `npx turbo build --filter=@pickler/web`                 |

Every marketplace and auth route renders on the server and asks the API for its data, so with no API
they answer 500 and a check reads a stack trace rather than a page. `scripts/design/fixture-api.mjs`
serves them from the product's own sample adapters. Point the app at it — and note the command:
`npm run dev` goes through Turborepo, whose `dev` task declares no `env`, so it strips
`PICKLER_API_LOCAL_URL` and every route answers 503 exactly as it does with no fixture running at
all. Run Next directly.

```bash
node --import tsx scripts/design/fixture-api.mjs 8787
cd apps/web && PICKLER_API_LOCAL_URL=http://127.0.0.1:8787 npx next dev
```

**What this plan has learned, from the custody work that preceded it.** Twenty-one defects, all in
the specification, none visible by reading:

1. **Assert against what reached the collaborator**, never against a constant a fake returns.
2. **Prove each test can fail, and prove the sabotage landed** — assert the target text occurs
   exactly once, diff against pristine text held in memory, confirm the test is green before the
   mutation, and confirm your failure parsing matches the runner's real output. A harness once
   reported eleven fabricated findings.
3. **Pin against an external source** — a vendor's types, a canvas — rather than against prose.
   The most instructive defect was a wrong literal that had a test agreeing with it, because
   whoever writes the test holds the same wrong assumption as the code.
4. **An assert after a failing assert in the same test never runs**, so a test with several asserts
   hides every one after the first failure. The runner reports the file red either way, and once the
   first assert is fixed the rest execute for the first time — which is how a wrong expectation rode
   along unexecuted in the harness that checks every colour in this product. One behaviour per test,
   or collect the failures and assert once at the end.
5. **A token migration only moves the code that already used tokens.** It substitutes names, and a
   hex has no name to substitute, so a page can pass a migration untouched and still be unreadable —
   grep for literals as well as for names. Lightening six marketplace routes surfaced an amber and a
   violet set as text at 1.5:1 and 2.1:1 on white, and seven control grounds made of the old dark
   page's near-black, none of which any rename could have reached.
6. **A construction can be correct on one surface and structurally impossible on the other.** Unlike
   the lessons above, this is not about checks. An accent set on a 14% wash of itself is a bright
   letter on a dim tile over black, and over white it is a pale letter on very nearly nothing — at
   40px weak, at 16px absent. No retinting fixes it, because there is no value that works: the
   second colour has to come from somewhere else, which is what a tint-and-ink pair is for. When a
   surface changes, ask which constructions have no form on the new one, not only which values are
   wrong.
7. **A check that cannot tell which layer failed will send someone to the wrong one**, and the cost
   is paid by whoever reads the output rather than whoever wrote it. Three processes fail
   independently behind these checks — the script, the dev server, and the API fixture — and only
   one of them fails visibly: a dead dev server refuses the connection, while a dead fixture leaves
   a healthy app answering 500 with a stack trace pointing at `api-client.ts`. A message naming the
   wrong one costs an hour of debugging a design system that is fine. Name each failure by what was
   observed, say which layer to look at, and give the remedy once rather than once per route.

---

## File structure

**Created**

| File                            | Responsibility                                                    |
| ------------------------------- | ----------------------------------------------------------------- |
| `scripts/design/lib/render.mjs` | launch Chromium, visit a route, hand back a page                  |
| `scripts/design/lib/colour.mjs` | parse computed colours, composite alpha, WCAG ratio               |
| `scripts/design/contrast.mjs`   | every text node's real ink against its painted ground             |
| `scripts/design/tokens.mjs`     | every colour on screen resolves to a token                        |
| `scripts/design/surfaces.mjs`   | both grounds, and nesting inverts                                 |
| `scripts/design/type.mjs`       | display headings carry Archivo's width axis                       |
| `scripts/design/shots.mjs`      | screenshots at two widths                                         |
| `scripts/design/routes.mjs`     | the five routes and their expected surface, shared by all scripts |

**Modified**

| File                                                       | Change                                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/ui/src/styles.css`                               | the token block, the surface switch, and the three components that read the retired mono |
| `apps/web/src/app/layout.tsx`                              | Archivo + Instrument Sans replace three faces                                            |
| `apps/web/src/app/globals.css`                             | surface attribute on the body                                                            |
| the fourteen feature CSS modules                           | mono references, and any token that does not survive                                     |
| `apps/web/src/features/landing/**`                         | the shorter light landing                                                                |
| `apps/web/src/features/wallet/components/portfolio-page.*` | the light portfolio                                                                      |
| `apps/web/src/features/console/**`                         | studio v4 and the empty journey                                                          |
| `apps/web/src/app/account/**`                              | new route                                                                                |

---

## Task 1: The two surfaces

**Files:**

- Modify: `packages/ui/src/styles.css:12-104`

- [ ] **Step 1: Read what is there now**

Read lines 1–104. There are three blocks: a `:root` of shape and accent tokens, a
`[data-surface="public"], :root` block, and a `[data-surface="console"]` block. Note every token
name — the names survive, so a name you drop is a consumer you break.

- [ ] **Step 2: Replace the two surface blocks**

Keep the file's comment voice: say why, not what.

```css
/* One dark in the product and one light, and either can appear inside the other. A surface is not
 * a page theme: it is a property any subtree takes with data-surface, so nesting the opposite value
 * inverts everything inside it. That is how the landing's dark panels and the account's white
 * wallet card work, with no rule of their own. Light is the default. */
[data-surface="light"],
:root {
  --pk-bg: #ffffff;
  --pk-ink: #0b0d1a;
  /* Light has no softened ink: body copy inside a white card is full strength, and the step below
   * is already the muted grey. The slot exists for components that read it and does nothing here. */
  --pk-ink-soft: var(--pk-ink);
  --pk-ink-muted: #5a5f78;
  --pk-ink-faint: #6b7186;
  --pk-panel: #f5f6fa;
  --pk-panel-2: #f1f2f7;
  --pk-panel-3: #e2e5ee;
  --pk-rule: rgba(11, 13, 26, 0.08);
  --pk-rule-strong: rgba(11, 13, 26, 0.12);
  --pk-nav-bg: rgba(255, 255, 255, 0.88);
  --pk-popover: #ffffff;
  --pk-popover-shadow: 0 1px 0 rgba(11, 13, 26, 0.08), 0 24px 60px -20px rgba(11, 13, 26, 0.35);
  --pk-focus: var(--pk-violet);
}

/* The studio, the account and the auth screens. Night blue, not black: #0B0D1A carries a clear blue
 * dominant, and its panels are navy. Pure white body copy on it is harsh, which is what ink-soft is
 * for — the level light does not need. */
[data-surface="dark"] {
  --pk-bg: #0b0d1a;
  --pk-ink: #ffffff;
  --pk-ink-soft: #c7cad8;
  --pk-ink-muted: #9aa0b8;
  --pk-ink-faint: #5a5f78;
  --pk-panel: #15182a;
  --pk-panel-2: #1c2036;
  --pk-panel-3: #25293d;
  --pk-rule: rgba(255, 255, 255, 0.08);
  --pk-rule-strong: rgba(255, 255, 255, 0.12);
  /* Opaque. The landing's nav is translucent over a scrolling page; the studio's top bar sits on a
   * fixed layout and is solid. */
  --pk-nav-bg: #0b0d1a;
  --pk-popover: #15182a;
  --pk-popover-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
  --pk-focus: var(--pk-lime);
}
```

- [ ] **Step 3: Check nothing references the old switch**

Run: `grep -rn 'data-surface' apps/web/src packages/ui/src`
Every `"public"` becomes `"light"` and every `"console"` becomes `"dark"`. Change them all now;
a stale value silently falls through to the default and looks almost right.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/styles.css apps/web/src
git commit -m "Give the product one dark and one light"
```

Append `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` to this and every commit below.

---

## Task 2: Accents and state pairs

**Files:**

- Modify: `packages/ui/src/styles.css` (the `:root` accent block, and both surface blocks)

- [ ] **Step 1: Replace the accents**

In the shared `:root`:

```css
--pk-lime: #c8f03a;
--pk-lime-hover: #d6f95c;
--pk-amber: #ffc93f;
--pk-orange: #ff7a3d;
--pk-blue: #5b8cff;
--pk-magenta: #ff5fa2;
```

Then, per surface, the accents whose value or ink changes. In `[data-surface="light"], :root`:

```css
--pk-violet: #5b3ce0;
--pk-violet-ink: #5b3ce0;
--pk-magenta-ink: #c62c62;
--pk-win: #2e7d32;
--pk-loss: #c62c62;
```

In `[data-surface="dark"]`:

```css
--pk-violet: #9b7bff;
--pk-violet-ink: #b9a6ff;
--pk-magenta-ink: #ff9ec6;
--pk-win: #c8f03a;
--pk-loss: #ff9ec6;
```

`--pk-win` and `--pk-loss` are the change that matters. Lime and pink read on black and vanish on
white; the light pair is a green and a red chosen to survive it.

- [ ] **Step 2: Add the state pairs**

Each state is a tint and an ink legible on that tint. A tinted object reads as a state, never as a
control, so it never takes a button's fill. In `[data-surface="light"], :root`:

```css
--pk-state-good-bg: #edf7ce;
--pk-state-good-ink: #3f6b00;
--pk-state-win-bg: #e4f3e5;
--pk-state-win-ink: #2e7d32;
--pk-state-caution-bg: #fbf0d4;
--pk-state-caution-ink: #8a6200;
--pk-state-loss-bg: #fbe4ec;
--pk-state-loss-ink: #c62c62;
--pk-state-info-bg: #f1eeff;
--pk-state-info-ink: #5b3ce0;
--pk-state-cool-bg: #eaf0ff;
--pk-state-cool-ink: #2f55c8;
```

In `[data-surface="dark"]`:

```css
--pk-state-good-bg: #2a3a0f;
--pk-state-good-ink: #c8f03a;
--pk-state-win-bg: #2a3a0f;
--pk-state-win-ink: #c8f03a;
--pk-state-caution-bg: #3a2e0b;
--pk-state-caution-ink: #ffc93f;
--pk-state-loss-bg: #3a1626;
--pk-state-loss-ink: #ff9ec6;
/* Derived, not observed: no canvas in this set shows these two on dark. Same method as the pairs
   * above — the accent at roughly 18% over the ground. Check against a canvas that uses them. */
--pk-state-info-bg: #231b3e;
--pk-state-info-ink: #b9a6ff;
--pk-state-cool-bg: #141c33;
--pk-state-cool-ink: #5b8cff;
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/styles.css
git commit -m "Make a state legible on the ground it sits on"
```

---

## Task 3: The shape scale

**Files:**

- Modify: `packages/ui/src/styles.css` (the `:root` radius block)

- [ ] **Step 1: Replace the radii**

The canvases use 2, 3, 4, 5, 8, 9, 10, 12, 13, 14, 16, 18, 20, 24, 28 and pill. Collapsed to eight
steps, keeping every value that carries a distinct role:

```css
/* Marks and dots take mark; chips and tiles sm; rail and menu rows md; stat tiles lg; cards xl;
   * panels 2xl; full-width sections 3xl. Every action, chip and status is a pill. Nothing square. */
--pk-radius-mark: 4px;
--pk-radius-sm: 12px;
--pk-radius-md: 14px;
--pk-radius-lg: 16px;
--pk-radius-xl: 20px;
--pk-radius-2xl: 24px;
--pk-radius-3xl: 28px;
--pk-radius-pill: 999px;
```

- [ ] **Step 2: Migrate the old names**

Run: `grep -rn 'pk-radius-' apps/web/src packages/ui/src`

The old set was `sm: 6px, md: 12px, lg: 16px, xl: 24px, pill`. Map each use: old `sm` becomes
`mark`, old `md` becomes `sm`, old `lg` stays `lg`, old `xl` becomes `2xl`. Do not leave an old name
defined as an alias — an alias is how two scales live side by side for a year.

- [ ] **Step 3: Verify and commit**

Run: `grep -rn 'pk-radius-\(sm\|md\|lg\|xl\)' apps/web/src packages/ui/src` and read each hit
against the mapping above.

```bash
git add packages/ui/src/styles.css apps/web/src
git commit -m "Give shape a scale instead of a habit"
```

---

## Task 4: The typefaces, and retiring the monospace

**Files:**

- Modify: `apps/web/src/app/layout.tsx:1-25`, `packages/ui/src/styles.css`
- Modify: the components and modules that read `--pk-font-mono`

- [ ] **Step 1: Replace the faces**

In `layout.tsx`, the three imports become two. Archivo is variable and the canvases set its width
axis, so the weight range must be loaded as a range, not as a list:

```tsx
import { Archivo, Instrument_Sans } from "next/font/google";

const display = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-display",
  display: "swap",
});
const body = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});
```

Remove `mono` and its `variable` from the `<html>` className list.

- [ ] **Step 2: Set the tokens**

```css
--pk-font-display: var(--font-display), Archivo, sans-serif;
--pk-font: var(--font-body), "Instrument Sans", sans-serif;
/* The display face is only itself with its width axis set. Archivo at the right weight and the
   * wrong width is a different typeface, and nothing on screen says so. */
--pk-display-wdth: "wdth" 112;
```

Delete `--pk-font-mono`.

A token nobody applies is a token that does nothing, so apply it where the display face is used.
Add this to the same file, after the token block:

```css
/* Anything set in the display face carries its width axis. Declaring the axis and forgetting to
 * apply it is the failure this rule exists to make impossible. */
[style*="--pk-font-display"],
.pk-display,
h1,
h2 {
  font-family: var(--pk-font-display);
  font-variation-settings: var(--pk-display-wdth);
}
```

If a heading in a feature module sets its own `font-family`, it must set
`font-variation-settings: var(--pk-display-wdth)` beside it.

- [ ] **Step 3: Move the three components off the monospace**

Run: `grep -rn 'pk-font-mono' apps/web/src packages/ui/src`

`.pk-button[data-mono="true"]`, `.pk-chip` and `.pk-tag` read it. Each becomes Instrument Sans at
its existing size with wide tracking, which is what every canvas does in place of a monospace:

```css
font-family: var(--pk-font);
letter-spacing: 0.08em;
```

Keep the `data-mono` attribute name — it now means "the uppercase micro label", which is what it
always meant on screen.

- [ ] **Step 4: Verify the axis actually loads**

Run: `npm run dev`, open `http://localhost:3000`, and in the console:

```js
getComputedStyle(document.querySelector("h1")).fontVariationSettings;
```

Expected: a string containing `wdth`. If it reads `normal`, the axis did not load and every display
heading is the wrong typeface — stop and fix it before continuing, because Task 5's check will only
tell you the same thing later.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/layout.tsx packages/ui/src/styles.css apps/web/src
git commit -m "Take the typeface the design actually uses"
```

---

## Task 5: The verification harness

**Files:**

- Create: `scripts/design/routes.mjs`, `scripts/design/lib/render.mjs`, `scripts/design/lib/colour.mjs`

Playwright 1.63 is installed globally with Chromium cached. It is deliberately not a repository
dependency: these verify a running dev server, they are not a suite the build depends on.

- [ ] **Step 1: The shared route list**

```js
// scripts/design/routes.mjs
// The five screens this change builds, and the ground each must paint. Everything in scripts/design
// reads this, so a route added here is a route every check covers.
export const ROUTES = [
  { path: "/", name: "landing", surface: "light" },
  { path: "/portfolio", name: "portfolio", surface: "light" },
  { path: "/console", name: "studio", surface: "dark" },
  // The empty studio is a state, not a route: the console renders it when the signed-in person has
  // no agents. Task 12 adds `?state=empty` so it can be reached without emptying a database, and
  // this entry exists to make that explicit rather than to describe something that already works.
  { path: "/console?state=empty", name: "studio-empty", surface: "dark" },
  { path: "/account", name: "account", surface: "dark" },
];

export const GROUND = { light: "rgb(255, 255, 255)", dark: "rgb(11, 13, 26)" };
```

- [ ] **Step 2: The browser helper**

```js
// scripts/design/lib/render.mjs
import { chromium } from "playwright";

const BASE = process.env.DESIGN_BASE_URL ?? "http://localhost:3000";

/** Opens each route in turn and hands the page to `visit`. Fails loudly if the server is down,
 *  rather than reporting an empty page as a page with no problems. */
export async function eachRoute(routes, visit, { width = 1400, height = 1000 } = {}) {
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const route of routes) {
      const page = await browser.newPage({ viewport: { width, height } });
      const response = await page.goto(BASE + route.path, { waitUntil: "networkidle" });
      if (!response || !response.ok()) {
        throw new Error(
          `${route.path} answered ${response ? response.status() : "nothing"} — is the dev server running?`,
        );
      }
      results.push({ route, value: await visit(page, route) });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}
```

- [ ] **Step 3: The colour helper**

```js
// scripts/design/lib/colour.mjs

/** "rgb(11, 13, 26)" or "rgba(11, 13, 26, 0.5)" to [r,g,b,a]. */
export function parse(value) {
  const nums = String(value).match(/[\d.]+/g);
  if (!nums || nums.length < 3) {
    return null;
  }
  return [
    Number(nums[0]),
    Number(nums[1]),
    Number(nums[2]),
    nums[3] === undefined ? 1 : Number(nums[3]),
  ];
}

/** Paint `over` onto `under`. A translucent ink over a ground is what the eye sees, and comparing
 *  the ink's own rgba to the ground would report a contrast nobody experiences. */
export function composite(over, under) {
  const a = over[3];
  return [0, 1, 2].map((i) => over[i] * a + under[i] * (1 - a)).concat(1);
}

function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export const hex = ([r, g, b]) =>
  "#" + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
```

- [ ] **Step 4: Prove the maths before trusting it**

The helper is about to judge every colour in the product. Check it against two pairs whose ratio is
public knowledge:

```bash
node -e "
import('./scripts/design/lib/colour.mjs').then(({parse,ratio}) => {
  const black = parse('rgb(0,0,0)'), white = parse('rgb(255,255,255)');
  console.log('black on white:', ratio(black, white).toFixed(2), '(expect 21.00)');
  console.log('same on same:', ratio(white, white).toFixed(2), '(expect 1.00)');
});
"
```

Expected: `21.00` and `1.00`. A harness that cannot compute a known answer will confidently report
unknown ones.

- [ ] **Step 5: Commit**

```bash
git add scripts/design/
git commit -m "Measure the page, since a table cannot see a wrong token"
```

---

## Task 6: Contrast, measured on the DOM

**Files:**

- Create: `scripts/design/contrast.mjs`

- [ ] **Step 1: Write the check**

```js
// scripts/design/contrast.mjs
// Walks every text node, reads its computed ink and the nearest ancestor that actually paints a
// ground, and reports the WCAG ratio between them. This is the check that catches a component
// reading --pk-ink-faint where it should read --pk-ink-muted: the token table can be right while
// the component is wrong, and only the rendering shows it.
import { ROUTES } from "./routes.mjs";
import { eachRoute } from "./lib/render.mjs";
import { parse, composite, ratio, hex } from "./lib/colour.mjs";

const collect = () =>
  [...document.querySelectorAll("body *")]
    .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
    .map((el) => {
      const style = getComputedStyle(el);
      const grounds = [];
      for (let node = el; node; node = node.parentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        grounds.push(bg);
        if (bg && !bg.startsWith("rgba(0, 0, 0, 0)")) break;
      }
      return {
        selector:
          el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : ""),
        text: el.textContent.trim().slice(0, 40),
        colour: style.color,
        grounds,
        size: parseFloat(style.fontSize),
        weight: Number(style.fontWeight),
      };
    });

const results = await eachRoute(ROUTES, (page) => page.evaluate(collect));
let failures = 0;

for (const { route, value } of results) {
  for (const node of value) {
    const ink = parse(node.colour);
    let ground = parse(node.grounds[node.grounds.length - 1]);
    if (!ink || !ground) continue;
    if (ground[3] === 0) ground = [255, 255, 255, 1];
    const seen = ink[3] < 1 ? composite(ink, ground) : ink;
    const r = ratio(seen, ground);
    // Large text is 18.66px at 700, or 24px at any weight.
    const large = node.size >= 24 || (node.size >= 18.66 && node.weight >= 700);
    const need = large ? 3 : 4.5;
    if (r < need) {
      failures++;
      console.log(
        `${route.name} ${node.selector}: ${r.toFixed(2)} needs ${need}  ${hex(seen)} on ${hex(ground)}  "${node.text}"`,
      );
    }
  }
}

console.log(failures ? `\n${failures} contrast failures` : "\ncontrast: every text node passes");
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Prove it can fail**

With the dev server running, temporarily set `--pk-ink-muted` on the light surface to `#DDDDDD` in
`packages/ui/src/styles.css`, run the check, and confirm it reports failures naming that grey. Then
restore the file and confirm `git diff` is empty.

Run: `node scripts/design/contrast.mjs`

A check that has never failed is a check nobody has tested.

- [ ] **Step 3: Commit**

```bash
git add scripts/design/contrast.mjs
git commit -m "Read the contrast off the page, not off the plan"
```

---

## Task 7: The tokens are the source, and inversion works

**Files:**

- Create: `scripts/design/tokens.mjs`, `scripts/design/surfaces.mjs`

- [ ] **Step 1: Every colour resolves to a token**

```js
// scripts/design/tokens.mjs
// A colour that appears on screen and is in no token is a literal someone typed, wherever it lives.
import { ROUTES } from "./routes.mjs";
import { eachRoute } from "./lib/render.mjs";
import { parse, hex } from "./lib/colour.mjs";

const tokenValues = () => {
  const names = [...document.styleSheets]
    .flatMap((sheet) => {
      try {
        return [...sheet.cssRules];
      } catch {
        return [];
      }
    })
    .flatMap((rule) => (rule.style ? [...rule.style] : []))
    .filter((prop) => prop.startsWith("--pk-"));
  const out = new Set();
  for (const name of new Set(names)) {
    for (const el of [document.documentElement, ...document.querySelectorAll("[data-surface]")]) {
      const v = getComputedStyle(el).getPropertyValue(name).trim();
      if (v) out.add(v);
    }
  }
  return [...out];
};

const painted = () =>
  [...document.querySelectorAll("body *")].flatMap((el) => {
    const s = getComputedStyle(el);
    return [s.color, s.backgroundColor, s.borderTopColor].filter(
      (c) => c && !c.startsWith("rgba(0, 0, 0, 0)"),
    );
  });

const results = await eachRoute(ROUTES, async (page) => ({
  tokens: await page.evaluate(tokenValues),
  used: await page.evaluate(painted),
}));

let strays = 0;
for (const { route, value } of results) {
  const known = new Set(
    value.tokens.map((v) => {
      const p = parse(v);
      return p ? hex(p) : v;
    }),
  );
  const seen = new Set(value.used.map((v) => hex(parse(v))));
  for (const colour of seen) {
    if (!known.has(colour)) {
      strays++;
      console.log(`${route.name}: ${colour} is on screen and in no token`);
    }
  }
}

console.log(
  strays ? `\n${strays} colours are not tokens` : "\ntokens: every colour on screen is one",
);
process.exit(strays ? 1 : 0);
```

- [ ] **Step 2: Both grounds, and nesting inverts**

```js
// scripts/design/surfaces.mjs
// The mechanism the whole system rests on. If nesting does not invert, this is two themes sharing
// one name, and every inverted block in the canvases would need a rule of its own.
import { ROUTES, GROUND } from "./routes.mjs";
import { eachRoute } from "./lib/render.mjs";

const results = await eachRoute(ROUTES, async (page, route) => {
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const nested = await page.evaluate(() => {
    const host = document.querySelector("[data-surface] [data-surface]");
    if (!host) return null;
    const outer = host.parentElement.closest("[data-surface]");
    return {
      inner: getComputedStyle(host).getPropertyValue("--pk-bg").trim(),
      outer: getComputedStyle(outer).getPropertyValue("--pk-bg").trim(),
    };
  });
  return { bodyBg, nested, expected: GROUND[route.surface] };
});

let bad = 0;
for (const { route, value } of results) {
  if (value.bodyBg !== value.expected) {
    bad++;
    console.log(`${route.name}: ground is ${value.bodyBg}, expected ${value.expected}`);
  }
  if (value.nested && value.nested.inner === value.nested.outer) {
    bad++;
    console.log(`${route.name}: a nested surface did not invert — both are ${value.nested.inner}`);
  }
}

console.log(
  bad ? `\n${bad} surface failures` : "\nsurfaces: both grounds correct, nesting inverts",
);
process.exit(bad ? 1 : 0);
```

The landing and account both contain a nested surface, so `nested` must be non-null on at least
those two. If it is null everywhere, the inverted blocks were built with a literal rather than by
nesting, and the system is not doing the work.

- [ ] **Step 3: Commit**

```bash
git add scripts/design/tokens.mjs scripts/design/surfaces.mjs
git commit -m "Prove one dark can sit inside one light"
```

---

## Task 8: The width axis, and the screenshots

**Files:**

- Create: `scripts/design/type.mjs`, `scripts/design/shots.mjs`

- [ ] **Step 1: The display face carries its axis**

```js
// scripts/design/type.mjs
// Archivo at the right weight and the wrong width is a different typeface, and nothing on screen
// says so. This is the only way to see it.
import { ROUTES } from "./routes.mjs";
import { eachRoute } from "./lib/render.mjs";

const results = await eachRoute(ROUTES, (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("h1, h2")].map((el) => {
      const s = getComputedStyle(el);
      return { tag: el.tagName, family: s.fontFamily, axis: s.fontVariationSettings };
    }),
  ),
);

let bad = 0;
for (const { route, value } of results) {
  for (const h of value) {
    if (!/Archivo/i.test(h.family)) {
      bad++;
      console.log(`${route.name} ${h.tag}: family is ${h.family}, expected Archivo`);
    } else if (!/wdth/.test(h.axis)) {
      bad++;
      console.log(`${route.name} ${h.tag}: no width axis — reads "${h.axis}"`);
    }
  }
}

console.log(
  bad
    ? `\n${bad} display headings are wrong`
    : "\ntype: every display heading is Archivo with its axis",
);
process.exit(bad ? 1 : 0);
```

- [ ] **Step 2: Screenshots, for a person**

```js
// scripts/design/shots.mjs
// The checks above catch what is measurable. Spacing, rhythm and whether it reads like the canvas
// are not, and want eyes.
import { mkdir } from "node:fs/promises";
import { ROUTES } from "./routes.mjs";
import { eachRoute } from "./lib/render.mjs";

await mkdir("scripts/design/shots", { recursive: true });

for (const [label, width, height] of [
  ["desktop", 1400, 1000],
  ["phone", 390, 844],
]) {
  await eachRoute(
    ROUTES,
    (page, route) =>
      page.screenshot({ path: `scripts/design/shots/${route.name}-${label}.png`, fullPage: true }),
    { width, height },
  );
}

console.log("shots: written to scripts/design/shots/");
```

- [ ] **Step 3: Ignore the output directory**

Add to `.gitignore`:

```
scripts/design/shots/
```

- [ ] **Step 4: Commit**

```bash
git add scripts/design/type.mjs scripts/design/shots.mjs .gitignore
git commit -m "Catch a typeface wearing the wrong width"
```

---

## Task 8b: The marketplace shell

**Files:** Modify `apps/web/src/features/agents/components/public-shell.tsx` and its module CSS

This task was missing from the plan and its absence showed up as a contradiction: the pins put
`/portfolio` on the dark surface while `scripts/design/routes.mjs` expects it light.

`PublicShell` is one wrapper shared by agents, markets, tokens, reads, leaderboard, activity and
portfolio, and it is where `.space` paints its gradient and starfield. That is not portfolio's
problem, it is the shell's — and the new Portfolio canvas's nav _is_ the marketplace nav: a
translucent white bar, dropdown menus on white panels, a light wallet chip.

- [ ] **Step 1: Read the nav out of the canvas**

```
DesignSync { method: "get_file", projectId: "c03aadb4-7bb2-429e-aa49-98ae4218bc1f", path: "Portfolio Light.dc.html" }
```

The nav is the first block. Three dropdown menus — EXPLORE, BUILD, RESOURCES — each opening a white
panel of titled rows with a subtitle and an optional SOON chip; a wallet chip that is either
"Connect wallet" or an address with a live dot; and a dark "Create agent" action with a lime arrow
badge.

- [ ] **Step 2: Lighten the shell**

Move it to the light surface, delete `.space` and its gradients, and build the nav against the
tokens. Only the shell — the page bodies belong to their own tasks.

- [ ] **Step 3: Unpin what only inherited**

Remove the dark pin from portfolio, markets, tokens, reads, leaderboard and activity: they inherited
the shell's dark ground and had no dark composition of their own. `agents` and `apply` keep theirs —
they paint their own opaque layers, which is a different thing.

- [ ] **Step 4: Verify and commit**

```bash
node scripts/design/surfaces.mjs
```

```bash
git add apps/web/src/features
git commit -m "Let the marketplace share one white bar"
```

## Task 9: The landing

**Files:**

- Modify: `apps/web/src/features/landing/**`, `apps/web/src/app/page.tsx`

- [ ] **Step 1: Read the canvas**

```
DesignSync { method: "get_file", projectId: "c03aadb4-7bb2-429e-aa49-98ae4218bc1f", path: "Pickler Landing Waitlist.dc.html" }
```

Its structure, in order: a scrolling ticker tape on the dark surface; a translucent nav with one
link and a "Join waitlist" action; a dismissible news pill; a one-word hero (`PREDICT.`) at
`clamp(56px, 13vw, 190px)` with the full stop in lime; a three-column hero row — a light panel of
six perks, a dark mascot panel, and a stacked pair of light panels carrying a live counter and a
falling-blocks funding board; a "RUNS ON" strip; a dark `FOUR MOVES.` section of four cards; the
waitlist form; and a footer with the seven-colour swatch row.

- [ ] **Step 2: Build it against the tokens**

Every colour comes from Task 1 and Task 2. The dark blocks — tape, mascot panel, `FOUR MOVES` —
are `data-surface="dark"` subtrees, not literals. That is what `scripts/design/surfaces.mjs`
asserts, and building them with a hard-coded `#0B0D1A` will pass by eye and fail the check.

The current landing has sections the canvas does not: remove them rather than restyling them. The
canvas is shorter on purpose.

- [ ] **Step 3: Verify**

Run, with `npm run dev` in another shell:

```bash
node scripts/design/surfaces.mjs && node scripts/design/contrast.mjs && node scripts/design/type.mjs
```

Expected: all three exit 0. Then `node scripts/design/shots.mjs` and look at
`scripts/design/shots/landing-desktop.png` and `landing-phone.png` beside the canvas.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/landing apps/web/src/app/page.tsx
git commit -m "Say one word on a white page"
```

---

## Task 10: The portfolio

**Files:**

- Modify: `apps/web/src/features/wallet/components/portfolio-page.tsx`, `portfolio-page.module.css`

- [ ] **Step 1: Read the canvas**

```
DesignSync { method: "get_file", projectId: "c03aadb4-7bb2-429e-aa49-98ae4218bc1f", path: "Portfolio Light.dc.html" }
```

Structure: the light marketplace nav with three dropdown menus and a wallet chip; a display heading
`WHAT YOU HOLD.`; a two-column top row where the left panel is **dark** (total value, profit since
entry, three split tiles) and the right is light (open positions and a three-row ledger); a pill
tab track — Positions, Backed, Reads — and one row list per tab.

Each row carries a tinted square badge whose tint and ink are a state pair from Task 2, and a
profit figure in `--pk-win` or `--pk-loss`.

- [ ] **Step 2: Build it, and check the nesting**

The total-value panel is the one place on this page where `data-surface="dark"` nests inside light.
It is also where `--pk-win` must resolve to lime rather than to the light green, automatically,
because it is inside the dark subtree. If it renders green, the nesting is not real.

- [ ] **Step 3: Verify**

```bash
node scripts/design/surfaces.mjs && node scripts/design/contrast.mjs && node scripts/design/tokens.mjs
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/wallet
git commit -m "Put the dark panel inside the light page"
```

---

## Task 11: The studio

**Files:**

- Modify: `apps/web/src/features/console/**`, `apps/web/src/app/console/page.tsx`

- [ ] **Step 1: Read the canvas**

```
DesignSync { method: "get_file", projectId: "c03aadb4-7bb2-429e-aa49-98ae4218bc1f", path: "Pickler Studio v4.dc.html" }
```

Sections, in the file's own order: `TOP BAR`, `RAIL`, `MAIN`, `BLOCKED STATE BANNER`, `OVERVIEW`,
`NEXT RUN / SCHEDULE`, `CONSOLE`, `PICKS`, `ACTIVITY`, `SKILLS`, `STUB`.

The rail collapses — there is a toggle in the top bar with a title that changes — so the collapsed
and expanded states are both real and both need building.

- [ ] **Step 2: Build it**

Radii on this screen are 2, 3, 12, 14, 24 and pill: the 2 and 3 are the small status marks, which
map to `--pk-radius-mark`. Muted ink carries most of this screen — `#9AA0B8` appears seventy-five
times — so `--pk-ink-muted` doing the wrong thing here is very visible.

- [ ] **Step 3: Verify and commit**

```bash
node scripts/design/contrast.mjs && node scripts/design/type.mjs && node scripts/design/tokens.mjs
```

```bash
git add apps/web/src/features/console apps/web/src/app/console
git commit -m "Build the room the agents run in"
```

---

## Task 12: The empty studio

**Files:**

- Modify: `apps/web/src/features/console/**`

- [ ] **Step 1: Read the canvas**

```
DesignSync { method: "get_file", projectId: "c03aadb4-7bb2-429e-aa49-98ae4218bc1f", path: "Pickler Studio Empty.dc.html" }
```

This is **not** Studio v4 with the agents removed. It shares `TOP BAR`, `RAIL` and `MAIN`, and its
main column is a stepped flow: a `PIECE` section, a `DRAFT OVERVIEW · GO PUBLIC` panel and a
`PASSKEY SHEET`, under the screen labels `Studio · Empty · <step>` and `Studio · Draft overview`.
It is the journey from no agents to a first one.

- [ ] **Step 2: Make the state reachable**

The empty studio is a state of `/console`, not a route of its own: it is what a person with no
agents sees. The verification scripts cannot sign in and empty a database, so add a `?state=empty`
search param that forces it, guarded so it only works outside production:

```tsx
const forced = process.env.NODE_ENV !== "production" && searchParams.state === "empty";
```

Without this the screen is unverifiable, and a screen no check can reach is a screen that rots.

- [ ] **Step 3: Build the screen, and stop at the ceremony**

The passkey sheet's presentation is in scope and its confirm action is not. Authorising an agent's
sub-wallet is specification two of the Turnkey custody work, which does not exist: there is no
endpoint to call and no policy to sign against.

So the sheet renders, and its confirm is disabled with a line saying agent wallets are not
authorised yet. Do not wire it to the master-wallet ceremony that does exist — that would take a
person through a real biometric prompt to create something the product cannot yet honour.

- [ ] **Step 4: Verify and commit**

```bash
node scripts/design/contrast.mjs && node scripts/design/surfaces.mjs
```

```bash
git add apps/web/src/features/console
git commit -m "Show the way to a first agent, and stop where custody does"
```

---

## Task 13: The account

**Files:**

- Create: `apps/web/src/app/account/page.tsx`, `apps/web/src/features/account/**`

- [ ] **Step 1: Read the canvas**

```
DesignSync { method: "get_file", projectId: "c03aadb4-7bb2-429e-aa49-98ae4218bc1f", path: "Pickler Account.dc.html" }
```

Three sections behind a rail — Wallet, Security, Public profile — on the dark surface.

**Wallet** opens with a **white** card carrying two balance tiles and Send/Receive, then a
self-custody row, then one row per agent wallet with a spend meter, then an activity list.

**Security** leads with a risk panel whose copy changes with the number of passkeys —
`ONE KEY AWAY.` at one, `COVERED.` at two or more — then the passkey list, an add action, an email
recovery toggle, and the signed-in sessions.

**Profile** carries the handle at display size, a bio field, three stat tiles and the agent cards.

- [ ] **Step 2: Wire what exists**

Security is the section where this design meets the custody work already built. The passkey list,
the add-a-passkey ceremony and the two-key risk copy all have real endpoints behind them:
`GET /v1/signing/passkeys`, and the add prepare/confirm pair. Use them.

Email recovery is a toggle for something that does not exist — the custody specification records it
as deliberately off. Render it off and disabled, saying so, rather than shipping a switch that
flips nothing.

- [ ] **Step 3: Verify and commit**

The white wallet card inside the dark page is this screen's nesting case, and it is the reverse of
the portfolio's.

```bash
node scripts/design/surfaces.mjs && node scripts/design/contrast.mjs && node scripts/design/tokens.mjs
```

```bash
git add apps/web/src/app/account apps/web/src/features/account
git commit -m "Give a person somewhere to see their own keys"
```

---

## Task 14: The pages with no new canvas

**Files:**

- Modify: the remaining feature CSS modules

- [ ] **Step 1: Find what still reads a retired token**

```bash
grep -rn 'pk-font-mono\|pk-radius-\(sm\|md\|xl\)\b\|data-surface="\(public\|console\)"' apps/web/src packages/ui/src
```

Expected after Tasks 1–4: no output. Any hit is a page that will render with a fallback and look
almost right.

- [ ] **Step 2: Check the inherited pages**

Tokens, agents, markets, leaderboard, reads, apply and activity keep their composition and inherit
the light surface. Visit each with the dev server and look: the point of tokens carrying meaning is
that this should work, and the point of looking is that "should" is not "does".

Add any route that reveals a problem to `scripts/design/routes.mjs` so the checks cover it.

- [ ] **Step 3: No literals in source**

```bash
grep -rn '#[0-9a-fA-F]\{6\}' apps/web/src/features packages/ui/src --include='*.css' --include='*.tsx' | grep -v styles.css
```

Expected: no output. This is the weakest check here — it catches the careless case, while the DOM
checks catch the plausible one — but a literal is a token that stopped meaning anything.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src packages/ui/src
git commit -m "Let the pages nobody redesigned still look like the product"
```

---

## Task 15: The whole thing, at once

**Files:** none changed unless a check fails.

- [ ] **Step 1: Every gate**

```bash
npm run typecheck && npm run lint && npx prettier --check . && npm test && npx turbo build --filter=@pickler/web
```

- [ ] **Step 2: Every design check**

With `npm run dev` running:

```bash
for check in surfaces tokens contrast type; do
  echo "=== $check ==="
  node scripts/design/$check.mjs || echo "FAILED"
done
node scripts/design/shots.mjs
```

Expected: four checks exit 0, and ten screenshots written.

- [ ] **Step 3: Look at them**

Open each screenshot beside its canvas. The automated checks cannot see spacing, rhythm, or whether
a screen reads the way the design reads. Record what you find, including what you decided to leave.

- [ ] **Step 4: Record the result**

Add a `## Validation` section to `docs/specs/design-system-v2.md`: the date, what was checked, every
contrast figure that came close to its threshold, and anything that behaved differently from this
plan. Commit.

```bash
git add docs/specs/design-system-v2.md
git commit -m "Record what the first render actually looked like"
```

---

## What this plan does not do

The remaining canvases — mobile flows, market and agent detail, the other landing variants — and the
agent-token curve UI. Specification two of the custody work, which is what the empty studio's passkey
sheet is waiting for.
