import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { PilotError } from "@pickler/core";
import { lidClosed } from "../paper-study/comparison-host.js";

export async function checkOpenLid(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new PilotError("AWAKE_GUARD_UNSUPPORTED_PLATFORM", "Local capture requires macOS guards");
  }
  const result = await promisify(execFile)("/usr/sbin/ioreg", [
    "-r",
    "-k",
    "AppleClamshellState",
    "-d",
    "4",
  ]);
  if (lidClosed(result.stdout)) {
    throw new PilotError("LID_CLOSED", "Capture cannot run with the laptop lid closed");
  }
}

export async function startAwakeGuard(failed: (error: PilotError) => void) {
  await checkOpenLid();
  const child = spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], {
    stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  let stopping = false;
  let exited = false;
  child.once("exit", () => {
    exited = true;
    if (!stopping) {
      failed(new PilotError("AWAKE_GUARD_LOST", "Idle-sleep guard exited during capture"));
    }
  });
  return {
    async check() {
      if (exited || child.exitCode !== null) {
        throw new PilotError("AWAKE_GUARD_LOST", "Idle-sleep guard is unavailable");
      }
      await checkOpenLid();
    },
    stop() {
      stopping = true;
      child.kill();
    },
  };
}
