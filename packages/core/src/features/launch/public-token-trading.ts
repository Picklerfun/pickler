/** Non-custodial public curve trading. Only the visitor's wallet signs or submits. */
import {
  tokenTradeMinimumOutput,
  type TokenTradeInput,
  type TokenTradeQuote,
} from "./token-operations.js";
export interface PublicTokenTradeInput extends TokenTradeInput {
  wallet: string;
  side: "buy" | "sell";
}
export interface PublicTokenTradeContext {
  agentId: string;
  token: string;
  chainId: number;
}
export interface PublicTokenTransaction {
  from: string;
  to: string;
  data: string;
  value: "0x0";
  chainId: 10143;
  nonce: number;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}
export interface PublicTokenTradePrepared {
  version: 1;
  token: string;
  curve: string;
  quoteToken: string;
  expiresAt: string;
  quote: TokenTradeQuote;
  transaction: PublicTokenTransaction;
}
export class PublicTokenTradeError extends Error {
  constructor(
    public readonly code:
      | "TRADING_UNAVAILABLE"
      | "INVALID_TRADE"
      | "TOKEN_NOT_FOUND"
      | "RPC_LIMIT"
      | "INSUFFICIENT_GAS"
      | "DEPLOYMENT_CHANGED"
      | "PROVIDER_UNAVAILABLE",
  ) {
    super(code);
  }
}
export interface PublicTokenTradeDriver {
  prepare(
    context: PublicTokenTradeContext,
    input: PublicTokenTradeInput,
  ): Promise<PublicTokenTradePrepared>;
}
export function createPublicTokenTrading(deps: {
  enabled: boolean;
  token(handle: string): Promise<PublicTokenTradeContext | null>;
  driver?: PublicTokenTradeDriver;
}) {
  return {
    async prepare(handle: string, input: PublicTokenTradeInput) {
      if (!deps.enabled || !deps.driver) {
        throw new PublicTokenTradeError("TRADING_UNAVAILABLE");
      }
      if (
        !/^[a-z0-9_]{3,15}$/.test(handle) ||
        !/^0x[0-9a-f]{40}$/i.test(input.wallet) ||
        /^0x0+$/.test(input.wallet) ||
        !/^[1-9][0-9]{0,77}$/.test(input.amount) ||
        BigInt(input.amount) >= 2n ** 256n ||
        !["buy", "sell"].includes(input.side)
      ) {
        throw new PublicTokenTradeError("INVALID_TRADE");
      }
      tokenTradeMinimumOutput(1n, input.slippageBps);
      const context = await deps.token(handle);
      if (!context || context.chainId !== 10143) {
        throw new PublicTokenTradeError("TOKEN_NOT_FOUND");
      }
      return deps.driver.prepare(context, input);
    },
  };
}
