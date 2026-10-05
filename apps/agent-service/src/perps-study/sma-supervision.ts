import { spawn, execFileSync } from "node:child_process";
import { open, readFile, writeFile, rename } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { parse } from "dotenv";

const host = fileURLToPath(new URL("../../", import.meta.url));
const cli = join(host, "src/evaluate.ts");
const self = fileURLToPath(import.meta.url);
const terminal = new Set(["complete", "completed", "completed_with_errors", "interrupted"]);
export interface SupervisionManifest {
  version: 1;
  token: string;
  directory: string;
  config: string;
  envFile: string;
  createdAt: number;
  runnerLabel: string;
  watchdogLabel: string;
}
export async function writeSupervisionJson(path: string, data: unknown) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, path);
}
export function supervisionEnvironment(token: string) {
  return Object.fromEntries(
    Object.entries({
      PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      LANG: "en_US.UTF-8",
      PICKLER_SMA_SUPERVISION_TOKEN: token,
    }).filter((pair): pair is [string, string] => typeof pair[1] === "string"),
  );
}
async function optionalJson(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
export function matchingProcess(pid: number, requiredArgs: string[]) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    const args = execFileSync("/bin/ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: 2000,
    });
    return requiredArgs.every((part) => args.includes(part));
  } catch {
    return false;
  }
}
export async function supervisedChild(
  manifest: SupervisionManifest,
  command: string,
  args: string[],
  options: {
    log?: string;
    identityFile?: string;
    liveness?: () => boolean;
  } = {},
) {
  const log = await open(join(manifest.directory, options.log ?? "runner.log"), "a", 0o600);
  const child = spawn(command, args, {
    cwd: host,
    env: supervisionEnvironment(manifest.token),
    stdio: ["ignore", log.fd, log.fd],
  });
  const outcome = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => {
    child.once("error", () => done({ code: -1, signal: null }));
    child.once("exit", (code, signal) => done({ code, signal }));
  });
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  const monitor = options.liveness
    ? setInterval(() => {
        if (!options.liveness!() && child.exitCode === null && child.signalCode === null) {
          child.kill("SIGTERM");
          if (!forceKill) {
            forceKill = setTimeout(() => child.kill("SIGKILL"), 10000);
          }
        }
      }, 10000)
    : undefined;
  try {
    if (options.identityFile) {
      await writeSupervisionJson(join(manifest.directory, options.identityFile), {
        token: manifest.token,
        pid: child.pid ?? null,
        startedAt: Date.now(),
      });
    }
    return await outcome;
  } catch (error) {
    child.kill("SIGKILL");
    await outcome;
    throw error;
  } finally {
    if (monitor) {
      clearInterval(monitor);
    }
    if (forceKill) {
      clearTimeout(forceKill);
    }
    await log.close();
  }
}
function evaluateArgs(manifest: SupervisionManifest, command: string) {
  return [
    "--import",
    "tsx",
    cli,
    command,
    "--config",
    manifest.config,
    "--env-file",
    manifest.envFile,
  ];
}
async function refreshReport(manifest: SupervisionManifest) {
  return supervisedChild(manifest, process.execPath, evaluateArgs(manifest, "report"), {
    log: "supervision-report.log",
  });
}
export async function terminalNotice(
  manifest: SupervisionManifest,
  kind: string,
  details: unknown,
  notifier?: () => boolean,
) {
  const path = join(manifest.directory, "supervision-notice.json");
  try {
    await writeFile(path, JSON.stringify({ version: 1, at: Date.now(), kind, details }) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw error;
  }
  const message =
    kind === "controlled"
      ? "Controlled watchdog check passed. No study or order was executed."
      : kind === "completed"
        ? "SMA comparison finished. Open its report."
        : "SMA comparison interrupted. Decisions stopped; inspect its report.";
  let submitted = false;
  if (notifier) {
    submitted = notifier();
  } else if (process.platform === "darwin") {
    try {
      execFileSync(
        "/usr/bin/osascript",
        [
          "-e",
          `display notification ${JSON.stringify(message)} with title "Pickler paper trading"`,
        ],
        { timeout: 5000 },
      );
      submitted = true;
    } catch {
      // A failed notification is visible and never treated as confirmed delivery.
    }
  }
  await writeSupervisionJson(join(manifest.directory, "notification-result.json"), {
    at: Date.now(),
    submitted,
    delivery: "NOT_VERIFIABLE",
    report: join(manifest.directory, "report.html"),
  });
  console.log(JSON.stringify({ kind, at: Date.now(), details, notificationSubmitted: submitted }));
  return true;
}
export function supervisionFailure(input: {
  now: number;
  createdAt: number;
  identity: { startedAt: number } | null;
  childAlive: boolean;
  supervisorAlive: boolean;
  health: { at: number } | null;
  graceUntil: number | null;
}) {
  if (!input.identity) {
    return input.now - input.createdAt > 60000 ? "RUNNER_NOT_STARTED" : null;
  }
  if (!input.childAlive) {
    return "RUNNER_DIED";
  }
  if (!input.supervisorAlive) {
    return "SUPERVISOR_DIED";
  }
  if (input.graceUntil !== null && input.now > input.graceUntil + 30000) {
    return "FIXED_DEADLINE_EXCEEDED";
  }
  const last = input.health?.at ?? input.identity.startedAt;
  return input.now - last > 120000 ? "RUNNER_HEARTBEAT_STALE" : null;
}
async function supervisor(manifest: SupervisionManifest) {
  await writeSupervisionJson(join(manifest.directory, "supervisor-identity.json"), {
    token: manifest.token,
    pid: process.pid,
    startedAt: Date.now(),
  });
  // Watchdog registration precedes runner admission; neither job automatically restarts.
  const ready = await optionalJson(join(manifest.directory, "watchdog-ready.json"));
  if (
    ready?.token !== manifest.token ||
    !matchingProcess(ready.pid, [self, "watchdog", manifest.token])
  ) {
    throw new Error("Independent watchdog is unavailable");
  }
  const result = await supervisedChild(manifest, process.execPath, evaluateArgs(manifest, "run"), {
    identityFile: "supervised-runner.json",
    liveness: () => {
      if (!matchingProcess(ready.pid, [self, "watchdog", manifest.token])) {
        return false;
      }
      try {
        const health = JSON.parse(
          readFileSync(join(manifest.directory, "watchdog-health.json"), "utf8"),
        );
        return health.token === manifest.token && Date.now() - health.at <= 120000;
      } catch {
        return Date.now() - ready.at <= 120000;
      }
    },
  });
  await writeSupervisionJson(join(manifest.directory, "runner-exit.json"), {
    token: manifest.token,
    at: Date.now(),
    ...result,
  });
  if (result.code !== 0 || result.signal !== null) {
    await writeSupervisionJson(join(manifest.directory, "supervision-failure.json"), {
      at: Date.now(),
      code: "RUNNER_EXIT_FAILED",
      exitCode: result.code,
      signal: result.signal,
    });
  }
  await refreshReport(manifest);
  const report = await optionalJson(join(manifest.directory, "report.json"));
  const successful =
    result.code === 0 && report && terminal.has(report.status) && report.status !== "interrupted";
  if (!successful && !(await optionalJson(join(manifest.directory, "supervision-failure.json")))) {
    await writeSupervisionJson(join(manifest.directory, "supervision-failure.json"), {
      at: Date.now(),
      code: "RUNNER_EXIT_WITHOUT_COMPLETION",
    });
    await refreshReport(manifest);
  }
  await terminalNotice(manifest, successful ? "completed" : "interrupted", result);
}
export async function watchdog(
  manifest: SupervisionManifest,
  options: {
    report?: () => Promise<unknown>;
    notify?: () => boolean;
    intervalMs?: number;
  } = {},
) {
  const render = options.report ?? (() => refreshReport(manifest));
  await writeSupervisionJson(join(manifest.directory, "watchdog-ready.json"), {
    token: manifest.token,
    pid: process.pid,
    at: Date.now(),
  });
  for (;;) {
    const exit = await optionalJson(join(manifest.directory, "runner-exit.json"));
    const report = await optionalJson(join(manifest.directory, "report.json"));
    const identity = await optionalJson(join(manifest.directory, "supervised-runner.json"));
    const parent = await optionalJson(join(manifest.directory, "supervisor-identity.json"));
    const health = await optionalJson(join(manifest.directory, "runner-health.json"));
    const childAlive =
      identity?.token === manifest.token && matchingProcess(identity.pid, [cli, manifest.config]);
    const supervisorAlive =
      parent?.token === manifest.token &&
      matchingProcess(parent.pid, [self, "supervisor", manifest.token]);
    const problem = supervisionFailure({
      now: Date.now(),
      createdAt: manifest.createdAt,
      identity,
      childAlive: Boolean(childAlive),
      supervisorAlive: Boolean(supervisorAlive),
      health: health?.token === manifest.token ? health : null,
      graceUntil: report?.graceUntil ?? null,
    });
    await writeSupervisionJson(join(manifest.directory, "watchdog-health.json"), {
      token: manifest.token,
      at: Date.now(),
      childAlive,
      supervisorAlive,
      problem,
    });
    if (await optionalJson(join(manifest.directory, "supervision-notice.json"))) {
      return;
    }
    if (exit && !childAlive) {
      await render();
      const final = await optionalJson(join(manifest.directory, "report.json"));
      await terminalNotice(
        manifest,
        exit.code === 0 && final && terminal.has(final.status) && final.status !== "interrupted"
          ? "completed"
          : "interrupted",
        exit,
        options.notify,
      );
      return;
    }
    if (problem) {
      await writeSupervisionJson(join(manifest.directory, "supervision-failure.json"), {
        at: Date.now(),
        code: problem,
      });
      if (childAlive) {
        // Only the verified original child is signaled; there is no restart or lease reclaim.
        process.kill(identity.pid, "SIGTERM");
        await delay(10000);
        if (matchingProcess(identity.pid, [cli, manifest.config])) {
          process.kill(identity.pid, "SIGKILL");
        }
      }
      await render();
      await terminalNotice(manifest, "interrupted", { code: problem }, options.notify);
      return;
    }
    await delay(options.intervalMs ?? 10000);
  }
}
const xml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export function supervisionPlist(
  manifest: SupervisionManifest,
  role: "supervisor" | "watchdog",
  executable: string,
) {
  const label = role === "supervisor" ? manifest.runnerLabel : manifest.watchdogLabel;
  const args = [
    executable,
    "--import",
    "tsx",
    self,
    role,
    "--manifest",
    join(manifest.directory, "supervision.json"),
    "--token",
    manifest.token,
  ];
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${xml(label)}</string><key>ProgramArguments</key><array>${args.map((a) => `<string>${xml(a)}</string>`).join("")}</array><key>WorkingDirectory</key><string>${xml(host)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><false/><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(process.env.PATH ?? "/usr/bin:/bin")}</string></dict><key>StandardOutPath</key><string>${xml(join(manifest.directory, `${role}.log`))}</string><key>StandardErrorPath</key><string>${xml(join(manifest.directory, `${role}.log`))}</string></dict></plist>`;
}
export async function launchIndependentSma(configPath: string, envFile: string) {
  if (process.platform !== "darwin" || !process.getuid) {
    throw new Error("Independent SMA launch currently requires macOS launchd");
  }
  const config = resolve(configPath);
  const environment = resolve(envFile);
  const directory = dirname(config);
  const parsed = JSON.parse(await readFile(config, "utf8"));
  if (parsed.version !== 3 || parsed.protocol !== "perps-sma-ablation-v1") {
    throw new Error("Independent launch is limited to the zero-model SMA protocol");
  }
  const vars = parse(await readFile(environment, "utf8"));
  if (
    Object.keys(vars).length !== 1 ||
    !vars.DATABASE_URL ||
    !["127.0.0.1", "localhost", "[::1]"].includes(new URL(vars.DATABASE_URL).hostname)
  ) {
    throw new Error("Explicit loopback database-only environment required");
  }
  if (await optionalJson(join(directory, "STARTED"))) {
    throw new Error("A started study cannot be launched again");
  }
  const token = randomUUID();
  const manifest: SupervisionManifest = {
    version: 1,
    token,
    directory,
    config,
    envFile: environment,
    createdAt: Date.now(),
    runnerLabel: `fun.pickler.sma.${token}.runner`,
    watchdogLabel: `fun.pickler.sma.${token}.watchdog`,
  };
  const preflight = await supervisedChild(
    manifest,
    process.execPath,
    evaluateArgs(manifest, "preflight"),
    { log: "launch-preflight.log" },
  );
  if (preflight.code !== 0) {
    throw new Error("SMA preflight failed; no job admitted");
  }
  await writeFile(join(directory, "supervision.json"), JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  const domain = `gui/${process.getuid()}`;
  for (const role of ["watchdog", "supervisor"] as const) {
    const path = join(directory, `${role}.plist`);
    await writeFile(path, supervisionPlist(manifest, role, process.execPath), {
      flag: "wx",
      mode: 0o600,
    });
    execFileSync("/bin/launchctl", ["bootstrap", domain, path], { timeout: 10000 });
    if (role === "watchdog") {
      let ready = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const record = await optionalJson(join(directory, "watchdog-ready.json"));
        if (record?.token === token && matchingProcess(record.pid, [self, "watchdog", token])) {
          ready = true;
          break;
        }
        await delay(250);
      }
      if (!ready) {
        throw new Error("Watchdog failed to become ready; runner not launched");
      }
    }
  }
  console.log(
    JSON.stringify({
      status: "independently-launched",
      session: parsed.sessionId,
      supervisorLabel: manifest.runnerLabel,
      watchdogLabel: manifest.watchdogLabel,
      modelCalls: 0,
    }),
  );
}
if (process.argv[1] && resolve(process.argv[1]) === self) {
  const { positionals, values } = parseArgs({
    options: { manifest: { type: "string" }, token: { type: "string" } },
    allowPositionals: true,
  });
  const manifest = JSON.parse(await readFile(values.manifest!, "utf8")) as SupervisionManifest;
  if (manifest.token !== values.token || manifest.version !== 1) {
    throw new Error("Invalid supervision identity");
  }
  try {
    if (positionals[0] === "supervisor") {
      await supervisor(manifest);
    } else if (positionals[0] === "watchdog") {
      await watchdog(manifest);
    } else {
      throw new Error("Unknown supervision role");
    }
  } catch {
    await writeSupervisionJson(join(manifest.directory, "supervision-failure.json"), {
      at: Date.now(),
      code: "SUPERVISION_FAILED",
      role: positionals[0],
    });
    const child = await optionalJson(join(manifest.directory, "supervised-runner.json"));
    if (child?.token === manifest.token && matchingProcess(child.pid, [cli, manifest.config])) {
      process.kill(child.pid, "SIGTERM");
    }
    await refreshReport(manifest).catch(() => {});
    await terminalNotice(manifest, "interrupted", { code: "SUPERVISION_FAILED" }).catch(() => {});
    process.exitCode = 1;
  }
}
