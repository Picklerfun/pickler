import { PilotError, type AgentConfig, type ToolName } from "./types.js";

export const PLUGIN_IDS = [
  "polymarket",
  "exa",
  "balldontlie",
  "the-odds-api",
  "paper-trading",
] as const;
export type PluginId = (typeof PLUGIN_IDS)[number];
export type PluginConfig = { version: 1; enabled: PluginId[] };
export const TOOL_PLUGIN: Record<ToolName, PluginId> = {
  searchWeb: "exa",
  readPage: "exa",
  getMarketRules: "polymarket",
  getOrderBook: "polymarket",
  getSportsContext: "balldontlie",
  getExternalOdds: "the-odds-api",
};
export const PLUGINS = PLUGIN_IDS.map((id) => ({
  id,
  version: "1.0.0",
  coverage: id === "balldontlie" || id === "the-odds-api" ? ["nfl-winner-v1"] : ["all"],
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
