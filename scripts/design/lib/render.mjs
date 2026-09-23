import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BASE = process.env.DESIGN_BASE_URL ?? "http://localhost:3000";

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
    line: (route, detail) => `${route.path} — nothing answered at ${BASE} (${detail})`,
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

/** Opens each route in turn and hands the page to `visit`. A route that cannot load is recorded as
 *  blocked rather than thrown on, so that one missing backend does not hide the other four routes'
 *  findings — but `finish` still exits non-zero for it. */
export async function eachRoute(routes, visit, { width = 1400, height = 1000 } = {}) {
  const { chromium } = await playwright();
  const browser = await launch(chromium);
  const results = [];
  const blocked = [];
  try {
    for (const route of routes) {
      const page = await browser.newPage({ viewport: { width, height } });
      try {
        let response;
        try {
          response = await page.goto(BASE + route.path, { waitUntil: "networkidle" });
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
        results.push({ route, value: await visit(page, route) });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return { results, blocked };
}

/** Prints what could not be visited and what measured badly, then exits.
 *
 *  Both count as failure — a check that cannot see a route has not passed it — but they are
 *  different failures and the summary says which, because "it went red" sends someone looking for a
 *  design defect that may not exist. */
export function finish(check, { routes, blocked, problems }) {
  for (const { blocked: isRoute, text } of describe(blocked)) {
    process.stdout.write(isRoute ? `BLOCKED  ${text}\n` : `  → ${text}\n`);
  }
  for (const line of problems) {
    process.stdout.write(`FAIL     ${line}\n`);
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
