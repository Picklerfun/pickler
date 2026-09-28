import { createHash } from "node:crypto";
import {
  quantForecast,
  quantProposal,
  type QuantInput,
  type QuantForecast,
  type QuantProposal,
} from "@pickler/core";
import { comparisonProbeInput } from "./comparison-probe.js";

export const scenarioChecks = [
  "price_basis",
  "averaging_window",
  "tie_rule",
  "resolution_source",
] as const;
export interface BenchmarkScenario {
  id: string;
  split: "development" | "heldout";
  family: string;
  target: (typeof scenarioChecks)[number];
  expectedVeto: boolean;
  labelOrigin: "synthetic-authored-not-human-reviewed";
  input: QuantInput;
  forecast: QuantForecast;
  proposal: QuantProposal;
  sha256: string;
}
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
// Disjoint drafting families are fixed in source before any paid evaluation.
const phrases = {
  development: {
    price_basis: [
      [
        "Settlement compares a time-weighted mean price",
        "Settlement compares a single instantaneous price",
      ],
      ["Use the TWAP, never a single spot tick", "Use one spot tick, never a TWAP"],
      [
        "The determining measure is an averaged BTC price",
        "The determining measure is the last individual BTC quote",
      ],
    ],
    averaging_window: [
      [
        "computed over the final 60 seconds only, not the whole event",
        "computed over the entire five-minute event, not the final 60 seconds",
      ],
      [
        "the sampling interval is the last minute",
        "the sampling interval starts when the five-minute event starts and spans the whole event",
      ],
      [
        "only observations from the closing minute enter the average",
        "all observations from all five minutes enter the average",
      ],
    ],
    tie_rule: [
      [
        "Equal terminal and opening values award Up",
        "Equal terminal and opening values award Down",
      ],
      ["An exact tie is an Up outcome", "An exact tie is a Down outcome"],
      [
        "Up includes equality with the opening threshold",
        "Down includes equality with the opening threshold; Up requires strictly greater",
      ],
    ],
    resolution_source: [
      [
        "Chainlink determines official payouts; Coinbase is predictive reference only",
        "Coinbase determines official payouts; Chainlink is not the settlement source",
      ],
      [
        "Official data comes from Chainlink, independently of the Coinbase forecast proxy",
        "Official data comes from Coinbase, and no Chainlink observation determines resolution",
      ],
      [
        "Resolve from the Chainlink feed; using Coinbase for prediction does not replace it",
        "Resolve exclusively from the Coinbase feed, not the Chainlink feed",
      ],
    ],
  },
  heldout: {
    price_basis: [
      [
        "Integrate the sampled price through time, then divide by duration",
        "Take exactly one price observation at the settlement boundary; no temporal integration",
      ],
      [
        "The benchmark is the duration-weighted aggregate of quotes",
        "The benchmark is the price at one instant, with no aggregation of quotes",
      ],
      [
        "Each observation contributes in proportion to the time it represents",
        "Earlier observations have no weight: the final tick alone is the benchmark",
      ],
    ],
    averaging_window: [
      [
        "Discard every sample preceding the final sixty seconds",
        "Include every sample since the start of the five-minute contract, not just the last minute",
      ],
      [
        "The averaging interval begins sixty seconds before expiration and ends at expiration",
        "The averaging interval begins at event inception and ends five minutes later at expiration",
      ],
      [
        "Use the closing 60-second segment rather than the full lifetime",
        "Use the contract's full five-minute lifetime rather than its closing segment",
      ],
    ],
    tie_rule: [
      [
        "When the difference is zero, the higher-or-equal side (Up) is paid",
        "When the difference is zero, only the downward side is paid",
      ],
      [
        "The payout test for Up is terminal >= threshold",
        "The payout test for Up is terminal > threshold; terminal <= threshold pays Down",
      ],
      [
        "A flat finish pays the Up share and zero on Down",
        "A flat finish pays the Down share and zero on Up",
      ],
    ],
    resolution_source: [
      [
        "The oracle of record is Chainlink; the separate Coinbase observation supports estimation",
        "The oracle of record is Coinbase; Chainlink is expressly excluded from settlement",
      ],
      [
        "The contract adjudicator uses the Chainlink stream, while the predictive feed is Coinbase",
        "The contract adjudicator uses the Coinbase stream, while any Chainlink series is irrelevant",
      ],
      [
        "The binding payout benchmark is provided by Chainlink, not by the predictive Coinbase feed",
        "The binding payout benchmark is provided by Coinbase, not by Chainlink",
      ],
    ],
  },
} as const;

export function prepareBenchmarkScenarios(): BenchmarkScenario[] {
  const fixture = comparisonProbeInput(Date.UTC(2026, 8, 28, 12, 1, 10));
  const forecast = quantForecast(fixture, fixture.observedAt);
  const proposal = quantProposal(fixture, forecast, fixture.observedAt, "central-v1").proposal!;
  return (["development", "heldout"] as const).flatMap((split) =>
    scenarioChecks.flatMap((target) =>
      [0, 1, 2].flatMap((n) =>
        [false, true].map((expectedVeto) => {
          const input = structuredClone(fixture);
          const id = `${split}-${target}-${n}-${expectedVeto ? "conflict" : "coherent"}`;
          const clauses = scenarioChecks.map(
            (check) => phrases[split][check][n]![check === target && expectedVeto ? 1 : 0],
          );
          input.item.market.rules = `Synthetic rule document for a five-minute BTC Up/Down event. ${clauses.join(". ")}. Compare the terminal measure with the published opening threshold. Other than the specified equality convention, an increase pays Up and a decrease pays Down.`;
          // IDs are opaque to the provider: labels and drafting-family metadata stay in this file only.
          input.item.market.id = sha256(id).slice(0, 16);
          for (const c of input.conditions) {
            c.marketId = input.item.market.id;
          }
          const record = {
            id,
            split,
            family: `${split}-${target}-${n}`,
            target,
            expectedVeto,
            labelOrigin: "synthetic-authored-not-human-reviewed" as const,
            input,
            forecast: structuredClone(forecast),
            proposal: structuredClone(proposal),
          };
          return { ...record, sha256: sha256(JSON.stringify(record)) };
        }),
      ),
    ),
  );
}
export function verifyBenchmarkScenarios(cases: BenchmarkScenario[]): void {
  if (cases.length !== 48 || new Set(cases.map((c) => c.id)).size !== 48) {
    throw new Error("SCENARIO_CARDINALITY");
  }
  const expected = prepareBenchmarkScenarios();
  if (JSON.stringify(cases) !== JSON.stringify(expected)) {
    throw new Error("FROZEN_SCENARIOS_CHANGED");
  }
}
