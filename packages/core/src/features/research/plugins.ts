import { PilotError, type AgentConfig, type ToolName } from "./types.js";

export const PLUGIN_IDS = [
  "polymarket",
  "exa",
  "balldontlie",
  "the-odds-api",
  "paper-trading",
  "polymarket-trading",
  "perpl",
  "perps-paper",
] as const;
export type PluginId = (typeof PLUGIN_IDS)[number];
export type PluginConfig = { version: 1; enabled: PluginId[] };
export const TOOL_PLUGIN: Record<ToolName, PluginId> = {
  getPerpFundingHistory: "perpl",
  listPerpMarkets: "perpl",
  getPerpSnapshot: "perpl",
  getPerpOrderBook: "perpl",
  getPerpCandles: "perpl",
  searchWeb: "exa",
  readPage: "exa",
  getMarketRules: "polymarket",
  getOrderBook: "polymarket",
  getSportsContext: "balldontlie",
  getExternalOdds: "the-odds-api",
};
export const PLUGINS = PLUGIN_IDS.map((id) => ({
  id,
  version: id === "paper-trading" || id === "perpl" || id === "perps-paper" ? "1.1.0" : "1.0.0",
  coverage:
    id === "perps-paper"
      ? ["perps-paper-v1"]
      : id === "perpl"
        ? ["perps-data-v1"]
        : id === "balldontlie" || id === "the-odds-api"
          ? ["nfl-winner-v1"]
          : ["all"],
  credentialVariables:
    id === "exa"
      ? ["EXA_API_KEY"]
      : id === "balldontlie"
        ? ["BALLDONTLIE_API_KEY"]
        : id === "the-odds-api"
          ? ["THE_ODDS_API_KEY"]
          : [],
  limits:
    id === "balldontlie"
      ? { requestsPerRun: 6, requestsPerMinute: 5 }
      : id === "the-odds-api"
        ? { requestsPerRun: 2, monthlyCredits: 500 }
        : {},
  tools: Object.entries(TOOL_PLUGIN)
    .filter(([, owner]) => owner === id)
    .map(([tool]) => tool as ToolName),
}));

/** Legacy documents retain exactly their original tool permissions. */
export function effectivePlugins(config: AgentConfig): PluginConfig {
  return (
    config.plugins ?? {
      version: 1,
      enabled: (["exa", "polymarket"] as PluginId[]).filter((id) =>
        config.tools.some((tool) => TOOL_PLUGIN[tool] === id),
      ),
    }
  );
}
export function pluginEnabled(config: AgentConfig, id: PluginId): boolean {
  return effectivePlugins(config).enabled.includes(id);
}
export function toolEnabled(config: AgentConfig, tool: ToolName): boolean {
  return config.tools.includes(tool) && pluginEnabled(config, TOOL_PLUGIN[tool]);
}
export function requireTool(config: AgentConfig, tool: ToolName): void {
  if (!pluginEnabled(config, TOOL_PLUGIN[tool])) {
    throw new PilotError("PLUGIN_DISABLED", "Required plugin is disabled");
  }
  if (!config.tools.includes(tool)) {
    throw new PilotError("TOOL_DISABLED", "Required tool is disabled");
  }
}
