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

/* Why a route can fail to render, in the words someone debugging it needs. Most routes here answer
 * 500 because the API client has no backend to talk to, and /account does not exist yet. None of
 * that is a design defect, and a check that reported it as one would send someone hunting tokens
 * for a missing server. So a route that cannot render is never silently green, never counted as a
 * page with no problems, and always says which kind of failure it is. */
const KINDS = {
  "server-down": (route, detail) =>
    `${route.path} — no dev server answered at ${BASE} (${detail}). Start one: npm run dev.`,
  "not-built": (route) =>
    `${route.path} — 404. The route does not exist yet; this change has not built it.`,
  "server-error": (route, detail) =>
    `${route.path} — HTTP ${detail}. The page threw while rendering, usually the API client with no backend behind it. That is a server problem, not a design one.`,
  "error-boundary": (route) =>
    `${route.path} — rendered the error/not-found fallback rather than the page. Nothing here can be measured. Again: a data problem, not a design one.`,
};

export function describe(blocked) {
  return blocked.map(({ route, kind, detail }) => KINDS[kind](route, detail));
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

/** Prints what could not be measured and what measured badly, then exits. Both count as failure:
 *  a check that cannot see a route has not passed it. */
export function finish(check, { routes, blocked, problems }) {
  for (const line of describe(blocked)) {
    process.stdout.write(`BLOCKED  ${line}\n`);
  }
  for (const line of problems) {
    process.stdout.write(`FAIL     ${line}\n`);
  }
  const measured = routes.length - blocked.length;
  if (blocked.length || problems.length) {
    process.stdout.write(
      `\n${check}: ${problems.length} failure(s) over ${measured} of ${routes.length} route(s); ` +
        `${blocked.length} could not be measured.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`${check}: clean over all ${routes.length} route(s).\n`);
}

export { BASE };
