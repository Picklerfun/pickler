// Balances for one address on Monad. Values that cannot be read come back null: the interface
// says "unavailable" rather than showing a zero that looks like an empty wallet. Two plain
// JSON-RPC calls rather than a viem client, so an injected fetch exercises the production path.

import { AUSD, networkByChainId, requireSupportedChain } from "@pickler/chain";

export interface Balance {
  symbol: string;
  decimals: number;
  /** Base units as a decimal string, or null when the chain could not be read. */
  raw: string | null;
}

export interface Balances {
  native: Balance;
  token: Balance;
}

export interface BalanceReaderConfig {
  chainId: number;
  rpcUrl?: string;
  fetch?: typeof fetch;
}

/** `balanceOf(address)`. The argument is the address, left-padded to 32 bytes. */
const BALANCE_OF = "0x70a08231";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * A JSON-RPC hex quantity or byte string. Anything else — an absent field, an empty string, a
 * bare "0x" from empty returndata — is an unread value, not a zero balance. `BigInt("")` is `0n`,
 * so a looser check here would publish "nothing was returned" as "this wallet holds nothing".
 */
const HEX_RESULT_PATTERN = /^0x[0-9a-fA-F]+$/;

const RPC_TIMEOUT_MS = 5_000;

/** The subset of a JSON-RPC response this reader depends on. */
interface JsonRpcResponse {
  result?: unknown;
  error?: { code?: number; message?: string };
}

export function createBalanceReader(config: BalanceReaderConfig) {
  const chainId = requireSupportedChain(config.chainId);
  const network = networkByChainId(chainId)!;
  const token = AUSD[chainId];
  // Non-null: requireSupportedChain has already established a known network, and every network
  // in @pickler/chain lists at least one public endpoint.
  const url = config.rpcUrl ?? network.publicRpcUrls[0]!;
  const doFetch = config.fetch ?? fetch;

  async function rpc(method: string, params: unknown[]): Promise<string> {
    const response = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      redirect: "manual",
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`${method} failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as JsonRpcResponse;

    if (typeof payload.result !== "string" || !HEX_RESULT_PATTERN.test(payload.result)) {
      throw new Error(payload.error?.message ?? `${method} returned no result`);
    }

    return payload.result;
  }

  /** A read that failed is null. A read that succeeded is its value, including zero. */
  function baseUnits(settled: PromiseSettledResult<string>): string | null {
    if (settled.status !== "fulfilled") {
      return null;
    }
    return BigInt(settled.value).toString();
  }

  return {
    async read(address: string): Promise<Balances> {
      if (!ADDRESS_PATTERN.test(address)) {
        throw new Error(`${address} is not an address`);
      }

      const owner = address.slice(2).toLowerCase().padStart(64, "0");

      // Settled, not Promise.all: a token read that fails must not erase a native read that
      // succeeded, and awaiting both leaves no request in flight once the handler returns.
      const [native, held] = await Promise.allSettled([
        rpc("eth_getBalance", [address, "latest"]),
        rpc("eth_call", [{ to: token.address, data: `${BALANCE_OF}${owner}` }, "latest"]),
      ]);

      return {
        native: {
          symbol: network.nativeCurrency.symbol,
          decimals: network.nativeCurrency.decimals,
          raw: baseUnits(native),
        },
        token: { symbol: token.symbol, decimals: token.decimals, raw: baseUnits(held) },
      };
    },
  };
}
