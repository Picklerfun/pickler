import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { childEnvironment, readEnvironment, root, selectEnvironment } from "./environment.ts";

interface LocalWorkerConfiguration {
  $schema?: string;
  name: string;
  main: string;
  services?: Array<{ service: string }>;
  queues?: { producers?: Array<{ queue: string }>; consumers?: Array<{ queue: string }> };
  assets?: { directory: string };
}

// Wrangler's multi-Worker host needs per-target secrets. These private generated files are
// ephemeral transport artifacts, never additional operator-maintained configuration.
const fixture = process.argv.includes("--fixture");
if (process.env.PICKLER_ENVIRONMENT && process.env.PICKLER_ENVIRONMENT !== "local") {
  throw new Error("Local Workers must use local settings");
}
const temporary = mkdtempSync(join(tmpdir(), "pickler-worker-env-"));
const source = readEnvironment();
const files: Array<readonly [string, string]> = [
  ["web-worker", "apps/web/wrangler.jsonc"],
  ["api", "workers/api/wrangler.staging.jsonc"],
  [
    fixture ? "fixture" : "research",
    fixture ? "workers/research/test/wrangler.jsonc" : "workers/research/wrangler.jsonc",
  ],
];
const configs: string[] = [];
const suffix = temporary.slice(temporary.lastIndexOf("-") + 1).toLowerCase();
const names: Record<string, string> = {
  "pickler-web-staging": `pickler-web-local-${suffix}`,
  "pickler-api-staging": `pickler-api-local-${suffix}`,
  "pickler-research-staging": `pickler-research-local-${suffix}`,
};
try {
  for (const [target, relative] of files) {
    const path = resolve(root, relative);
    const parsed = ts.parseConfigFileTextToJson(path, readFileSync(path, "utf8"));
    if (parsed.error) {
      throw new Error(`Invalid Worker config: ${relative}`);
    }
    const config = parsed.config as LocalWorkerConfiguration;
    delete config.$schema;
    const localName = names[config.name];
    if (!localName) {
      throw new Error(`Unknown Worker name in ${relative}`);
    }
    config.name = localName;
    for (const binding of config.services ?? []) {
      binding.service = names[binding.service] ?? binding.service;
    }
    for (const binding of [
      ...(config.queues?.producers ?? []),
      ...(config.queues?.consumers ?? []),
    ]) {
      binding.queue = `pickler-research-local-${suffix}`;
    }
    config.main = resolve(dirname(path), config.main);
    if (config.assets) {
      config.assets.directory = resolve(dirname(path), config.assets.directory);
    }
    const directory = join(temporary, target);
    mkdirSync(directory, { mode: 0o700 });
    const vars = selectEnvironment(source, target);
    const content = Object.entries(vars)
      .map(([key, value]) => {
        const quote = value.includes("'") ? '"' : "'";
        if (value.includes(quote)) {
          throw new Error(`Cannot safely serialize ${key} for Wrangler`);
        }
        return `${key}=${quote}${value}${quote}`;
      })
      .join("\n");
    writeFileSync(join(directory, ".dev.vars"), content, { mode: 0o600 });
    const configPath = join(directory, "wrangler.json");
    writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
    configs.push("--config", configPath);
  }
  const child = spawn(
    process.execPath,
    [
      resolve(root, "node_modules/wrangler/bin/wrangler.js"),
      "dev",
      ...configs,
      "--ip",
      "127.0.0.1",
      "--port",
      "8790",
      "--persist-to",
      resolve(root, ".wrangler/local-workers"),
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: childEnvironment({}),
    },
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", () => {
    rmSync(temporary, { recursive: true, force: true });
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    rmSync(temporary, { recursive: true, force: true });
    process.exitCode = code ?? 1;
  });
} catch (error) {
  rmSync(temporary, { recursive: true, force: true });
  throw error;
}
