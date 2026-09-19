"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import {
  getProvider,
  readAccounts,
  readBalance,
  readChainId,
  requestAccounts,
  revokeAccess,
  switchToTarget,
  TARGET_CHAIN,
} from "./provider";

/**
 * Who is connected, on which chain, and what they hold. One connection for the whole public site:
 * the nav shows it, the portfolio reads it, and the reads list is only meaningful with it.
 *
 * The site reconnects silently on load — `eth_accounts` never prompts — so someone who connected
 * yesterday does not have to do it again, and someone who never did is left alone.
 */

export type WalletStatus = "unsupported" | "disconnected" | "connecting" | "connected";

interface WalletState {
  status: WalletStatus;
  address: string | null;
  chainId: number | null;
  /** Native balance in wei. Null while unknown. */
  balance: bigint | null;
  onTargetChain: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  switchChain: () => Promise<void>;
}

const WalletContext = createContext<WalletState | null>(null);

/**
 * Whether this browser injects a wallet at all. Read through an external store rather than in an
 * effect: the server renders "no" and the browser answers for itself on the first paint.
 */
const subscribeToProvider = () => () => {};

export function WalletProvider({ children }: { children: ReactNode }) {
  const hasProvider = useSyncExternalStore(
    subscribeToProvider,
    () => getProvider() !== null,
    () => false,
  );
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read the wallet without prompting, then follow it: an account or chain change is the wallet
  // telling us the answer to "who is this" changed.
  useEffect(() => {
    const provider = getProvider();
    if (!provider) {
      return;
    }
    let live = true;
    const settle = async (accounts: string[]) => {
      if (!live) {
        return;
      }
      const next = accounts[0] ?? null;
      setAddress(next);
      setStatus(next ? "connected" : "disconnected");
      setChainId(await readChainId(provider));
      setBalance(next ? await readBalance(provider, next) : null);
    };
    void readAccounts(provider).then(settle);

    const onAccounts = (...args: never[]) => void settle((args[0] ?? []) as string[]);
    const onChain = () => void readAccounts(provider).then(settle);
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
    return () => {
      live = false;
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    const provider = getProvider();
    if (!provider) {
      setStatus("unsupported");
      return;
    }
    setStatus("connecting");
    setError(null);
    try {
      const accounts = await requestAccounts(provider);
      const next = accounts[0] ?? null;
      setAddress(next);
      setStatus(next ? "connected" : "disconnected");
      setChainId(await readChainId(provider));
      setBalance(next ? await readBalance(provider, next) : null);
    } catch (caught) {
      // 4001 is the person closing the prompt, which is an answer rather than a failure.
      const code = (caught as { code?: number }).code;
      setStatus("disconnected");
      setError(code === 4001 ? null : "That wallet could not connect. Try again.");
    }
  }, []);

  const disconnect = useCallback(async () => {
    const provider = getProvider();
    if (provider) {
      await revokeAccess(provider);
    }
    setAddress(null);
    setBalance(null);
    setStatus(provider ? "disconnected" : "unsupported");
  }, []);

  const switchChain = useCallback(async () => {
    const provider = getProvider();
    if (!provider) {
      return;
    }
    if (await switchToTarget(provider)) {
      setChainId(await readChainId(provider));
      if (address) {
        setBalance(await readBalance(provider, address));
      }
    }
  }, [address]);

  const value = useMemo<WalletState>(
    () => ({
      status: hasProvider ? status : "unsupported",
      address,
      chainId,
      balance,
      onTargetChain: chainId === TARGET_CHAIN.chainId,
      error,
      connect,
      disconnect,
      switchChain,
    }),
    [hasProvider, status, address, chainId, balance, error, connect, disconnect, switchChain],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const value = useContext(WalletContext);
  if (!value) {
    throw new Error("useWallet needs a WalletProvider above it");
  }
  return value;
}
