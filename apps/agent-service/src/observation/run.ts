import { resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { makePlanV3, instructions } from "../evaluation/v3/provider";
import { callV2, type Variant, type ResultV2 } from "../evaluation/v2/provider";
import { applyPolicy, policy } from "../evaluation/v4/policy";
import { diagnosticTransport, type Diagnostics } from "../evaluation/v4/diagnostics";
import { costUsd, fingerprint, EvaluationFailure } from "../evaluation/decision-evaluation";
import { writeImmutable, localDirectory } from "./capture";
import { accounting, reserve, withCampaign, readOptional, type Campaign } from "./ledger";
import type { ObservationCase } from "./prepare";

export async function runObservation(
  directory: string,
  cases: ObservationCase[],
  keys: NodeJS.ProcessEnv,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
) {
  directory = localDirectory(directory);
  return withCampaign(directory, async (campaign) => {
    if (keys.MODEL_ID !== campaign.llmModel || keys.MODEL_BASE_URL !== campaign.llmBaseUrl) {
      throw new EvaluationFailure("OBSERVATION_PROVIDER_CONFIGURATION_CHANGED");
    }
    const version = {
      context: "2.0.0",
      instructions: instructions.version,
      policy: policy.version,
    };
    const rows = [];
    let stopCode: string | null = null;
    try {
      for (const item of cases) {
        await writeImmutable(resolve(directory, "cases", `${item.id}.json`), item);
        // Freeze the input before any provider call. Neither primary decisions nor labels appear here.
        const state = structuredClone(item.state);
        async function request(variant: Variant) {
          signal.throwIfAborted();
          if (await readOptional(resolve(directory, "STOP.json"))) {
            throw new EvaluationFailure("OBSERVATION_STOPPED");
          }
          const plan = makePlanV3(
            variant,
            state,
            {
              TYPESAFE_API_KEY: keys.TYPESAFE_API_KEY,
              MODEL_API_KEY: keys.MODEL_API_KEY,
              MODEL_ID: campaign.llmModel,
              MODEL_BASE_URL: campaign.llmBaseUrl,
            },
            campaign.llmRates,
          );
          plan.rates = variant.startsWith("jev") ? campaign.jevRates : campaign.llmRates;
          plan.reservedUsd = costUsd(
            {
              input: Buffer.byteLength(plan.body) + 4096,
              output: variant.startsWith("jev") ? 0 : 4096,
            },
            plan.rates,
          );
          if (variant.startsWith("jev") && plan.model !== campaign.jevModel) {
            throw new EvaluationFailure("OBSERVATION_MODEL_CHANGED");
          }
          const path = await reserve(directory, campaign, item.id, variant, plan.reservedUsd, {
            versions: version,
            model: plan.model,
            rates: plan.rates,
            requestHash: fingerprint(plan.body),
            captureHash: item.captureHash,
          });
          const start = Date.now();
          const diagnostic: Diagnostics = { stage: "NOT_STARTED" };
          try {
            const result = await callV2(
              variant,
              state,
              plan,
              AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
              diagnosticTransport(transport, diagnostic),
            );
            const entry = {
              result,
              diagnostic,
              elapsedMs: Date.now() - start,
              cost: costUsd(result.usage, plan.rates),
            };
            await writeImmutable(resolve(path, "completed.json"), entry);
            if (
              entry.cost > plan.reservedUsd ||
              (await accounting(directory, campaign)).accountedUsd > campaign.maxUsd
            ) {
              throw new EvaluationFailure("OBSERVATION_COST_EXCEEDED_RESERVATION");
            }
            return entry;
          } catch (error) {
            await writeImmutable(resolve(path, "failed.json"), {
              code: safeCode(error),
              diagnostic,
              elapsedMs: Date.now() - start,
            });
            throw error;
          }
        }
        const control = await request("llm-original");
        const jev = await request("jev-v2");
        let routed = applyPolicy(state, jev.result.answer!);
        let backup: { result: ResultV2; elapsedMs: number; cost: number } | null = null;
        if (routed.backupRequired) {
          backup = await request("llm-backup");
          routed = applyPolicy(state, jev.result.answer!, backup.result.answer!);
        }
        const row = {
          caseId: item.id,
          label: item.label,
          eventId: item.eventId,
          captureHash: item.captureHash,
          versions: version,
          control,
          jev,
          backup,
          routed,
          classificationAgreement:
            JSON.stringify(control.result.assessment) === JSON.stringify(routed.assessment),
          strategyEstimatedUsd: jev.cost + (backup?.cost ?? 0),
          strategyLatencyMs: jev.elapsedMs + (backup?.elapsedMs ?? 0),
          experimentalEstimatedUsd: control.cost + jev.cost + (backup?.cost ?? 0),
          accuracy: null,
          prematureClosures: null,
          researchCostUsd: null,
        };
        await writeImmutable(resolve(directory, "results", `${item.id}.json`), row);
        rows.push(row);
      }
    } catch (error) {
      stopCode = safeCode(error);
      if (!(await readOptional(resolve(directory, "STOP.json")))) {
        await writeImmutable(resolve(directory, "STOP.json"), {
          code: stopCode,
          at: new Date().toISOString(),
        });
      }
    }
    return { rows, stopCode, accounting: await accounting(directory, campaign) };
  });
}

function safeCode(error: unknown) {
  return error instanceof EvaluationFailure
    ? error.code
    : "OBSERVATION_INTERRUPTED_OR_STORAGE_FAILURE";
}

export async function observationReport(
  directory: string,
  cases: ObservationCase[],
  campaign: Campaign,
) {
  const totals = await accounting(directory, campaign);
  const rows = await Promise.all(
    cases.map(async (item) => {
      const row = (await readOptional(resolve(directory, "results", `${item.id}.json`))) as
        Awaited<ReturnType<typeof runObservation>>["rows"][number] | undefined;
      return { item, row };
    }),
  );
  const complete =
    rows.every((r) => r.row) &&
    totals.unknownCharges === 0 &&
    !(await readOptional(resolve(directory, "STOP.json")));
  const group = (selected: typeof rows) => {
    const paired = selected.flatMap((r) => (r.row ? [r.row] : []));
    const controlUsd = paired.reduce((sum, r) => sum + r.control.cost, 0);
    const strategyUsd = paired.reduce((sum, r) => sum + r.strategyEstimatedUsd, 0);
    return {
      cases: selected.length,
      completePairs: paired.length,
      agreements: paired.filter((r) => r.classificationAgreement).length,
      controlClosures: paired.filter((r) => r.control.result.assessment.next === "FINALIZE").length,
      strategyClosures: paired.filter((r) => r.routed.assessment.next === "FINALIZE").length,
      unresolved: paired.filter((r) => r.routed.assessment.next !== "FINALIZE").length,
      backupCalls: paired.filter((r) => r.backup).length,
      pairedControlEstimatedUsd: controlUsd,
      pairedStrategyEstimatedUsd: strategyUsd,
      estimatedSavingsPercent:
        complete && controlUsd > 0 ? 100 * (1 - strategyUsd / controlUsd) : null,
      controlLatencyMs: paired.reduce((sum, r) => sum + r.control.elapsedMs, 0),
      strategyLatencyMs: paired.reduce((sum, r) => sum + r.strategyLatencyMs, 0),
      accuracy: null,
      prematureClosures: null,
      correctClosures: null,
    };
  };
  const requests = await readdir(resolve(directory, "requests"));
  const failures = (
    await Promise.all(
      requests.map((id) => readOptional(resolve(directory, "requests", id, "failed.json"))),
    )
  ).filter(Boolean).length;
  return {
    schemaVersion: 1,
    mode: "observation-only",
    complete,
    accounting: totals,
    experimentalEstimatedUsd: totals.unknownCharges ? null : totals.measuredUsd,
    failures,
    stop: (await readOptional(resolve(directory, "STOP.json"))) ?? null,
    overall: group(rows),
    events: Object.fromEntries(
      [...new Set(cases.map((c) => c.eventId ?? "UNKNOWN"))].map((id) => [
        id,
        group(rows.filter((r) => (r.item.eventId ?? "UNKNOWN") === id)),
      ]),
    ),
    primaryDecisionCostUsd: null,
    additionalResearchCostUsd: null,
    acceptancePassed: false,
    note: "Agreement measures paired evidence classifications, not forecast quality, trading outcomes or accuracy. No reviewed reference labels; unknown event IDs remain unknown. Costs are token-based estimates, not bills. Primary research and observer spending are separate.",
  };
}
