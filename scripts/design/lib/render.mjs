import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HOLDS } from "../routes.mjs";
import { SIGNATURE, resolve, surface } from "./tokens-file.mjs";

/* No default, deliberately. This machine runs more than one checkout of this repository at once,
 * and they serve the same application under the same <title> on different ports — so a wrong guess
 * does not fail, it measures a different branch's design system and reports plausible numbers for
 * work that is not here. A default cannot tell the two apart, and neither can a reader looking at
 * the output. Naming the port is the only thing that makes a measurement attributable. */
const BASE = process.env.DESIGN_BASE_URL;
if (!BASE) {
  process.stderr.write(
    "DESIGN_BASE_URL is not set, and there is no safe default: another checkout of this same\n" +
      "repository may be serving its own branch on the port a default would pick, which would be\n" +
      "measured and reported as if it were this tree.\n\n" +
      "  DESIGN_BASE_URL=http://localhost:3001 node scripts/design/<check>.mjs\n",
  );
  process.exit(2);
}

/* Two products, and in a deployment two origins. One base URL still works and is what development
 * uses, because the middleware is inert on localhost and both products answer on 3001 — so this is
 * a no-op here and only has an effect once the two are split.
 *
 * DESIGN_BASE_URL stays required and still refuses to guess, for both of them. The reason is
 * unchanged and gets worse rather than better with two hosts: another checkout of this repository
 * serves the same application under the same title on a neighbouring port, so a default measures
 * somebody else's branch and prints plausible numbers. Two defaults would be two chances at that. */
const BASE_FOR = {
  marketplace: process.env.DESIGN_MARKETPLACE_URL ?? BASE,
  studio: process.env.DESIGN_STUDIO_URL ?? BASE,
};
const baseFor = (route) => BASE_FOR[route.product] ?? BASE;

/* Playwright is installed globally and deliberately not a repository dependency, so `playwright`
 * does not resolve from here. Node ignores NODE_PATH for ESM, so the global install has to be
 * found and imported by absolute path. The in-repo import is tried first so that adding Playwright
 * to package.json some day just works. */
async function playwright() {
  try {
    return await import("playwright");
  } catch {
    const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    const entry = path.join(root, "playwright", "index.mjs");
    if (!existsSync(entry)) {
      throw new Error(
        `Playwright is not installed here or globally. Run: npm install -g playwright`,
      );
    }
    return await import(pathToFileURL(entry).href);
  }
}

/* The build Playwright 1.63 wants (chromium-1243) is not in this machine's cache; chromium-1223 is,
 * and it drives fine over CDP for everything these checks do — computed styles, screenshots. So:
 * launch the bundled build when it is there, and otherwise fall back to the newest cached one and
 * say so, rather than failing with an "Executable doesn't exist" that looks like a broken script.
 * Set DESIGN_CHROMIUM to an executable path to override, or run `npx playwright install chromium`
 * to fetch the matching build and make this fallback stop firing. */
const CACHE =
  process.env.PLAYWRIGHT_BROWSERS_PATH ||
  (process.platform === "darwin"
    ? path.join(homedir(), "Library", "Caches", "ms-playwright")
    : path.join(homedir(), ".cache", "ms-playwright"));

// Where the binary sits inside a chromium-<rev> directory, per platform.
const BINARIES = [
  "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chrome-linux/chrome",
  "chrome-win/chrome.exe",
];

function cachedChromium() {
  if (process.env.DESIGN_CHROMIUM) {
    return { executablePath: process.env.DESIGN_CHROMIUM, revision: "DESIGN_CHROMIUM" };
  }
  let revisions = [];
  try {
    revisions = readdirSync(CACHE)
      .filter((name) => /^chromium-\d+$/.test(name))
      .map((name) => ({ name, revision: Number(name.slice("chromium-".length)) }))
      .sort((a, b) => b.revision - a.revision);
  } catch {
    return null;
  }
  for (const { name, revision } of revisions) {
    for (const relative of BINARIES) {
      const executablePath = path.join(CACHE, name, relative);
      if (existsSync(executablePath)) {
        return { executablePath, revision: String(revision) };
      }
    }
  }
  return null;
}

async function launch(chromium) {
  try {
    return await chromium.launch();
  } catch (error) {
    const cached = cachedChromium();
    if (!cached) {
      throw error;
    }
    process.stderr.write(
      `note: Playwright's bundled Chromium is not installed; using cached ${cached.revision}.\n`,
    );
    return await chromium.launch({ executablePath: cached.executablePath });
  }
}

/* Why a route can fail to render, in the words someone debugging it needs.
 *
 * Three processes can fail here and they fail independently: this script, the dev server, and the
 * API fixture behind it. Only one of them fails visibly. A dead dev server refuses the connection,
 * but a dead fixture leaves a perfectly healthy app answering 500 with a stack trace pointing at
 * api-client.ts — and someone reading that will debug the design system for an hour. So each kind
 * is named by what was observed, and names the layer to go and look at first.
 *
 * The general rule, which this got wrong twice: a check that cannot tell which layer failed will
 * send someone to the wrong one, and the cost is paid by whoever reads the output. */
const START_APP = "cd apps/web && PICKLER_API_LOCAL_URL=http://127.0.0.1:8799 npx next dev -p 3001";
const START_FIXTURE = "node --import tsx scripts/design/fixture-api.mjs 8799";

/* One short line per blocked route, and the remedy once per kind however many routes hit it. A dead
 * dev server blocks all five, and printing the same three-line fix five times is the same cost in a
 * different currency. */
const KINDS = {
  "server-down": {
    line: (route, detail) => `${route.path} — nothing answered at ${baseFor(route)} (${detail})`,
    remedy:
      `The dev server is down, so nothing was measured and no design conclusion follows. Start it:\n` +
      `    ${START_APP}\n` +
      `  Not \`npm run dev\`: turbo runs in strict env mode and the dev task declares no env, so it\n` +
      `  drops PICKLER_API_LOCAL_URL and every data route then answers 500.`,
  },
  "not-built": {
    line: (route) => `${route.path} — 404, not built yet; ${route.task} builds it`,
    remedy:
      "Nothing is broken. Those screens are not your turn, and this check will cover them the day they exist.",
  },
  "server-error": {
    line: (route, detail) =>
      `${route.path} — HTTP ${detail}, the app is up and something behind it is not`,
    remedy:
      `Not a design failure. Usually the API fixture: check it is alive on the port that\n` +
      `  PICKLER_API_LOCAL_URL names, and start it with\n` +
      `    ${START_FIXTURE}\n` +
      `  If the fixture is alive, read the dev server log — the throw will name the endpoint.`,
  },
  stub: {
    line: (route, detail) => `${route.path} — loaded, but ${detail}`,
    remedy:
      "The page answered 200 and rendered something other than the screen — a sign-in stub, a gate,\n" +
      "  a half-mounted client component. Measuring it would report green for a screen nobody looked\n" +
      "  at, which is what happened to /console for the whole of this change. Not measured, not passed.",
  },
  "click-missed": {
    line: (route, detail) => `${route.path} — loaded and proved, but ${detail}`,
    remedy:
      "The route reaches its screen through a click and the click landed somewhere else. Almost\n" +
      "  always the selector: a renamed aria-label, a control that moved, a square the sample data\n" +
      "  no longer makes takeable. Nothing here is a design failure — but nothing was measured\n" +
      "  either, because measuring the screen before the click would report green for the half this\n" +
      "  route exists to reach.",
  },
  "no-floor": {
    line: (route) => `${route.path} — declares no \`proves\` selector and no \`floor\``,
    remedy:
      "Add one to routes.mjs. A route with no floor cannot be told from a stub, and a route nobody\n" +
      "  wrote a floor for is exactly the route the floor exists to catch, so it is not measured.",
  },
  "no-product": {
    line: (route) => `${route.path} — declares no \`product\`, so no host owns it`,
    remedy:
      "Add one to routes.mjs: `marketplace` or `studio`. Falling back to DESIGN_BASE_URL would\n" +
      "  measure the route against whichever host happened to be named, and once the two products\n" +
      "  sit on different origins that is a number about the wrong server — which is the one\n" +
      "  failure this whole file is built to refuse.",
  },
  "error-boundary": {
    line: (route) =>
      `${route.path} — 200, but rendered the error/not-found fallback instead of the page`,
    remedy:
      "That is what a client-side throw looks like. Read the browser console, not the tokens.",
  },
};

/** One line per blocked route, then each kind's remedy once, in the order the kinds were hit. */
export function describe(blocked) {
  const out = [];
  const remedied = new Set();
  for (const { route, kind, detail } of blocked) {
    out.push({ blocked: true, text: KINDS[kind].line(route, detail) });
  }
  for (const { kind } of blocked) {
    if (!remedied.has(kind)) {
      remedied.add(kind);
      out.push({ blocked: false, text: KINDS[kind].remedy });
    }
  }
  return out;
}

// Counted in the page, for the `floor` form of the proof. Visible elements only, so the number
// means the same thing the checks' own counts mean and the two cannot appear to disagree.
const countText = () =>
  [...document.querySelectorAll("body *")].filter(
    (el) =>
      [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim()) &&
      el.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
  ).length;

/* Is the server at BASE serving *this* tree?
 *
 * Naming the port makes a number attributable, but it still trusts whoever typed it. Another
 * checkout of this repository serves the same application under the same title on a neighbouring
 * port, so a mistyped port returns a well-formed answer about somebody else's branch — and a
 * verification script's worst failure is not an error, it is a plausible number.
 *
 * The cheapest true fingerprint is the palette itself: read a few token values off this tree's
 * styles.css and off the page, and a server built from another branch disagrees on at least one.
 * It costs one probe on the first route that loads. */
async function serving(page) {
  const wanted = {};
  for (const name of ["light", "dark"]) {
    const tokens = surface(name);
    wanted[name] = Object.fromEntries(SIGNATURE.map((t) => [t, resolve(tokens, t)]));
  }
  const painted = await page.evaluate((names) => {
    // A token the page does not define at all is absence, not conflict: `var(--x)` with no value is
    // invalid at computed-value time, so `color` inherits and comes back as the sentinel. Only a
    // token the page defines *differently* says the server is another tree — which is exactly the
    // dangerous case, since a build of another branch defines all of them.
    const SENTINEL = "rgb(1, 2, 3)";
    const read = (scope, name) => {
      const el = document.querySelector(scope);
      if (!el) {
        return null;
      }
      const host = document.createElement("div");
      host.style.color = SENTINEL;
      const probe = document.createElement("div");
      host.append(probe);
      el.append(host);
      probe.style.color = `var(${name})`;
      const value = getComputedStyle(probe).color;
      host.remove();
      return value === SENTINEL ? null : value;
    };
    return {
      light: Object.fromEntries(names.map((n) => [n, read("body", n)])),
      dark: Object.fromEntries(names.map((n) => [n, read('[data-surface="dark"]', n)])),
    };
  }, SIGNATURE);

  // Compare as the browser renders them, so #0b0d1a and rgb(11, 13, 26) are one value.
  const normalise = (value) => {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value).trim());
    if (!hex) {
      return String(value).trim();
    }
    const full = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return `rgb(${[0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).join(", ")})`;
  };

  const differs = [];
  for (const scope of ["light", "dark"]) {
    for (const name of SIGNATURE) {
      const here = normalise(wanted[scope][name]);
      const there = painted[scope][name];
      // null is either no such scope on this page or no such token: absence, not conflict.
      if (there && here !== there) {
        differs.push(`${name} on ${scope}: this tree says ${here}, that server paints ${there}`);
      }
    }
  }
  return differs;
}

/** Opens each route in turn and hands the page to `visit`. A route that cannot load is recorded as
 *  blocked rather than thrown on, so that one missing backend does not hide the other four routes'
 *  findings — but `finish` still exits non-zero for it. */
export async function eachRoute(routes, visit, { width = 1400, height = 1000 } = {}) {
  const { chromium } = await playwright();
  const browser = await launch(chromium);
  const results = [];
  const blocked = [];
  // Which base URLs have been fingerprinted. A set rather than a flag because the two products can
  // sit on two origins, and verifying one of them while measuring both is the same mistake in a
  // smaller form. In development both resolve to DESIGN_BASE_URL, so this still runs exactly once.
  const checked = new Set();
  try {
    for (const route of routes) {
      if (!route.product) {
        blocked.push({ route, kind: "no-product" });
        continue;
      }
      const page = await browser.newPage({ viewport: { width, height } });
      try {
        let response;
        try {
          response = await page.goto(baseFor(route) + route.path, { waitUntil: "networkidle" });
        } catch (error) {
          blocked.push({
            route,
            kind: "server-down",
            detail: String(error.message).split("\n")[0],
          });
          continue;
        }
        const status = response ? response.status() : 0;
        if (status === 404) {
          blocked.push({ route, kind: "not-built" });
          continue;
        }
        if (!response || !response.ok()) {
          blocked.push({ route, kind: "server-error", detail: status || "nothing" });
          continue;
        }
        // Both error.tsx and not-found.tsx render <main class="fallback">, and a client-side throw
        // caught by the boundary still answers 200. Without this, an error page measures clean.
        if (await page.locator("main.fallback").count()) {
          blocked.push({ route, kind: "error-boundary" });
          continue;
        }
        if (!checked.has(baseFor(route))) {
          checked.add(baseFor(route));
          const differs = await serving(page);
          if (differs.length) {
            // packages/ui/src being edited is the innocent explanation: the file on disk is ahead
            // of what the server last compiled. Anything else means the wrong server.
            const editing = held().has("ALWAYS");
            process.stderr.write(
              `${editing ? "warning" : "refusing to measure"}: the server at ${baseFor(route)} is not painting this tree's tokens.\n` +
                differs.map((line) => `  ${line}\n`).join("") +
                (editing
                  ? "  packages/ui/src has uncommitted changes, so the server may simply not have\n" +
                    "  recompiled yet. Re-run once it has; the numbers below are suspect until then.\n"
                  : "  Nobody is editing the tokens, so that is another checkout of this repository\n" +
                    "  serving its own branch. Measuring it would report somebody else's design.\n"),
            );
            if (!editing) {
              await browser.close();
              process.exit(2);
            }
          }
        }
        // Prove the screen rendered before measuring it. A selector first: it says what the real
        // screen contains and a stub cannot. A count only where no authored hook exists yet.
        let proof;
        if (route.proves) {
          const found = await page.locator(route.proves).count();
          if (!found) {
            blocked.push({ route, kind: "stub", detail: `nothing matches ${route.proves}` });
            continue;
          }
          proof = route.proves;
        } else if (typeof route.floor === "number") {
          const carried = await page.evaluate(countText);
          if (carried < route.floor) {
            blocked.push({
              route,
              kind: "stub",
              detail: `only ${carried} text element(s), and the floor is ${route.floor}`,
            });
            continue;
          }
          proof = `${carried} text elements ≥ floor ${route.floor}`;
        } else {
          blocked.push({ route, kind: "no-floor" });
          continue;
        }

        /* Some screens are a click deep, and a click is not a door.
         *
         * ?state=connected and ?section= exist because a wallet connection and a Supabase session
         * are states no click produces — there was no other way in, so a dev-guarded parameter was
         * worth its cost in shipped code. That reasoning does not extend to everything hidden: the
         * market's ticket only fills once a square is picked, and picking is what a browser does.
         * Playwright already has clicks, so reaching it needs nothing added to the product. Anyone
         * about to add a query parameter for a state a person reaches by clicking should use this
         * instead.
         *
         * `act.proves` is not decoration and the hook must never take a bare selector. A click that
         * quietly stops matching — a renamed label, a moved control — would leave the route
         * measuring the screen *before* the click and reporting green for it, which is the stub
         * failure this file exists to catch, one layer deeper and in the place hardest to notice.
         * So the click asserts its own result exactly as `proves` does, and a miss is reported as a
         * route that was never measured. */
        if (route.act) {
          await page.click(route.act.click);
          /* Let the click's transitions finish before anything reads a colour.
           *
           * This is not caution, it is a defect that was caught. `.cell` carries
           * `transition: background 140ms`, so the first run measured eleven lit squares mid-fade
           * and reported #EDF7CE — a solid token with no alpha — as "at 0.106 alpha, in no token".
           * A plausible, specific, entirely false finding, and one that would have sent somebody
           * looking for a literal nobody typed.
           *
           * Waiting on the animations rather than on a duration, because a duration is a guess that
           * ages: --pk-duration is a token and can change. Transitions only, and bounded, since a
           * looping decoration never finishes and waiting on one would hang the run rather than
           * measure it. */
          await page
            .waitForFunction(
              () =>
                document
                  .getAnimations()
                  .filter((a) => a.constructor.name === "CSSTransition")
                  .every((a) => a.playState === "finished"),
              null,
              { timeout: 2000 },
            )
            .catch(() => {});
          const landed = await page.locator(route.act.proves).count();
          if (!landed) {
            blocked.push({
              route,
              kind: "click-missed",
              detail: `clicked ${route.act.click}, then nothing matched ${route.act.proves}`,
            });
            continue;
          }
          proof = `${proof} → ${route.act.proves}`;
        }
        results.push({ route, proof, value: await visit(page, route) });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return { results, blocked };
}

/* Who is holding the source a screen is built from.
 *
 * These checks read a working tree several agents share through one dev server, so a red line can be
 * a snapshot of someone mid-edit rather than a defect — an invisible heading that was already fixed
 * before it was read. Nothing in the output tells the two apart, and no amount of care inside the
 * check prevents it: it is a property of the arrangement, not of anyone's code.
 *
 * The harness cannot know which it is looking at. It can know whether anyone is holding the file,
 * which is the honest half of the answer and the half a reader needs. So failures on a held screen
 * are annotated, never suppressed and never uncounted — a real failure in a held file is still a
 * real failure, and silencing it would be the mistake in lesson 9 exactly. */
function held() {
  let changed = [];
  try {
    const root = fileURLToPath(new URL("../../..", import.meta.url));
    changed = execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .map((line) => line.slice(3).trim().split(" -> ").pop())
      .filter(Boolean);
  } catch {
    return new Map(); // not a git checkout, or git is unavailable: say nothing rather than guess
  }
  const holders = new Map();
  for (const [task, directories] of Object.entries(HOLDS)) {
    const touched = directories.filter((directory) =>
      changed.some((file) => file.startsWith(directory)),
    );
    if (touched.length) {
      holders.set(task, touched);
    }
  }
  return holders;
}

/** Prints what could not be visited and what measured badly, then exits.
 *
 *  Both count as failure — a check that cannot see a route has not passed it — but they are
 *  different failures and the summary says which, because "it went red" sends someone looking for a
 *  design defect that may not exist. */
export function finish(check, { routes, blocked, problems, results = [], summary }) {
  /* What this run actually looked at, printed every time and not only when something is wrong.
   * Three of the things this harness has been wrong about were not wrong assertions — they were
   * right assertions about the wrong thing: a stub instead of a screen, an overridden rule instead
   * of a live one, someone's mid-edit instead of their work. None of them would have survived a
   * reader glancing at what was measured, so it stops being something a person has to think to ask
   * for. */
  for (const { route, proof, value } of results) {
    const what = summary ? summary(value) : "";
    process.stdout.write(`looked at  ${route.name} — ${proof}${what ? `, ${what}` : ""}\n`);
  }
  for (const { blocked: isRoute, text } of describe(blocked)) {
    process.stdout.write(isRoute ? `BLOCKED  ${text}\n` : `  → ${text}\n`);
  }
  // A problem may be a plain string or { route, text }; only the latter can be attributed.
  const holders = held();
  const marked = new Set();
  for (const problem of problems) {
    const route = problem?.route;
    const tasks = route ? [route.task, "ALWAYS"].filter((t) => holders.has(t)) : [];
    for (const task of tasks) {
      marked.add(task);
    }
    const text = problem?.text ?? problem;
    process.stdout.write(`FAIL     ${text}${tasks.length ? "  [held]" : ""}\n`);
  }
  for (const task of marked) {
    process.stdout.write(
      `  ⚠ ${holders.get(task).join(", ")} has uncommitted changes, so a [held] line above may be a\n` +
        `    snapshot of an edit in progress rather than a defect. It is still counted and this check\n` +
        `    still fails. Read it again once that work is committed.\n`,
    );
  }
  const measured = routes.length - blocked.length;
  if (!blocked.length && !problems.length) {
    process.stdout.write(`${check}: clean over all ${routes.length} route(s).\n`);
    return;
  }
  const said = [];
  if (problems.length) {
    said.push(`${problems.length} assertion(s) failed over the ${measured} route(s) it could see`);
  }
  if (blocked.length) {
    said.push(
      `${blocked.length} of ${routes.length} route(s) could not be visited at all, so this check has not passed them either way`,
    );
  }
  process.stdout.write(
    `\n${check}: ${said.join(", and ")}.\n` +
      (problems.length
        ? ""
        : `         Nothing it measured was wrong — every red line above is a route that was not there to measure.\n`),
  );
  process.exit(1);
}

export { BASE };
