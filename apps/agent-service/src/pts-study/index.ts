import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { PilotError } from "@pickler/core";
import {
  assertPtsConfig,
  PTS_POLICY,
  PTS_INTRADAY_POLICY,
  ptsConfigVersion,
  ptsVariant,
  inspectPtsHistory,
  replayPtsSignals,
  replayPtsFinance,
  auditPtsStudy,
  type PerpsPtsConfig,
  type PtsReplayInput,
} from "@pickler/trading/pts";
import { digest, bytesHash, commit, readJson, newDirectory } from "./files.js";
import { ptsReport } from "./report.js";
export interface PtsCommandInput {
  command: string;
  configPath?: string | undefined;
  state?: string | undefined;
  envFile?: string | undefined;
  output?: string | undefined;
  allowPaid?: boolean | undefined;
  signal: AbortSignal;
}
export async function runPtsCommand(input: PtsCommandInput) {
  if (input.allowPaid) {
    throw new PilotError("MODELS_DISABLED", "PTS commands forbid model admission");
  }
  input.signal.throwIfAborted();
  if (["replay", "audit"].includes(input.command)) {
    if (!input.state || input.envFile || input.configPath) {
      throw new PilotError(
        "INVALID_INPUT",
        "Offline PTS requires one --state and new --output; env/config forbidden",
      );
    }
    const packet = (await readJson(input.state)) as Record<string, unknown>;
    const output = await newDirectory(input.output);
    if (input.command === "replay") {
      const history = (packet.history ?? packet) as PtsReplayInput;
      if (packet.history && packet.historyHash !== digest(history)) {
        throw new PilotError("AUDIT_HASH_MISMATCH", "Original history hash differs");
      }
      const result = replayPtsSignals(history, digest),
        financial = await replayPtsFinance(history, digest);
      await ptsReport(
        output,
        {
          ...result,
          rows: undefined,
          analyzerCommit: commit(),
          policyHash: digest(history.candidate ? PTS_INTRADAY_POLICY : PTS_POLICY),
          financial,
          publicTrialStarted: false,
        },
        result.rows,
      );
    } else {
      const payload = packet.payload as Parameters<typeof auditPtsStudy> extends [
        infer S,
        ...unknown[],
      ]
        ? { study: S; accounts: Parameters<typeof auditPtsStudy>[1] }
        : never;
      if (
        packet.protocol !== "perps-decision-audit-export-v1" ||
        packet.payloadHash !== digest(payload)
      ) {
        throw new PilotError("AUDIT_HASH_MISMATCH", "Consistent study export hash differs");
      }
      const report = auditPtsStudy(payload.study, payload.accounts, digest);
      await ptsReport(
        output,
        {
          ...report,
          rows: undefined,
          analyzerCommit: commit(),
          exporterCommit: packet.exportCommit ?? "NOT_VERIFIABLE",
          accounts: payload.accounts,
        },
        report.rows,
      );
    }
    console.log(JSON.stringify({ status: "offline-complete", output, modelCalls: 0 }));
    return;
  }
  if (!input.configPath) {
    throw new PilotError("INVALID_INPUT", "PTS --config required");
  }
  const text = await readFile(resolve(input.configPath), "utf8");
  const config = JSON.parse(text) as PerpsPtsConfig;
  assertPtsConfig(config);
  const policy = config.version === 9 ? PTS_INTRADAY_POLICY : PTS_POLICY;
  const strategyVersions = {
    "sma-reference": "1.0.0",
    [ptsVariant(config)]: ptsConfigVersion(config),
  };
  if (input.command === "prepare") {
    const output = await newDirectory(input.output);
    const responses: {
      file: string;
      sha256: string;
      url: string;
      receivedAt: number;
      bytes: number;
    }[] = [];
    let capturedBytes = 0;
    let captured: Awaited<
      ReturnType<
        typeof import("@pickler/agent-runtime/plugins/perps-paper/public-study").preparePtsHistory
      >
    >;
    if (input.state) {
      const saved = (await readJson(input.state)) as typeof captured & {
        format: string;
        historyHash: string;
        policyHash: string;
        responses: typeof responses;
      };
      if (
        saved.format !== "pts-preparation-v1" ||
        saved.historyHash !== digest(saved.history) ||
        saved.policyHash !== digest(policy) ||
        (saved.history.candidate ?? "pts-trend-reversal@0.2.0") !== config.candidate
      ) {
        throw new PilotError("AUDIT_HASH_MISMATCH", "Saved preparation identity or hash differs");
      }
      for (const response of saved.responses) {
        if (!/^response-[0-9]{3}\.json$/.test(response.file)) {
          throw new PilotError("INVALID_INPUT", "Saved public response path is not bounded");
        }
        const body = await readFile(join(dirname(resolve(input.state)), response.file), "utf8");
        if (bytesHash(body) !== response.sha256 || Buffer.byteLength(body) !== response.bytes) {
          throw new PilotError("AUDIT_HASH_MISMATCH", "Original public response bytes differ");
        }
        await writeFile(join(output, response.file), body, { mode: 0o600, flag: "wx" });
        responses.push(response);
      }
      captured = saved;
    } else {
      const { preparePtsHistory } =
        await import("@pickler/agent-runtime/plugins/perps-paper/public-study");
      const { DEFAULT_CONFIG } = await import("@pickler/core");
      const agent = {
        id: "pts-prepare-public",
        tenantId: config.tenantId,
        version: 1,
        paused: false,
        scheduleEnabled: false,
        nextDueAt: null,
        config: {
          ...structuredClone(DEFAULT_CONFIG),
          tools: [
            "listPerpMarkets",
            "getPerpSnapshot",
            "getPerpOrderBook",
            "getPerpCandles",
            "getPerpFundingHistory",
          ],
          plugins: { version: 1, enabled: ["perpl", "perps-paper"] },
          perpl: {
            version: 2,
            network: config.network,
            markets: config.markets.map((m) => m.symbol),
          },
          perpsPaper: { version: 1, policy: "conservative-1x-v1" },
        },
      };
      const scope = { tenantId: config.tenantId, agentId: agent.id };
      captured = await preparePtsHistory(
        { agent: async () => agent as import("@pickler/core").AgentRecord },
        scope,
        input.signal,
        {
          commit: commit(),
          candidateVersion: ptsConfigVersion(config),
          guard: async () => {
            if ((await readFile(resolve(input.configPath!), "utf8")) !== text) {
              throw new PilotError("CONFIG_CHANGED", "Preparation configuration changed");
            }
          },
          capture: async (response) => {
            capturedBytes += Buffer.byteLength(response.body);
            if (capturedBytes > 64 * 1024 * 1024) {
              throw new PilotError(
                "PTS_CAPTURE_LIMIT",
                "Original public response capture exceeds 64 MiB; preparation stopped",
              );
            }
            const file = "response-" + String(responses.length).padStart(3, "0") + ".json";
            await writeFile(join(output, file), response.body, { mode: 0o600, flag: "wx" });
            responses.push({
              file,
              sha256: bytesHash(response.body),
              url: response.url,
              receivedAt: response.receivedAt,
              bytes: Buffer.byteLength(response.body),
            });
          },
        },
      );
    }
    const historyPacket = {
      ...captured,
      format: "pts-preparation-v1",
      exporterCommit: commit(),
      sourceCapture: input.state ? resolve(input.state) : null,
      historyHash: digest(captured.history),
      policyHash: digest(policy),
      responses,
      trialStarted: false,
    };
    const body = JSON.stringify(historyPacket, null, 2) + "\n";
    await writeFile(join(output, "history.json"), body, { mode: 0o600, flag: "wx" });
    const frozen = { ...config, history: { file: "history.json", sha256: bytesHash(body) } };
    await writeFile(join(output, "study.json"), JSON.stringify(frozen, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    const { PTS_CATALOG } = await import("@pickler/trading/pts");
    const coverage = PTS_CATALOG.map((m) => {
      const h = captured.history.markets.find((h) => h.market.symbol === m.symbol);
      const analysis = h
        ? inspectPtsHistory(h, captured.history.to, ptsConfigVersion(config))
        : null;
      return {
        symbol: m.symbol,
        marketId: m.marketId,
        eligible:
          !captured.fatalCode &&
          !!analysis &&
          analysis.validationStatus === "VALID" &&
          analysis.coverage.every((c) => c.eligible),
        validation: analysis?.validationStatus ?? "NOT_VERIFIABLE",
        checks: analysis?.checks ?? [],
        coverage: analysis?.coverage ?? "NOT_VERIFIABLE",
        reason: analysis?.reason ?? "NOT_VERIFIABLE",
      };
    });
    await ptsReport(
      output,
      {
        protocol: "pts-preparation-v1",
        mode: input.state ? "OFFLINE_REBUILD_OF_SAVED_CAPTURE" : "SINGLE_PUBLIC_CAPTURE",
        newPublicRequests: input.state ? 0 : captured.requests,
        captureCommit: captured.history.commit,
        commit: commit(),
        configurationHash: digest(frozen),
        policyHash: digest(policy),
        strategyVersions,
        baselineCommit: "0bf07d70037878da1edb93cc8325c7d9d1670b32",
        catalog: captured.catalog,
        historyHash: digest(captured.history),
        from: captured.history.from,
        to: captured.history.to,
        requests: captured.requests,
        diagnostics: captured.diagnostics,
        fatalCode: captured.fatalCode,
        coverage,
        publicTrialEnabled: coverage.some((c) => c.eligible),
        publicTrialStarted: false,
        modelCalls: 0,
        modelCostUSD: "0",
        modelReservationsUSD: "0",
        responses,
      },
      coverage,
    );
    if (input.envFile && !captured.fatalCode) {
      const { prepareDatabase } = await import("./host.js");
      await prepareDatabase(frozen, input.envFile, {
        commit: commit(),
        configurationHash: digest(frozen),
        policyHash: digest(policy),
        historyHash: digest(captured.history),
        acquisitionPolicy: frozen.acquisitionPolicy,
        strategyVersions,
        baselineCommit: "0bf07d70037878da1edb93cc8325c7d9d1670b32",
        catalog: captured.catalog,
        coverage,
        modelCalls: 0,
      });
    }
    console.log(
      JSON.stringify({
        status: "prepared-not-started",
        output,
        eligibleMarkets: coverage.filter((c) => c.eligible).map((c) => c.symbol),
        modelCalls: 0,
      }),
    );
    return;
  }
  const packet = (await readJson(
    join(dirname(resolve(input.configPath)), config.history.file),
  )) as { history: PtsReplayInput; historyHash: string; policyHash: string };
  if (
    bytesHash(
      await readFile(join(dirname(resolve(input.configPath)), config.history.file), "utf8"),
    ) !== config.history.sha256 ||
    packet.historyHash !== digest(packet.history) ||
    packet.policyHash !== digest(policy) ||
    (packet.history.candidate ?? "pts-trend-reversal@0.2.0") !== config.candidate
  ) {
    throw new PilotError("AUDIT_HASH_MISMATCH", "Frozen history/policy/configuration differs");
  }
  const { runPtsHost } = await import("./host.js");
  await runPtsHost({ ...input, config, configText: text, packet });
}
