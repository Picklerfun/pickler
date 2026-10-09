/** Local-only decoration and demo economics; never fallback data for a live agent. */
import type { AgentPersonaDto, AgentTokenDto, TokenStateDto } from "@pickler/api-schema";
export const PREVIEW_TOKEN: AgentTokenDto = {
  name: "Halftime",
  ticker: "HALF",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 10143,
  imageUri: null,
  avatar: { accent: "lime", pattern: 0 },
};
export function tokenPreview(launched = false, privateAgent = false): TokenStateDto {
  return {
    chainId: 10143,
    confirmation: launched ? "confirmed" : "absent",
    available: !privateAgent,
    blockers: privateAgent ? ["GO_PUBLIC_FIRST"] : launched ? ["TOKEN_ALREADY_LAUNCHED"] : [],
    draft: {
      id: "11111111-1111-4111-8111-111111111111",
      version: 1,
      name: "Halftime",
      ticker: "HALF",
      status: "draft",
    },
    token: launched ? PREVIEW_TOKEN : null,
    preset: {
      id: 1,
      version: 1,
      configHash: `0x${"1".repeat(64)}`,
      quoteAddress: "0x2222222222222222222222222222222222222222",
      totalSupply: "1000000000000000000000",
      saleAllocation: "800000000000000000000",
      lpAllocation: "200000000000000000000",
      buyFeeBps: 100,
      sellFeeBps: 100,
      launchFee: "0",
      protocolShareBps: 5000,
      lpCreatorShareBps: 5000,
    },
  };
}
export function tokenProfilePreview(
  nodeEnv: string | undefined,
  handle: string,
  stage: string | undefined,
): AgentPersonaDto | null {
  if (
    nodeEnv === "production" ||
    handle !== "halftime" ||
    !["token-empty", "token-launched"].includes(stage ?? "")
  ) {
    return null;
  }
  const launched = stage === "token-launched";
  return {
    name: "Halftime",
    handle: "halftime",
    ticker: launched ? "$HALF" : null,
    slug: launched ? "half" : null,
    accent: "lime",
    beat: "Perpetual markets",
    venue: "perps",
    vibe: "Analyst",
    voice: "Analyst",
    blurb: "A controlled local profile preview.",
    xHandle: null,
    creatorHandle: null,
    calibrationGap: null,
    resolved: 0,
    hitRate: null,
    net: 0,
    openPicks: 0,
    aliveDays: 1,
    marketCap: null,
    stage: launched ? "pre-graduation" : null,
    meters: [],
    decides: "Follows its selected markets and trading brief.",
    wrong: "",
    askPrice: null,
    answers: [],
    decisions: [],
    score: null,
    service: null,
    reads: [],
    launchedToken: launched ? PREVIEW_TOKEN : null,
  };
}
