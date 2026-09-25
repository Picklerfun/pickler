// ERC-20 reads and calldata over plain JSON-RPC. No viem client: an injected fetch or Rpc runs the
// same code path as production, and nothing here signs or holds a key.

import { AUSD, networkByChainId, requireSupportedChain } from "@pickler/chain";

export interface Rpc {
  call(method: string, params: unknown[]): Promise<unknown>;
}

/** The subset of a JSON-RPC response this client depends on. */
interface JsonRpcResponse {
  result?: unknown;
  error?: { code?: number; message?: string };
}

const RPC_TIMEOUT_MS = 10_000;

/** `balanceOf(address)` and `transfer(address,uint256)` selectors. */
const BALANCE_OF = "0x70a08231";
const TRANSFER = "0xa9059cbb";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * A hex quantity with at least one digit. A bare "0x" (empty returndata) or anything else is an
 * unread value: `BigInt("0x")` would throw, but `BigInt("")` is `0n`, and an unread balance must
 * never be shown as an empty wallet.
 */
const HEX_RESULT_PATTERN = /^0x[0-9a-fA-F]+$/;

export function createJsonRpc(url: string, call: typeof fetch = fetch): Rpc {
  return {
    async call(method, params) {
      const response = await call(url, {
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

      if (payload.error) {
        throw new Error(payload.error.message ?? `${method} failed`);
      }

      return payload.result;
    },
  };
}

function assertAddress(value: string): void {
  if (!ADDRESS_PATTERN.test(value)) {
    throw new Error(`${value} is not an address`);
  }
}

const pad = (hex: string) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");

/** The token balance of `owner` in base units. Throws when the chain returns no quantity. */
export async function erc20Balance(rpc: Rpc, token: string, owner: string): Promise<bigint> {
  assertAddress(owner);

  const data = BALANCE_OF + pad(owner);
  const result = await rpc.call("eth_call", [{ to: token, data }, "latest"]);

  if (typeof result !== "string" || !HEX_RESULT_PATTERN.test(result)) {
    throw new Error("balanceOf returned no result");
  }

  return BigInt(result);
}

/** `transfer(to, amount)` calldata. */
export function transferCalldata(to: string, amount: bigint): string {
  assertAddress(to);

  if (amount < 0n) {
    throw new Error("A transfer amount cannot be negative");
  }

  return TRANSFER + pad(to) + amount.toString(16).padStart(64, "0");
}

/** A display figure from base units; 6 decimals for AUSD. Floors, never rounds up. */
export function toDisplay(units: bigint, decimals: number): number {
  const scale = 10n ** BigInt(decimals);
  const whole = units / scale;
  const fraction = units % scale;

  return Number(whole) + Number(fraction) / 10 ** decimals;
}

export interface TokenBalanceReader {
  /** The display balance. A read that fails throws; it is never reported as zero. */
  read(address: string): Promise<number>;
  /** Drops the cached value, e.g. after a deposit is broadcast. */
  forget(address: string): void;
}

/** One token's balances, cached per lowercased address for `ttlMs`. Failures are not cached. */
export function createTokenBalanceReader(
  rpc: Rpc,
  token: string,
  decimals: number,
  ttlMs = 15_000,
  clock: () => number = Date.now,
): TokenBalanceReader {
  const cache = new Map<string, { at: number; value: number }>();

  return {
    async read(address) {
      const key = address.toLowerCase();
      const cached = cache.get(key);

      if (cached && clock() - cached.at < ttlMs) {
        return cached.value;
      }

      const value = toDisplay(await erc20Balance(rpc, token, address), decimals);
      cache.set(key, { at: clock(), value });

      return value;
    },
    forget(address) {
      cache.delete(address.toLowerCase());
    },
  };
}

export interface AusdBalanceReaderConfig {
  chainId: number;
  /** Absent means the network's first public endpoint (Monad testnet's for chain 10143). */
  rpcUrl?: string;
  fetch?: typeof fetch;
}

/** AUSD balances on a supported chain. An unsupported chain id throws at composition. */
export function createAusdBalanceReader(config: AusdBalanceReaderConfig): TokenBalanceReader {
  const chainId = requireSupportedChain(config.chainId);
  // Non-null: requireSupportedChain established a known network, and each lists a public endpoint.
  const url = config.rpcUrl ?? networkByChainId(chainId)!.publicRpcUrls[0]!;
  const token = AUSD[chainId];
  return createTokenBalanceReader(createJsonRpc(url, config.fetch), token.address, token.decimals);
}
