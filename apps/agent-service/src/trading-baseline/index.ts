import { PilotError } from "@pickler/core";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { BaselineError } from "./safe.js";

export async function runTradingBaseline(input: {
  command: string;
  inventory?: string | undefined;
  state?: string | undefined;
  output?: string | undefined;
  restoreTarget?: string | undefined;
  signal: AbortSignal;
}) {
  if (!input.output) {
    throw new PilotError("INVALID_INPUT", "A new --output directory is required");
  }
  const repository = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
  try {
    if (input.command === "baseline-export") {
      if (!input.inventory || input.state || input.restoreTarget) {
        throw new BaselineError("BASELINE_EXPORT_INVENTORY_REQUIRED");
      }
      const { exportBaseline } = await import("./export.js");
      const result = await exportBaseline({
        inventoryPath: input.inventory,
        output: input.output,
        signal: input.signal,
      });
      console.log(
        JSON.stringify({
          protocol: result.protocol,
          status: result.status,
          files: result.files.length,
          databases: result.databases.length,
        }),
      );
      if (result.status !== "complete") {
        process.exitCode = 1;
      }
    } else if (input.command === "baseline-verify") {
      if (!input.state || input.inventory || input.restoreTarget) {
        throw new BaselineError("BASELINE_VERIFY_STATE_REQUIRED");
      }
      const { verifyBaseline } = await import("./verify.js");
      const result = await verifyBaseline({
        state: input.state,
        output: input.output,
        verifierRepository: repository,
        signal: input.signal,
      });
      console.log(JSON.stringify(result));
      if (result.status !== "verified" || result.completeness !== "complete") {
        process.exitCode = 1;
      }
    } else if (input.command === "baseline-restore-check") {
      if (!input.state || input.inventory) {
        throw new BaselineError("BASELINE_RESTORE_STATE_REQUIRED");
      }
      const { restoreBaseline } = await import("./restore.js");
      const result = await restoreBaseline({
        state: input.state,
        output: input.output,
        verifierRepository: repository,
        signal: input.signal,
        ...(input.restoreTarget ? { targetPath: input.restoreTarget } : {}),
      });
      console.log(
        JSON.stringify({
          protocol: result.protocol,
          status: result.status,
          filesRestored: result.filesRestored,
          databases: result.databases,
        }),
      );
      if (result.status !== "verified-complete") {
        process.exitCode = 1;
      }
    } else {
      throw new BaselineError("BASELINE_COMMAND_UNSUPPORTED");
    }
  } catch (error) {
    if (error instanceof BaselineError) {
      throw new PilotError(error.code, error.code);
    }
    throw new PilotError("BASELINE_FAILED", "Baseline failed; original data was not modified");
  }
}
