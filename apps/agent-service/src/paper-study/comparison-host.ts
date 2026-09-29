import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  benchmarkReserved,
  comparisonReserved,
  type BenchmarkState,
  type ComparisonState,
} from "@pickler/trading/strategies";

export function serialExecutor() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn);
    tail = next.catch(() => {});
    return next;
  };
}
export function lidClosed(output: string): boolean {
  const match = /"AppleClamshellState"\s*=\s*(Yes|No)/.exec(output);
  if (!match) {
    throw new Error("LID_STATE_UNAVAILABLE");
  }
  return match[1] === "Yes";
}
export async function keepAwake() {
  if (process.platform !== "darwin") {
    throw new Error("AWAKE_GUARD_UNSUPPORTED_PLATFORM");
  }
  const result = await promisify(execFile)("/usr/sbin/ioreg", [
    "-r",
    "-k",
    "AppleClamshellState",
    "-d",
    "4",
  ]);
  if (lidClosed(result.stdout)) {
    throw new Error("LID_CLOSED");
  }
  const child = spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], {
    stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  return () => {
    child.kill();
  };
}
export async function historicalReservations(root: string, current: string, declared: string[]) {
  const known: { name: string; reserved: number; benchmarkReviews?: number }[] = [];
  for (const name of await readdir(root)) {
    if (name === current || name === "quant-campaign") {
      continue;
    }
    let raw;
    try {
      raw = JSON.parse(await readFile(join(root, name, "state.json"), "utf8"));
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        ["ENOENT", "ENOTDIR"].includes(String(error.code))
      ) {
        continue;
      }
      throw error;
    }
    if (!declared.includes(name)) {
      throw new Error("UNDECLARED_HISTORICAL_BUDGET");
    }
    if (![1, 2, 3, 4].includes(raw.version)) {
      throw new Error("UNSUPPORTED_HISTORICAL_BUDGET");
    }
    const reserved =
      raw.version === 4
        ? benchmarkReserved(raw as BenchmarkState)
        : raw.version === 3
          ? comparisonReserved(raw as ComparisonState)
          : raw.cases.reduce(
              (sum: number, c: { reservedApiUsd?: number; reservedUsd?: number }) =>
                sum + (c.reservedApiUsd ?? c.reservedUsd ?? 0),
              0,
            );
    if (!Number.isFinite(reserved) || reserved < 0) {
      throw new Error("INVALID_HISTORICAL_BUDGET");
    }
    known.push({
      name,
      reserved,
      ...(raw.version === 4 ? { benchmarkReviews: raw.reviews.length } : {}),
    });
  }
  if (declared.some((name) => !known.some((k) => k.name === name))) {
    throw new Error("MISSING_HISTORICAL_BUDGET");
  }
  return known;
}
