import { PilotError, type AgentRecord, type Scope } from "../research/types.js";
import { requireTool } from "../research/plugins.js";
import {
  PERP_RESOLUTIONS,
  type PerpMarketData,
  type PerplConfig,
  type PerpReadContext,
  type PerpReadTools,
  type PerpSymbol,
  type PerpTool,
} from "./types.js";

export function assertPerplConfig(config: PerplConfig): void {
  if (
    config.version !== 1 ||
    !["mainnet", "testnet"].includes(config.network) ||
    !Array.isArray(config.markets) ||
    config.markets.length === 0 ||
    config.markets.length > 2 ||
    config.markets.some((symbol) => symbol !== "BTC" && symbol !== "ETH") ||
    new Set(config.markets).size !== config.markets.length
  ) {
    throw new PilotError("INVALID_INPUT", "Invalid Perpl configuration");
  }
}

/** A scoped read session pins configuration; no prediction-market selection or model is involved. */
export function createPerpReadService(deps: {
  repository: { agent(scope: Scope): Promise<AgentRecord> };
  data: PerpMarketData;
}) {
  return async (scope: Scope, signal: AbortSignal): Promise<PerpReadTools> => {
    const initial = await deps.repository.agent(scope);
    if (initial.id !== scope.agentId || initial.tenantId !== scope.tenantId) {
      throw new PilotError("FORBIDDEN", "Agent scope does not match");
    }
    const initialVersion = initial.version;
    const config = initial.config.perpl;
    if (!config) {
      throw new PilotError("PLUGIN_NOT_CONFIGURED", "Configure Perpl for this agent");
    }
    assertPerplConfig(config);
    const frozen = structuredClone(config);
    async function read<T>(
      tool: PerpTool,
      symbol: PerpSymbol | undefined,
      run: (context: PerpReadContext) => Promise<T>,
    ): Promise<T> {
      const guard = async () => {
        signal.throwIfAborted();
        const current = await deps.repository.agent(scope);
        if (current.id !== scope.agentId || current.tenantId !== scope.tenantId) {
          throw new PilotError("FORBIDDEN", "Agent scope does not match");
        }
        if (
          current.version !== initialVersion ||
          JSON.stringify(current.config.perpl) !== JSON.stringify(frozen)
        ) {
          throw new PilotError(
            "CONFIG_CHANGED",
            "Agent configuration changed during the read session",
          );
        }
        requireTool(current.config, tool);
        if (symbol !== undefined && !frozen.markets.includes(symbol)) {
          throw new PilotError("MARKET_NOT_ALLOWED", "Perpetual is not enabled for this agent");
        }
      };
      await guard();
      const result = await run({ guard, signal });
      await guard();
      return result;
    }
    return {
      listPerpMarkets: () =>
        read("listPerpMarkets", undefined, (ctx) =>
          deps.data.list(frozen.network, frozen.markets, ctx),
        ),
      getPerpSnapshot: ({ symbol }) =>
        read("getPerpSnapshot", symbol, (ctx) => deps.data.snapshot(frozen.network, symbol, ctx)),
      getPerpOrderBook: ({ symbol, levels = 20 }) => {
        if (!Number.isInteger(levels) || levels < 1 || levels > 100) {
          throw new PilotError("INVALID_INPUT", "Book depth must be between 1 and 100");
        }
        return read("getPerpOrderBook", symbol, (ctx) =>
          deps.data.book(frozen.network, symbol, levels, ctx),
        );
      },
      getPerpCandles: (input) => {
        const { resolution, from, to } = input;
        if (
          !(PERP_RESOLUTIONS as readonly number[]).includes(resolution) ||
          !Number.isSafeInteger(from) ||
          !Number.isSafeInteger(to) ||
          from < 0 ||
          to <= from ||
          from % (resolution * 1000) !== 0 ||
          to % (resolution * 1000) !== 0 ||
          (to - from) / (resolution * 1000) > 1024
        ) {
          throw new PilotError(
            "INVALID_INPUT",
            "Use an aligned candle range of at most 1024 intervals",
          );
        }
        return read("getPerpCandles", input.symbol, (ctx) =>
          deps.data.candles(frozen.network, input, ctx),
        );
      },
    };
  };
}
