/* The browser the rendered checks and the screenshot comparison drive. */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

/** A launched Chromium. The caller closes it. */
export async function openBrowser() {
  const { chromium } = await playwright();
  return launch(chromium);
}
