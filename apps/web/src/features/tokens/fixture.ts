/** Local-only identity with generated reference economics. Never fallback for a live agent. */
import type { AgentPersonaDto, AgentTokenDto, TokenStateDto } from "@pickler/api-schema";
import reference from "./reference-economics.json";
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
    masterAddress: "0x5555555555555555555555555555555555555555",
    confirmation: launched ? "confirmed" : "absent",
    available: false,
    launchVenue: { name: "uniswap_v4", lpFeeBps: 100 },
    venue: launched
      ? {
          status: "uniswap_v4",
          market: "0x3333333333333333333333333333333333333333",
          vault: "0x4444444444444444444444444444444444444444",
          accountId: null,
          poolId: "0x" + "a".repeat(64),
          lpFeeBps: 100,
          positions: ["1"],
          liquidityLocked: true,
        }
      : null,
    fees: launched
      ? { ausd: "1250000", agent: "2000000000000000000", block: 100, scope: "master_wallet" }
      : null,
    blockers: privateAgent
      ? ["GO_PUBLIC_FIRST", "LAUNCH_UNAVAILABLE"]
      : launched
        ? ["TOKEN_ALREADY_LAUNCHED", "LAUNCH_UNAVAILABLE"]
        : ["LAUNCH_UNAVAILABLE"],
    draft: {
      id: "11111111-1111-4111-8111-111111111111",
      version: 1,
      name: "Halftime",
      ticker: "HALF",
      status: "draft",
    },
    token: launched ? PREVIEW_TOKEN : null,
    preset: null,
    economics: reference as NonNullable<TokenStateDto["economics"]>,
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
    id: "11111111-1111-4111-8111-111111111111",
    advicePrice: null,
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
