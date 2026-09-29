import {
  DEFAULT_CONFIG,
  DEFAULT_UNCERTAINTY_POLICY,
  MAX_SITES,
  type AgentBrief,
  type AgentConfig,
  type SpendLimits,
} from "../research/types.js";

const HOST = /^[a-z0-9.-]+\.[a-z]{2,}$/;
/** X profiles and posts are accounts, whatever the link looks like; web search does not read them. */
const X_HOST = /^(?:[a-z0-9-]+\.)?(?:x|twitter)\.com$/;

export type ReadKind = { kind: "site"; host: string } | { kind: "account" } | { kind: "feed" };

/**
 * One `reads` line (§3.4). A URL or a bare domain is a site the web search prefers. An X account
 * (an @handle or an x.com/twitter.com link) or a named feed is passed to the model as context only,
 * and the screen marks it "Soon", because nothing ingests X or arbitrary feeds yet.
 */
export function classifyRead(line: string): ReadKind {
  const text = line.trim();
  if (text.startsWith("@")) {
    return { kind: "account" };
  }
  let host = "";
  if (/^https?:\/\//i.test(text)) {
    try {
      host = new URL(text).hostname;
    } catch {
      return { kind: "feed" };
    }
  } else if (/^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(text)) {
    host = text.split("/")[0]!;
  }
  host = host.toLowerCase().replace(/^www\./, "");
  if (X_HOST.test(host)) {
    return { kind: "account" };
  }
  return HOST.test(host) ? { kind: "site", host } : { kind: "feed" };
}

/**
 * The config a brief runs on: `DEFAULT_CONFIG` plus the brief, its caps and its leverage. Sports is
 * the one market scope the runtime runs; paper trading is on so the adopted agent can trade on paper.
 */
export function briefToConfig(input: {
  brief: AgentBrief;
  spend: SpendLimits;
  maxLeverage: number;
}): AgentConfig {
  const sites = [
    ...new Set(
      input.brief.reads.flatMap((line) => {
        const read = classifyRead(line);
        return read.kind === "site" ? [read.host] : [];
      }),
    ),
  ].slice(0, MAX_SITES);
  // marketScope replaces the legacy category list; assertConfig refuses the two together.
  const defaults = { ...DEFAULT_CONFIG };
  delete defaults.categoryIds;
  return {
    ...defaults,
    tools: [...DEFAULT_CONFIG.tools],
    limits: { ...DEFAULT_CONFIG.limits },
    uncertaintyPolicy: { ...DEFAULT_UNCERTAINTY_POLICY },
    marketScope: { version: 1, category: "sports", subcategories: "all" },
    plugins: { version: 1, enabled: ["polymarket", "exa", "paper-trading"] },
    sources: {
      web: sites.length > 0 ? { mode: "prefer", sites } : { mode: "anywhere", sites: [] },
      books: [],
    },
    skills: [],
    brief: structuredClone(input.brief),
    spend: { perCallAusd: input.spend.perCallAusd, perDayAusd: input.spend.perDayAusd },
    maxLeverage: input.maxLeverage,
  };
}
