import { diagnosticTransport, type Diagnostics } from "./diagnostics";
import { resolve } from "node:path";
import { costUsd, EvaluationFailure, fingerprint, type Rates } from "../decision-evaluation";
import { enrichedState, type CaseV2 } from "../v2/context";
import { callV2, type Variant, type ResultV2 } from "../v2/provider";
import { makePlanV3 } from "../v3/provider";
import { applyPolicy } from "./policy";
import { CampaignLedger, saveExclusive } from "../v2/ledger";
import type { Observation } from "../v2/report";

export async function runCases(
  cases: CaseV2[],
  ledger: CampaignLedger,
  env: NodeJS.ProcessEnv,
  rates: Rates,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
  controlOnly = false,
) {
  const observations: Observation[] = [];
  const failures: { caseId: string; variant: Variant; code: string }[] = [];
  let stopCode: string | null = null;
  try {
    for (const item of cases) {
      const state = enrichedState(item);
      const responses = new Map<Variant, { result: ResultV2; cost: number; elapsedMs: number }>();
      async function request(variant: Variant) {
        if (signal.aborted) {
          throw new EvaluationFailure("CANCELLED_OR_TIMEOUT");
        }
        const plan = makePlanV3(variant, state, env, rates);
        const directory = await ledger.reserve(item.base.id, variant, plan.reservedUsd, {
          requestHash: fingerprint(plan.body),
          model: plan.model,
          rates: plan.rates,
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
          const cost = costUsd(result.usage, plan.rates);
          const entry = { result, cost, elapsedMs: Date.now() - start, diagnostic };
          await saveExclusive(resolve(directory, "completed.json"), {
            caseId: item.base.id,
            variant,
            ...entry,
          });
          responses.set(variant, entry);
          if (cost > plan.reservedUsd || (await ledger.accounting()).accountedUsd > 0.5) {
            throw new EvaluationFailure("COST_EXCEEDED_RESERVATION");
          }
          return entry;
        } catch (error) {
          const code = error instanceof EvaluationFailure ? error.code : "V2_REQUEST_FAILED";
          await saveExclusive(resolve(directory, "failed.json"), {
            caseId: item.base.id,
            variant,
            code,
            diagnostic,
            billingUnknown: !responses.has(variant),
            reservedUsd: plan.reservedUsd,
          });
          failures.push({ caseId: item.base.id, variant, code });
          throw new EvaluationFailure(code);
        }
      }
      for (const variant of (controlOnly ? ["llm-original"] : ["llm-original", "jev-v2"]) as (
        "llm-original" | "jev-v2"
      )[]) {
        const entry = await request(variant);
        observations.push({
          caseId: item.base.id,
          strategy: variant,
          assessment: entry.result.assessment,
          cost: entry.cost,
          elapsedMs: entry.elapsedMs,
          backupCalls: 0,
        });
      }
      if (controlOnly) {
        continue;
      }
      const jev = responses.get("jev-v2")!;
      let routed = applyPolicy(state, jev.result.answer!);
      let cost = jev.cost;
      let elapsedMs = jev.elapsedMs;
      let backupCalls = 0;
      if (routed.backupRequired) {
        const backup = await request("llm-backup");
        backupCalls = 1;
        cost += backup.cost;
        elapsedMs += backup.elapsedMs;
        routed = applyPolicy(state, jev.result.answer!, backup.result.answer!);
      }
      const row: Observation = {
        caseId: item.base.id,
        strategy: "cascade-v2",
        assessment: routed.assessment,
        cost,
        elapsedMs,
        backupCalls,
      };
      await saveExclusive(resolve(ledger.directory, "policies", `${item.base.id}.json`), {
        ...row,
        routed,
      });
      observations.push(row);
    }
  } catch (error) {
    stopCode = error instanceof EvaluationFailure ? error.code : "V2_EXECUTION_OR_STORAGE_FAILED";
  }
  return { observations, failures, stopCode };
}
