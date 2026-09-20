import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { childEnvironment, readEnvironment, root, selectEnvironment } from "./environment.ts";

const [target, command, ...args] = process.argv.slice(2);
const environment = process.env.PICKLER_ENVIRONMENT ?? "local";
if (!target || !command) {
  throw new Error("Usage: with-env.ts <target> <command> [...arguments]");
}
for (const path of ["apps/web", "apps/agent-service", "workers/api", "workers/research"]) {
  for (const name of readdirSync(`${root}${path}`)) {
    if (
      (name.startsWith(".env") || name.startsWith(".dev.vars")) &&
      !name.endsWith(".example") &&
      existsSync(`${root}${path}/${name}`)
    ) {
      throw new Error(`Move ${path}/${name} into the root .env before running this command`);
    }
  }
}
const selected = selectEnvironment(
  readEnvironment(),
  target === "web" && process.env.PICKLER_WEB_RUNTIME === "worker" ? "web-worker" : target,
  environment,
);
// An explicit operator migration URL takes precedence, including isolated test migrations.
if (target === "database" && process.env.DATABASE_MIGRATION_URL) {
  selected.DATABASE_MIGRATION_URL = process.env.DATABASE_MIGRATION_URL;
}
const env = childEnvironment(selected);
env.PICKLER_ENVIRONMENT = environment;
if (target === "web-worker" || process.env.PICKLER_WEB_RUNTIME === "worker") {
  env.PICKLER_WEB_RUNTIME = "worker";
}
// Wrangler treats these already-filtered variables as local secrets; no per-Worker files.
env.CLOUDFLARE_INCLUDE_PROCESS_ENV = "true";
const child = spawn(command, args, { stdio: "inherit", env });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", () => {
  console.error("Unable to start the requested command");
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
