"use client";

import { MONAD_TESTNET } from "@pickler/chain";

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

export const getProvider = (): Eip1193Provider | null =>
  typeof window === "undefined" ? null : (window.ethereum ?? null);

/** The chain the testnet runs on. Anything else is a wallet pointed somewhere we do not read. */
export const TARGET_CHAIN = MONAD_TESTNET;

const hexChainId = `0x${TARGET_CHAIN.chainId.toString(16)}`;

/** Addresses the wallet already shares with this site. Never prompts. */
export async function readAccounts(provider: Eip1193Provider): Promise<string[]> {
  const accounts = await provider.request({ method: "eth_accounts" });
  return Array.isArray(accounts) ? (accounts as string[]) : [];
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

/**
 * Moves the wallet to the testnet, adding the network first if it does not know it. Wallets answer
 * 4902 for an unknown chain and 4001 when the person says no; neither is an error worth throwing.
 */
export async function switchToTarget(provider: Eip1193Provider): Promise<boolean> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId }],
    });
    return true;
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902) {
      return false;
    }
    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hexChainId,
            chainName: TARGET_CHAIN.name,
            nativeCurrency: { ...TARGET_CHAIN.nativeCurrency, name: TARGET_CHAIN.name },
            rpcUrls: [...TARGET_CHAIN.publicRpcUrls],
            blockExplorerUrls: [...TARGET_CHAIN.explorers],
          },
        ],
      });
      return true;
    } catch {
      return false;
    }
  }
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
