/* The two servers the rendered checks need, and how the runner starts and stops them.
 *
 * The web app renders on the server and asks an API for its data, so a check needs both: the
 * fixture API (fixture-api.mjs) and Next pointed at it. The ports are fixed because the checks'
 * remedies name them; a port that is already taken is never reused on a guess, because another
 * checkout of this repository serves the same application on a neighbouring port and measuring it
 * would report somebody else's branch. */
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";

export const FIXTURE_PORT = 8799;
export const WEB_PORT = 3001;
export const BASE_URL = `http://localhost:${WEB_PORT}`;

/* `next dev` rewrites this tracked file to point at its own types folder, and leaves it that way.
 * In a worktree several agents commit from, that is a change nobody made waiting to be swept into
 * somebody's commit, so the runner puts back what it found. */
const REWRITTEN = ["apps/web/next-env.d.ts"];

/** Whether anything accepts a connection on this port, on either loopback address. */
export async function listening(port) {
  const tried = await Promise.all(
    ["127.0.0.1", "::1"].map(
      (host) =>
        new Promise((resolve) => {
          const socket = connect({ port, host });
          const answer = (value) => {
            socket.destroy();
            resolve(value);
          };
          socket.once("connect", () => answer(true));
          socket.once("error", () => answer(false));
          socket.setTimeout(1000, () => answer(false));
        }),
    ),
  );
  return tried.some(Boolean);
}

/**
 * The environment Next runs in for a check.
 *
 * The API is the fixture. Supabase is switched off by setting both of its variables to nothing: a
 * variable that is set, even to the empty string, is not overwritten by apps/web/.env.local, and
 * with authentication unconfigured the studio and the account render from their preview fixtures
 * instead of redirecting a browser that has no session to /signin.
 */
export function webEnv(env) {
  return {
    ...env,
    PICKLER_API_LOCAL_URL: `http://127.0.0.1:${FIXTURE_PORT}`,
    NEXT_PUBLIC_SUPABASE_URL: "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  };
}

/** What the runner does about the servers, decided from what is already there. */
export function plan({ baseUrl, fixtureBusy, webBusy }) {
  if (baseUrl) {
    return { start: false, baseUrl, refuse: null };
  }
  const busy = [...(fixtureBusy ? [FIXTURE_PORT] : []), ...(webBusy ? [WEB_PORT] : [])];
  if (busy.length) {
    return {
      start: false,
      baseUrl: null,
      refuse:
        `port ${busy.join(" and ")} already in use, and this runner did not start what is there.\n` +
        `Stop it, or name the server to measure: DESIGN_BASE_URL=${BASE_URL} npm run design:check`,
    };
  }
  return { start: true, baseUrl: BASE_URL, refuse: null };
}

async function answers(url, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(url);
      if (response.status < 500) {
        return true;
      }
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * Starts both servers and answers how to stop them. Throws if either never comes up.
 *
 * Their output goes straight to `logFile` (or nowhere, when it is null), never through a pipe this
 * process reads. The runner runs each check with spawnSync, which blocks its event loop for the
 * whole check, so a pipe would go unread for minutes. On Linux a write to a full pipe blocks, and
 * `next dev` logs a line per request: on the CI runner the 64 KiB pipe filled during the third
 * check and the dev server froze mid-write, answering nothing for the rest of the run. (On macOS
 * Node writes to a pipe asynchronously, so Next buffered in memory instead and nothing froze.)
 *
 * A signal that arrives while they are still coming up, which can take minutes, stops whatever
 * has been spawned by then: the handler is registered before the first child is. The options
 * exist for a test that stands in another process for the servers and waits less.
 */
export async function start(
  root,
  logFile = null,
  {
    target = process,
    spawn: spawnProcess = spawn,
    timeouts = { fixture: 60_000, web: 180_000 },
  } = {},
) {
  const children = [];
  const launch = (command, args, options) => {
    const out = logFile ? openSync(logFile, "a") : "ignore";
    try {
      // Its own process group, so stopping it stops whatever it started too.
      const child = spawnProcess(command, args, {
        ...options,
        detached: true,
        stdio: ["ignore", out, out],
      });
      children.push(child);
      return child;
    } finally {
      // The child holds its own copy of the descriptor.
      if (logFile) {
        closeSync(out);
      }
    }
  };
  const found = REWRITTEN.map((file) => path.join(root, file))
    .filter((file) => existsSync(file))
    .map((file) => [file, readFileSync(file, "utf8")]);
  const stop = () => {
    for (const child of children) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
    for (const [file, text] of found) {
      if (readFileSync(file, "utf8") !== text) {
        writeFileSync(file, text);
      }
    }
  };
  stopOnSignal(stop, target);
  try {
    launch(
      process.execPath,
      ["--import", "tsx", "scripts/design/fixture-api.mjs", String(FIXTURE_PORT)],
      { cwd: root, env: process.env },
    );
    launch(path.join(root, "node_modules/.bin/next"), ["dev", "-p", String(WEB_PORT)], {
      cwd: path.join(root, "apps/web"),
      env: webEnv(process.env),
    });
    const fixtureUp = await answers(
      `http://127.0.0.1:${FIXTURE_PORT}/v1/marketplace/activity`,
      timeouts.fixture,
    );
    const webUp = fixtureUp && (await answers(`${BASE_URL}/`, timeouts.web));
    if (!fixtureUp || !webUp) {
      throw new Error(`${fixtureUp ? "the web app" : "the fixture API"} did not come up`);
    }
  } catch (error) {
    stop();
    throw error;
  }
  return { stop };
}

/* What a process interrupted by each signal exits with: 128 plus the signal's number. */
const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143 };

/**
 * Stops the servers when the runner is interrupted. They run in their own process groups, so
 * Ctrl-C or a `kill` on the runner alone would leave them holding the ports for the next run.
 * `stop` runs once however many signals arrive; the exit status is the one the signal would have
 * given. `target` is the process, replaceable by a test.
 */
export function stopOnSignal(stop, target = process) {
  let stopped = false;
  for (const [signal, code] of Object.entries(SIGNAL_EXIT)) {
    target.on(signal, () => {
      if (!stopped) {
        stopped = true;
        stop();
      }
      target.exit(code);
    });
  }
}
