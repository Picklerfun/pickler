"use client";

import { MONAD_TESTNET } from "@pickler/chain";
import { selectedInjectedProvider } from "./injected-providers";
import { WalletRequestError, walletErrorCode } from "./wallet-request-error";

/**
 * The browser wallet, spoken to directly over EIP-1193. No connector library: the public site only
 * needs to know who is connected, on which chain, and what they hold, and every wallet that matters
 * injects this interface.
 *
 * Nothing here signs or sends a transaction. Connecting is a read: it tells the site which address
 * to show a portfolio and a read history for.
 */

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: never[]) => void): void;
  removeListener?(event: string, listener: (...args: never[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export const getProvider = (): Eip1193Provider | null => selectedInjectedProvider();

/** Extensions can inject after hydration. Wait briefly without asking for account permission. */
export function waitForProvider(signal?: AbortSignal): Promise<Eip1193Provider | null> {
  const available = getProvider();
  if (available || typeof window === "undefined" || signal?.aborted) {
    return Promise.resolve(signal?.aborted ? null : available);
  }
  return new Promise((resolve) => {
    const finish = (provider: Eip1193Provider | null) => {
      clearInterval(poll);
      clearTimeout(deadline);
      window.removeEventListener("ethereum#initialized", check);
      signal?.removeEventListener("abort", cancelled);
      resolve(provider);
    };
    const check = () => {
      const provider = getProvider();
      if (provider) {
        finish(provider);
      }
    };
    const cancelled = () => finish(null);
    const poll = setInterval(check, 100);
    const deadline = setTimeout(cancelled, 3_000);
    window.addEventListener("ethereum#initialized", check);
    signal?.addEventListener("abort", cancelled, { once: true });
    check();
  });
}

/** A silent wallet read must not leave reconnection waiting on an unreachable RPC. */
export function boundedWalletRead<T>(
  read: Promise<T>,
  fallback: T,
  signal?: AbortSignal,
  timeout = 3_000,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.resolve(fallback);
  }
  return new Promise((resolve) => {
    const finish = (value: T) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancelled);
      resolve(value);
    };
    const cancelled = () => finish(fallback);
    const timer = setTimeout(cancelled, timeout);
    signal?.addEventListener("abort", cancelled, { once: true });
    void read.then(finish, cancelled);
  });
}

/** The chain the testnet runs on. Anything else is a wallet pointed somewhere we do not read. */
export const TARGET_CHAIN = MONAD_TESTNET;

const hexChainId = `0x${TARGET_CHAIN.chainId.toString(16)}`;

/** Addresses the wallet already shares with this site. Never prompts. */
export async function readAccounts(provider: Eip1193Provider): Promise<string[]> {
  const accounts = await provider.request({ method: "eth_accounts" });
  return Array.isArray(accounts)
    ? accounts.filter(
        (account): account is string =>
          typeof account === "string" && /^0x[0-9a-f]{40}$/i.test(account),
      )
    : [];
}

/** Asks for access. This is the only call that opens the wallet. */
export async function requestAccounts(provider: Eip1193Provider): Promise<string[]> {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  return Array.isArray(accounts) ? (accounts as string[]) : [];
}

export async function readChainId(provider: Eip1193Provider): Promise<number | null> {
  const chainId = await provider.request({ method: "eth_chainId" });
  return typeof chainId === "string" ? Number.parseInt(chainId, 16) : null;
}

/** Native balance in wei. Returns null when the wallet refuses or the chain is unreachable. */
export async function readBalance(
  provider: Eip1193Provider,
  address: string,
): Promise<bigint | null> {
  try {
    const wei = await provider.request({ method: "eth_getBalance", params: [address, "latest"] });
    return typeof wei === "string" ? BigInt(wei) : null;
  } catch {
    return null;
  }
}

/** Adding a network is not switching it. Verify the actual chain before reporting success. */
export async function switchToTarget(provider: Eip1193Provider): Promise<boolean> {
  const change = async () => {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hexChainId }],
      });
    } catch (error) {
      throw new WalletRequestError(error, "wallet_switchEthereumChain");
    }
  };
  try {
    await change();
  } catch (error) {
    if (walletErrorCode(error) !== 4902) {
      throw error;
    }
    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hexChainId,
            chainName: TARGET_CHAIN.name,
            nativeCurrency: { ...TARGET_CHAIN.nativeCurrency, name: "MON" },
            rpcUrls: [...TARGET_CHAIN.publicRpcUrls],
            blockExplorerUrls: [...TARGET_CHAIN.explorers],
          },
        ],
      });
    } catch (error) {
      throw new WalletRequestError(error, "wallet_addEthereumChain");
    }
    await change();
  }
  for (let read = 0; read < 10; read += 1) {
    try {
      if (
        (await boundedWalletRead(readChainId(provider), null, undefined, 1000)) ===
        TARGET_CHAIN.chainId
      ) {
        return true;
      }
    } catch (error) {
      throw new WalletRequestError(error, "eth_chainId");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new WalletRequestError(new Error("Network did not change"), "wallet_switchEthereumChain");
}

/**
 * Drops this site's access where the wallet supports it. EIP-1193 has no disconnect, so the site
 * also forgets the address on its own side; a wallet that does not implement revoke simply stays
 * connected until the person disconnects it there.
 */
export async function revokeAccess(provider: Eip1193Provider): Promise<void> {
  try {
    await provider.request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch {
    // Not supported by this wallet; forgetting the address locally is all we can do.
  }
}

/** Short form for a nav chip: 0x7f3a…c21e. */
export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** Wei to a human balance, trimmed to four decimals and never rounded up into a lie. */
export function formatBalance(wei: bigint, decimals = TARGET_CHAIN.nativeCurrency.decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = wei / base;
  const fraction = ((wei % base) * 10_000n) / base;
  const padded = fraction.toString().padStart(4, "0").replace(/0+$/, "");
  return padded ? `${whole.toLocaleString("en-US")}.${padded}` : whole.toLocaleString("en-US");
}
