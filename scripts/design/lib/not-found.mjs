/* What a 404 from the dev server means.
 *
 * `next dev` compiles a route on demand, and a request that lands during a recompile — another
 * agent's edit in this shared worktree — can answer 404 once for a route that exists. So a 404 is
 * asked again before it is believed. A second one is believed, and then which layer to send the
 * reader to depends on whether the route has a page file: none, and the screen is not built yet;
 * one, and a built route answering 404 is the server's fault, not a missing screen. */
import { readdirSync } from "node:fs";
import path from "node:path";

export const APP_DIR = "apps/web/src/app";
const RETRIES = 1;

/** The verdict on the `attempts`-th 404 in a row from a route whose page file `built` says exists. */
export function afterNotFound({ attempts, built }) {
  if (attempts <= RETRIES) {
    return { retry: true };
  }
  return built ? { kind: "not-found-built" } : { kind: "not-built" };
}

/* Next's routing, as far as it matters here: a route group `(name)` adds no segment, `[name]`
 * matches exactly one, `[...name]` matches one or more. */
const segmentsOf = (page) =>
  page
    .slice(APP_DIR.length + 1, -"/page.tsx".length)
    .split("/")
    .filter((segment) => segment && !/^\(.*\)$/.test(segment));

function matches(patterns, segments) {
  if (!patterns.length) {
    return !segments.length;
  }
  const [head, ...rest] = patterns;
  if (/^\[\.\.\..+\]$/.test(head)) {
    return segments.length > 0;
  }
  if (!segments.length) {
    return false;
  }
  if (/^\[.+\]$/.test(head) || head === segments[0]) {
    return matches(rest, segments.slice(1));
  }
  return false;
}

/** The page file, among `pages` (paths from the repository root), that serves `pathname`; null if
 *  none. The query string is ignored. */
export function pageFor(pathname, pages) {
  const segments = pathname.split("?")[0].split("/").filter(Boolean);
  return pages.find((page) => matches(segmentsOf(page), segments)) ?? null;
}

/** Every page file under the app directory, as paths from the repository root. */
export function appPages(root) {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(relative);
      } else if (entry.name === "page.tsx") {
        found.push(relative);
      }
    }
  };
  walk(APP_DIR);
  return found;
}
