import { lstat, open, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PilotError } from "@pickler/core";
import {
  assertHourlyBreakoutConfig,
  BREAKOUT_NAMESPACE,
  type PerpsHourlyBreakoutConfig,
} from "@pickler/trading/evaluation";
import {
  ArtifactBudget,
  boundedJson,
  budgetWriter,
  checkoutCommit,
  digest,
  newDirectory,
} from "./files.js";
import { CAPTURE_GRID } from "./schedule.js";
import { exportSourcePacket, readSourceManifest } from "./report.js";
import { runSourceReportWorker } from "./report-worker-client.js";

export interface HourlyBreakoutCommandInput {
  command: string;
  configPath?: string | undefined;
  state?: string | undefined;
  envFile?: string | undefined;
  output?: string | undefined;
  allowPaid?: boolean | undefined;
  acceptancePath?: string | undefined;
  signal: AbortSignal;
}

export async function runHourlyBreakoutCommand(input: HourlyBreakoutCommandInput) {
  input.signal.throwIfAborted();
  if (input.allowPaid) {
    throw new PilotError("MODELS_DISABLED", "Hourly breakout commands cannot admit paid calls");
  }
  const offline = ["audit", "replay", "report", "audit-export", "status", "stop"].includes(
    input.command,
  );
  if (offline && input.state) {
    if (input.envFile || input.configPath || input.acceptancePath) {
      throw new PilotError(
        "INVALID_INPUT",
        "Saved source commands reject environment/configuration loading",
      );
    }
    const manifestPath = resolve(input.state);
    const selected = (await boundedJson(manifestPath, 4 * 1024 * 1024)) as { format?: string };
    if (selected.format === "hourly-breakout-financial-audit-v1") {
      const { runFinancialOfflineCommand } = await import("./financial-report.js");
      await runFinancialOfflineCommand(input);
      return;
    }
    const manifest = await readSourceManifest(manifestPath);
    if (input.command === "status") {
      console.log(
        JSON.stringify({
          processState: manifest.processState,
          processLiveness: "UNVERIFIED_READ_ONLY_STATUS",
          failureCode: manifest.failureCode,
          fixedStart: manifest.frozen.startsAt,
          fixedEnd: manifest.frozen.endsAt,
          financialAcceptance: false,
          accounts: 0,
          modelCalls: 0,
        }),
      );
      return;
    }
    if (input.command === "stop") {
      if (input.output) {
        throw new PilotError(
          "INVALID_INPUT",
          "Stop writes only the selected capture's local STOP marker",
        );
      }
      const directory = dirname(manifestPath);
      if (manifest.stopMarkerReservedBytes !== 14) {
        throw new PilotError(
          "BREAKOUT_SOURCE_INVALID",
          "Capture has no pre-reserved STOP control bytes",
        );
      }
      try {
        await lstat(join(directory, "STOP"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
        const stop = await open(join(directory, "STOP"), "wx", 0o600);
        try {
          await stop.writeFile("OPERATOR_STOP\n");
          await stop.sync();
        } finally {
          await stop.close();
        }
      }
      console.log(
        JSON.stringify({ stopRequested: true, financialAcceptance: false, modelCalls: 0 }),
      );
      return;
    }
    const output = await newDirectory(input.output);
    const budget = new ArtifactBudget();
    if (input.command === "audit-export") {
      await exportSourcePacket(manifestPath, output, budgetWriter(budget));
    } else {
      await runSourceReportWorker(
        {
          sourceDirectory: dirname(manifestPath),
          outputDirectory: output,
          manifest,
          generation: "generation-offline",
        },
        budget,
        input.signal,
      );
    }
    console.log(
      JSON.stringify({
        status: "OFFLINE_COMPLETE",
        command: input.command,
        output,
        financialAcceptance: false,
        modelCalls: 0,
      }),
    );
    return;
  }
  if (!input.configPath) {
    throw new PilotError(
      "INVALID_INPUT",
      "Hourly breakout requires a frozen --config or saved --state",
    );
  }
  const configurationPath = resolve(input.configPath);
  const configText = await readFile(configurationPath, "utf8");
  const config = (await boundedJson(configurationPath, 65536)) as PerpsHourlyBreakoutConfig;
  assertHourlyBreakoutConfig(config);
  if (input.command === "run") {
    // This decision precedes every database file and public/provider composition. The separate
    // financial adapter is available only to a future explicitly accepted financial host.
    if (!input.acceptancePath) {
      throw new PilotError(
        "BREAKOUT_FUTURE_FINANCIAL_AUTHORIZATION_REQUIRED",
        "Financial screen remains disabled: T0/operator and signed technical/source/financial acceptance are required",
      );
    }
    const { runAcceptedHourlyBreakout } = await import("./financial-adapter.js");
    await runAcceptedHourlyBreakout({ ...input, config, configText });
    return;
  }
  if (["status", "report", "audit-export", "stop"].includes(input.command)) {
    const { runFinancialReadCommand } = await import("./financial-adapter.js");
    await runFinancialReadCommand({ ...input, config, configText });
    return;
  }
  if (input.acceptancePath) {
    throw new PilotError("INVALID_INPUT", "Source commands cannot accept financial authorization");
  }
  if (input.state) {
    throw new PilotError("INVALID_INPUT", "This command does not accept a saved source state");
  }
  if (input.command === "prepare") {
    if (input.envFile) {
      throw new PilotError(
        "INVALID_INPUT",
        "Disabled preparation is offline and rejects an environment file",
      );
    }
    const output = await newDirectory(input.output);
    await budgetWriter(new ArtifactBudget()).write(
      join(output, "preparation.json"),
      Buffer.from(
        JSON.stringify({
          format: "hourly-breakout-preparation-v1",
          config,
          configHash: digest(config),
          implementationCommit: checkoutCommit(),
          reviewedParameterContract: BREAKOUT_NAMESPACE,
          sourcePrerequisite: CAPTURE_GRID,
          financialT0: null,
          operator: null,
          financialAcceptance: false,
          publicRequests: 0,
          databaseConnections: 0,
          modelCalls: 0,
          accountsCreated: 0,
          status: "PREPARED_DISABLED_FUTURE_FINANCIAL_SCREEN",
        }) + "\n",
      ),
    );
    console.log(
      JSON.stringify({
        status: "PREPARED_DISABLED",
        output,
        financialAcceptance: false,
        modelCalls: 0,
      }),
    );
    return;
  }
  if (!input.envFile || !input.output) {
    throw new PilotError(
      "INVALID_INPUT",
      "Local preflight/stability require --env-file and new --output",
    );
  }
  if (input.command === "preflight") {
    const output = await newDirectory(input.output);
    const { localPreflight } = await import("./host.js");
    const result = await localPreflight({
      config,
      envFile: input.envFile,
      output,
      signal: input.signal,
    });
    await budgetWriter(new ArtifactBudget()).write(
      join(output, "preflight.json"),
      Buffer.from(JSON.stringify(result) + "\n"),
    );
    console.log(
      JSON.stringify({ status: result.status, output, publicRequests: 0, modelCalls: 0 }),
    );
    return;
  }
  if (input.command === "stability") {
    const { runSourceCapture } = await import("./host.js");
    await runSourceCapture({
      config,
      configPath: configurationPath,
      configText,
      envFile: input.envFile,
      output: input.output,
      signal: input.signal,
    });
    return;
  }
  throw new PilotError("INVALID_INPUT", "Unsupported hourly breakout operation");
}
