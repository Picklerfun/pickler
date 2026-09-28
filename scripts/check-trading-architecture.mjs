import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter((file) => existsSync(file));
const failures = [];
const retired = /paper:(?:study|quant|compare|benchmark)|perps:study/;
for (const file of tracked) {
  if (file.endsWith(".md")) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("<!-- historical-evidence -->") && retired.test(text)) {
      failures.push(`${file}: retired evaluation command`);
    }
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].replace(/^<|>$/g, "").split("#")[0].split(/\s+"/)[0];
      if (
        !target ||
        /^(?:[a-z]+:|\/)/i.test(target) ||
        target.includes("{") ||
        target.includes("*")
      ) {
        continue;
      }
      if (!existsSync(resolve(dirname(file), decodeURIComponent(target)))) {
        failures.push(`${file}: missing link ${target}`);
      }
    }
  }
  if (!file.endsWith(".ts") && !file.endsWith(".tsx")) {
    continue;
  }
  const text = readFileSync(file, "utf8");
  if (file.startsWith("packages/core/src/") && text.includes("@pickler/trading")) {
    failures.push(`${file}: core depends on trading`);
  }
  if (
    file.startsWith("packages/trading/src/") &&
    /from\s+["'](?:node:|@pickler\/(?:infrastructure|agent-runtime|api-schema)|@mastra\/|@ai-sdk\/)/.test(
      text,
    )
  ) {
    failures.push(`${file}: non-business dependency`);
  }
  if (
    /from\s+["'][^"']*core\/src\/features\/(?:paper|trading|perps-paper|perps-study|paper-study|evaluation)\//.test(
      text,
    )
  ) {
    failures.push(`${file}: retired source import`);
  }
}
for (const folder of [
  "paper",
  "trading",
  "perps-paper",
  "perps-study",
  "paper-study",
  "evaluation",
]) {
  if (existsSync(`packages/core/src/features/${folder}`)) {
    failures.push(`core still contains trading implementation: ${folder}`);
  }
}
const app = JSON.parse(readFileSync("apps/agent-service/package.json", "utf8"));
for (const command of Object.keys(app.scripts)) {
  if (retired.test(command)) {
    failures.push(`retired script ${command}`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Trading boundaries, retired commands and local documentation links verified.");
}
// Workspace dependency cycles are architectural regressions even when type-only imports compile.
const manifests = tracked
  .filter((file) => /^(?:packages|apps|workers)\/[^/]+\/package.json$/.test(file))
  .map((file) => JSON.parse(readFileSync(file, "utf8")));
const graph = new Map(
  manifests.map((m) => [
    m.name,
    Object.keys({ ...m.dependencies, ...m.devDependencies }).filter((n) =>
      n.startsWith("@pickler/"),
    ),
  ]),
);
function visit(name, path = []) {
  if (path.includes(name)) {
    throw new Error(`Workspace cycle: ${[...path, name].join(" -> ")}`);
  }
  for (const dependency of graph.get(name) ?? []) {
    visit(dependency, [...path, name]);
  }
}
for (const name of graph.keys()) {
  visit(name);
}
