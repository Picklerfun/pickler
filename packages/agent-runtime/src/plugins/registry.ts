import { PLUGINS, type PluginId, type ResearchTools } from "@pickler/core";
import * as polymarket from "./polymarket/index.js";
import * as exa from "./exa/index.js";
import * as balldontlie from "./balldontlie/index.js";
import * as odds from "./the-odds-api/index.js";
import * as paper from "./paper-trading/index.js";
import * as trading from "./polymarket-trading/index.js";
import * as perpl from "./perpl/index.js";
import * as perpsPaper from "./perps-paper/index.js";
/** Factories bind the core catalog to reviewed code, without changing capabilities. */
export const pluginFactories = {
  polymarket,
  exa,
  balldontlie,
  "the-odds-api": odds,
  "paper-trading": paper,
  "polymarket-trading": trading,
  perpl,
  "perps-paper": perpsPaper,
} satisfies Record<PluginId, unknown>;
export const plugins = PLUGINS.map((plugin) => ({
  ...plugin,
  connectionCheck: `/agents/:id/plugins/${plugin.id}/check`,
}));
export function buildTools(capabilities: Partial<ResearchTools>) {
  return Object.assign(
    {},
    ...Object.values(pluginFactories).map((factory) =>
      "buildResearchTools" in factory ? factory.buildResearchTools(capabilities) : {},
    ),
  );
}
