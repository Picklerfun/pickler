// One command for the design checks: the static one, then the rendered ones against servers this
// starts and stops itself.
//
//   npm run design:check                       every check
//   node scripts/design/run.mjs tokens type    only those
//   node scripts/design/run.mjs shots          screenshots (DESIGN_SHOTS_DIR names the folder)
//   DESIGN_BASE_URL=http://localhost:3001 …    measure a server that is already up; start nothing
//
// --strict is handed to the static check, which otherwise only reports.
// Exit 0 clean, 1 a check found something, 2 refused to measure.
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PORT, WEB_PORT, listening, plan, start, stopOnSignal } from "./lib/servers.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const RENDERED = ["surfaces", "tokens", "contrast", "type", "shots"];
const DEFAULT = ["source", "surfaces", "tokens", "contrast", "type"];

const flags = process.argv.slice(2).filter((arg) => arg.startsWith("--"));
const named = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const checks = named.length ? named : DEFAULT;
const unknown = checks.filter((check) => check !== "source" && !RENDERED.includes(check));
if (unknown.length) {
  process.stderr.write(`no such check: ${unknown.join(", ")}\n`);
  process.exit(2);
}

const run = (script, args, env) =>
  spawnSync(process.execPath, [path.join("scripts/design", script), ...args], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  }).status ?? 2;

let worst = 0;
if (checks.includes("source")) {
  worst = Math.max(worst, run("source.mjs", flags.includes("--strict") ? ["--strict"] : []));
}

const rendered = checks.filter((check) => RENDERED.includes(check));
if (rendered.length) {
  const decided = plan({
    baseUrl: process.env.DESIGN_BASE_URL,
    fixtureBusy: await listening(FIXTURE_PORT),
    webBusy: await listening(WEB_PORT),
  });
  if (decided.refuse) {
    process.stderr.write(`${decided.refuse}\n`);
    process.exit(2);
  }
  let servers = null;
  if (decided.start) {
    // The servers' own output goes to a file: it is the first place to look when a route answers
    // 500, and on screen it would bury the report.
    const log = path.join(ROOT, "scripts/design/.shots/servers.log");
    mkdirSync(path.dirname(log), { recursive: true });
    writeFileSync(log, "");
    process.stdout.write(`starting the fixture API and the web app (log: ${log})\n`);
    try {
      servers = await start(ROOT, (text) => appendFileSync(log, text));
    } catch (error) {
      process.stderr.write(`${error.message}; read ${log}\n`);
      process.exit(2);
    }
    // Ctrl-C or a kill during a check must not leave them on the ports. A check runs in a child
    // that blocks this process, so the handler fires when that child ends: on Ctrl-C at once,
    // since the terminal interrupts it too; on a kill of the runner alone, when the check finishes.
    stopOnSignal(servers.stop);
  }
  try {
    for (const check of rendered) {
      const env = { ...process.env, DESIGN_BASE_URL: decided.baseUrl };
      worst = Math.max(worst, run(`${check}.mjs`, [], env));
    }
  } finally {
    servers?.stop();
  }
}
process.exit(worst);
