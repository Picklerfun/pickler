import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  supervisionFailure,
  supervisionEnvironment,
  supervisionPlist,
  supervisedChild,
  terminalNotice,
  watchdog,
  type SupervisionManifest,
} from "../src/perps-study/sma-supervision.js";

const base = {
  now: 100000,
  createdAt: 1000,
  identity: { startedAt: 1000 },
  childAlive: true,
  supervisorAlive: true,
  health: { at: 99000 },
  graceUntil: 1000000,
};
test("watchdog detects death, lost parent, stalls and fixed deadline without a restart", () => {
  assert.equal(supervisionFailure(base), null);
  assert.equal(supervisionFailure({ ...base, childAlive: false }), "RUNNER_DIED");
  assert.equal(supervisionFailure({ ...base, supervisorAlive: false }), "SUPERVISOR_DIED");
  assert.equal(supervisionFailure({ ...base, now: 220001 }), "RUNNER_HEARTBEAT_STALE");
  assert.equal(supervisionFailure({ ...base, graceUntil: 69999 }), "FIXED_DEADLINE_EXCEEDED");
  assert.equal(supervisionFailure({ ...base, identity: null }), "RUNNER_NOT_STARTED");
  assert.equal(supervisionFailure({ ...base, identity: null, now: 20000 }), null);
});
function manifest(directory: string): SupervisionManifest {
  return {
    version: 1,
    token: "controlled",
    directory,
    config: join(directory, "study.json"),
    envFile: join(directory, "database.env"),
    createdAt: Date.now(),
    runnerLabel: "controlled-runner",
    watchdogLabel: "controlled-watchdog",
  };
}
test("one-shot jobs are independent of the terminal and do not carry model secrets", () => {
  const env = supervisionEnvironment("controlled");
  assert.deepEqual(
    Object.keys(env).sort(),
    ["HOME", "LANG", "PATH", "PICKLER_SMA_SUPERVISION_TOKEN", "TMPDIR"]
      .filter((key) => key in env)
      .sort(),
  );
  for (const role of ["supervisor", "watchdog"] as const) {
    const plist = supervisionPlist(manifest("/tmp/a&b"), role, "/node");
    assert.match(plist, /<key>KeepAlive<\/key><false\/>/);
    assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
    assert.match(plist, /a&amp;b/);
    assert.doesNotMatch(plist, /StartInterval|API_KEY|DATABASE_URL|PrivateKey/);
  }
});
test("real controlled child kill produces the exact signal and a single recorded notice", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "sma-supervision-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const m = manifest(dir);
  const running = supervisedChild(m, process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    identityFile: "supervised-runner.json",
  });
  let identity: { pid: number } | undefined;
  for (let tries = 0; tries < 100; tries++) {
    try {
      identity = JSON.parse(await readFile(join(dir, "supervised-runner.json"), "utf8"));
      break;
    } catch {
      await delay(10);
    }
  }
  assert.ok(identity?.pid);
  process.kill(identity.pid, "SIGKILL");
  const exit = await running;
  assert.deepEqual(exit, { code: null, signal: "SIGKILL" });
  let notices = 0;
  const notify = () => {
    notices++;
    return true;
  };
  await watchdog(m, { report: async () => {}, notify, intervalMs: 10 });
  assert.equal(
    JSON.parse(await readFile(join(dir, "supervision-failure.json"), "utf8")).code,
    "RUNNER_DIED",
  );
  assert.equal(await terminalNotice(m, "interrupted", exit, notify), false);
  assert.equal(notices, 1);
  const receipt = JSON.parse(await readFile(join(dir, "notification-result.json"), "utf8"));
  assert.equal(receipt.submitted, true);
  assert.equal(receipt.delivery, "NOT_VERIFIABLE");
  assert.equal(
    JSON.parse(await readFile(join(dir, "supervision-notice.json"), "utf8")).details.code,
    "RUNNER_DIED",
  );
});
