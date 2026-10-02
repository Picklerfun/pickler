// What the mobile app resolves, from the root lockfile: every package reachable from apps/mobile,
// walked the way Node resolves, as one line per dependency: `who@version -> what@version`.
//
// Edges rather than a list of packages, because the lockfile holds several versions of the same
// library (three of @noble/curves) and a dependency re-pointed from one to another that is already
// there changes what a wallet library computes with while the list of packages stays the same.
//
//   node scripts/mobile/app-tree.mjs --check   fail when it differs from apps/mobile/dependency-tree.txt
//   node scripts/mobile/app-tree.mjs --write   record the tree as it is now
//
// The app shares a lockfile with the web. A dependency the web adds can be hoisted to the root and
// quietly replace the copy the app was built and tested with — its wallet and signing libraries
// included. This check makes that a failing build instead of a silent change: a difference is
// either put back in the lockfile or accepted on purpose with --write and said in the pull request.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const APP = "apps/mobile";
const SNAPSHOT = join(ROOT, APP, "dependency-tree.txt");

/** Every dependency edge reachable from the app in this lockfile, sorted. */
export function appTree(lock, app = APP) {
  const packages = lock.packages;
  const resolve = (from, name) => {
    let base = from;
    for (;;) {
      const key = `${base ? `${base}/` : ""}node_modules/${name}`;
      const found = packages[key];
      if (found) {
        return found.link ? found.resolved : key;
      }
      if (!base) {
        return null;
      }
      const nested = base.lastIndexOf("/node_modules/");
      base = nested >= 0 ? base.slice(0, nested) : "";
    }
  };

  // A lockfile entry says its name only when the folder does not: a workspace, an alias.
  const named = (key) => {
    const name = packages[key].name ?? key.slice(key.lastIndexOf("node_modules/") + 13);
    return `${name}@${packages[key].version ?? "0.0.0"}`;
  };
  const seen = new Set();
  const reached = new Set();
  const queue = [app];
  while (queue.length > 0) {
    const key = queue.pop();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const entry = packages[key];
    const wanted = {
      ...entry.dependencies,
      ...entry.optionalDependencies,
      ...entry.peerDependencies,
      ...(key === app ? entry.devDependencies : {}),
    };
    for (const name of Object.keys(wanted)) {
      const target = resolve(key, name);
      if (!target) {
        continue;
      }
      reached.add(`${named(key)} -> ${packages[target].name ?? name}@${packages[target].version}`);
      queue.push(target);
    }
  }
  return [...reached].sort();
}

/** How many distinct packages those edges reach. */
export const packageCount = (edges) => new Set(edges.map((edge) => edge.split(" -> ")[1])).size;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  const now = appTree(lock);
  if (process.argv.includes("--write")) {
    writeFileSync(SNAPSHOT, `${now.join("\n")}\n`);
    console.log(
      `recorded ${packageCount(now)} packages, ${now.length} dependencies, in ${APP}/dependency-tree.txt`,
    );
  } else {
    const recorded = new Set(readFileSync(SNAPSHOT, "utf8").split("\n").filter(Boolean));
    const current = new Set(now);
    const gone = [...recorded].filter((line) => !current.has(line));
    const added = now.filter((line) => !recorded.has(line));
    if (gone.length + added.length > 0) {
      console.error("The mobile app no longer resolves what it was built with.");
      for (const line of gone) {
        console.error(`  - ${line}`);
      }
      for (const line of added) {
        console.error(`  + ${line}`);
      }
      console.error(
        "Put the app's own copy back in package-lock.json, or accept the change with\n" +
          "node scripts/mobile/app-tree.mjs --write and say so in the pull request.",
      );
      process.exit(1);
    }
    console.log(`${packageCount(now)} packages, ${now.length} dependencies, as recorded.`);
  }
}
