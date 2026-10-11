import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

export class BaselineFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "BaselineFailure";
  }
}

/** No shell, inherited secrets, connection strings in argv, or raw child error output. */
export async function baselineProcess(input: {
  command: string;
  args: string[];
  env?: Record<string, string>;
  signal: AbortSignal;
  stdinFile?: string;
  stdoutFile?: string;
}): Promise<string> {
  input.signal.throwIfAborted();
  const child = spawn(input.command, input.args, {
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/local/bin",
      LANG: "C.UTF-8",
      ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      ...input.env,
    },
    stdio: ["pipe", "pipe", "pipe"],
    signal: input.signal,
  });
  let output = "";
  if (!input.stdoutFile) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      output += data;
      if (Buffer.byteLength(output) > 1024 * 1024) {
        child.kill();
      }
    });
  }
  // Drain but never retain potentially credential-bearing stderr.
  child.stderr.resume();
  const streams: Promise<unknown>[] = [];
  if (input.stdoutFile) {
    streams.push(
      pipeline(child.stdout, createWriteStream(input.stdoutFile, { flags: "wx", mode: 0o600 })),
    );
  }
  if (input.stdinFile) {
    streams.push(pipeline(createReadStream(input.stdinFile), child.stdin));
  } else {
    child.stdin.end();
  }
  streams.push(
    new Promise<void>((resolve, reject) => {
      child.once("error", () => reject(new BaselineFailure("BASELINE_PROCESS_FAILED")));
      child.once("close", (code) => {
        if (code === 0 && Buffer.byteLength(output) <= 1024 * 1024) {
          resolve();
        } else {
          reject(new BaselineFailure("BASELINE_PROCESS_FAILED"));
        }
      });
    }),
  );
  try {
    await Promise.all(streams);
    input.signal.throwIfAborted();
    return output;
  } catch {
    child.kill();
    await Promise.allSettled(streams);
    throw new BaselineFailure("BASELINE_PROCESS_FAILED");
  }
}
