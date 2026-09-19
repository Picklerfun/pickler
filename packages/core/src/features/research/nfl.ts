import type { ResearchProtocol } from "./market-scope.js";
import {
  ModelFailure,
  type Market,
  type ModelAssessment,
  type Source,
  type OrderBook,
} from "./types.js";
export const NFL_SECTIONS = [
  "identity",
  "schedule",
  "rules",
  "teamContext",
  "injuries",
  "supporting",
  "contradicting",
  "quotes",
  "limitations",
] as const;
export const GENERAL_SECTIONS = [
  "identity",
  "timing",
  "rules",
  "context",
  "supporting",
  "contradicting",
  "quotes",
  "limitations",
] as const;
export interface ResearchReport {
  protocol: ResearchProtocol;
  forecast: {
    outcomeId: string | null;
    probability: { lower: number; estimate: number; upper: number } | null;
    inabilityReason: string | null;
  };
  sections: {
    section: (typeof NFL_SECTIONS)[number] | (typeof GENERAL_SECTIONS)[number];
    status: "supported" | "conflicting" | "missing" | "not_applicable";
    explanation: string;
    sourceIds: string[];
  }[];
}
/** Citable execution data, explicitly distinct from independent retrieved sources. */
export interface ResearchReference {
  id: string;
  kind: "market" | "quote" | "availability";
  sections: ResearchReport["sections"][number]["section"][];
  data: unknown;
}
export function researchReferences(
  market: Market,
  quotes: OrderBook[],
  availability: Record<string, string> = {},
): ResearchReference[] {
  return [
    {
      id: `context:market:${market.id}`,
      kind: "market",
      sections: ["identity", "schedule", "timing", "rules", "quotes", "limitations"],
      data: market,
    },
    {
      id: "context:availability",
      kind: "availability",
      sections: ["limitations"],
      data: availability,
    },
    ...quotes.map((quote): ResearchReference => ({
      id: `context:quote:${quote.outcomeId}:${quote.observedAt}`,
      kind: "quote",
      sections: ["quotes", "limitations"],
      data: quote,
    })),
  ];
}
export interface SportsContext {
  status: "available" | "no_coverage" | "stale";
  sources: Source[];
  usage?: unknown;
}
export interface SportsData {
  context(
    market: Market,
    signal: AbortSignal,
    beforeRequest: (network?: boolean) => Promise<void>,
  ): Promise<SportsContext>;
}
export function validateReport(
  assessment: ModelAssessment,
  market: Market,
  sources: Source[],
  references: ResearchReference[] = [],
  protocol: ResearchProtocol = "nfl-winner-v1",
): ResearchReport {
  const report = assessment.report;
  const fail = (reason: string, path = "report") => {
    throw new ModelFailure(`INVALID_RESEARCH_REPORT_${reason}`, {
      stage: "decision",
      validation: [{ code: reason.toLowerCase(), path }],
    });
  };
  if (!report || report.protocol !== protocol) {
    return fail("PROTOCOL", "report.protocol");
  }
  const required: readonly string[] =
    protocol === "nfl-winner-v1" ? NFL_SECTIONS : GENERAL_SECTIONS;
  if (
    new Set(report.sections.map((s) => s.section)).size !== required.length ||
    report.sections.length !== required.length
  ) {
    return fail("SECTIONS", "report.sections");
  }
  const ids = new Set(sources.map((s) => s.id));
  for (const [index, section] of report.sections.entries()) {
    if (
      !required.includes(section.section) ||
      !section.explanation.trim() ||
      section.sourceIds.some(
        (id) =>
          !ids.has(id) &&
          !references.some(
            (reference) => reference.id === id && reference.sections.includes(section.section),
          ),
      ) ||
      (section.status === "supported" && !section.sourceIds.length) ||
      (references.length > 0 &&
        section.section === "quotes" &&
        section.status === "supported" &&
        !references.some(
          (reference) => reference.kind === "quote" && section.sourceIds.includes(reference.id),
        ))
    ) {
      return fail("ATTRIBUTION", `report.sections[${index}].sourceIds`);
    }
  }
  const f = report.forecast;
  if (f.probability) {
    const { lower, estimate, upper } = f.probability;
    if (
      ![lower, estimate, upper].every(Number.isFinite) ||
      lower < 0 ||
      upper > 1 ||
      lower > estimate ||
      estimate > upper ||
      !market.outcomes.some((o) => o.id === f.outcomeId)
    ) {
      return fail("FORECAST", "report.forecast");
    }
  } else if (!f.inabilityReason?.trim()) {
    return fail("MISSING_ESTIMATE_REASON", "report.forecast.inabilityReason");
  }
  if (
    assessment.action === "TRADE" &&
    (f.outcomeId !== assessment.outcomeId ||
      !f.probability ||
      !assessment.probability ||
      (["lower", "estimate", "upper"] as const).some(
        (key) => f.probability![key] !== assessment.probability![key],
      ))
  ) {
    return fail("TRADE_MISMATCH", "report.forecast");
  }
  return report;
}
/** Only explicit NFL game moneylines; no guesses from category membership. */
export function nflMarketEligible(market: Market): boolean {
  return (
    market.sportsMarketType === "moneyline" &&
    /\b(NFL|National Football League)\b/i.test(market.question + " " + market.rules) &&
    !/\b(first half|first quarter|season winner|super bowl champion)\b/i.test(market.question)
  );
}
export function uniqueSources(sources: Source[]): Source[] {
  const urls = new Set<string>();
  const contents = new Set<string>();
  return sources.filter((source) => {
    const url = new URL(source.url);
    url.hash = "";
    const content = source.content.trim().replace(/\s+/g, " ");
    if (urls.has(url.href) || contents.has(content)) {
      return false;
    }
    urls.add(url.href);
    contents.add(content);
    return true;
  });
}
