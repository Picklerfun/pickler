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
import { ConnectModal } from "../components/connect-modal";
import { injectedSigner } from "./injected-signer";
import { TARGET_CHAIN } from "./provider";
import type { SignerAccount, SignerAdapter, SignerKind } from "./signer";

/**
 * Who is connected, with what, on which chain, and what they hold. One connection for the whole
 * public site: the nav shows it, the portfolio reads it, and the reads list is only meaningful
 * with it.
 *
 * The connection is a wallet the person brought. Their own Pickler wallet is not connected here at
 * all: it is custodied in Turnkey and reached through the signing API, so nothing on this page ever
 * holds a key. Which address is connected stays visible — the page never shows an empty portfolio
 * without saying whose it is.
 *
 * Asking to connect opens the chooser rather than prompting a wallet directly. A page that wanted
 * something first says so, and the chooser holds it up while the person picks, the way the app
 * does.
 */

/**
 * There is no "unsupported" any more. A browser with nothing to connect still opens the chooser,
 * which names what is missing rather than presenting a dead button.
 */
export type WalletStatus = "disconnected" | "connecting" | "connected";

const SIGNERS: SignerAdapter[] = [injectedSigner];

const REMEMBERED = "pk.wallet.kind";

/** The last signer this browser used, so the chooser opens on it. Absent in a private window. */
function remember(kind: SignerKind | null) {
  try {
    if (kind) {
      window.localStorage.setItem(REMEMBERED, kind);
    } else {
      window.localStorage.removeItem(REMEMBERED);
    }
  } catch {
    // A browser that refuses storage just forgets between visits.
  }
}

function remembered(): SignerKind | null {
  try {
    const value = window.localStorage.getItem(REMEMBERED);
    return value === "injected" ? value : null;
  } catch {
    return null;
  }
}

const subscribeToBrowser = () => () => {};
const inBrowser = () => true;
const onServer = () => false;

export interface WalletChoice {
  kind: SignerKind;
  /** Why it cannot be picked here, or null when it can. */
  unavailable: string | null;
  /** A caveat worth reading before picking it. Does not stop it being picked. */
  note: string | null;
  /** The one this browser used last. */
  last: boolean;
}

interface WalletState {
  status: WalletStatus;
  /** What is connected, or null when nothing is. */
  kind: SignerKind | null;
  address: string | null;
  chainId: number | null;
  /** Native balance in wei. Null while unknown. */
  balance: bigint | null;
  /** True when nothing about the chain is in the way — always true for a signer without one. */
  onTargetChain: boolean;
  /** Whether this signer can be moved to another chain at all. */
  canSwitchChain: boolean;
  error: string | null;
  /**
   * Opens the chooser. `holding` is what the person was about to do, shown while they pick so the
   * action they came for is not lost behind the wallet.
   */
  connect: (holding?: string) => void;
  disconnect: () => Promise<void>;
  switchChain: () => Promise<void>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<SignerKind | null>(null);
  const [account, setAccount] = useState<SignerAccount | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [holding, setHolding] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  // Which signers exist is a question only the browser can answer. Read through an external store
  // rather than an effect: the server renders "not yet" and the browser answers on the first paint.
  const mounted = useSyncExternalStore(subscribeToBrowser, inBrowser, onServer);

  const adapter = useMemo(() => SIGNERS.find((signer) => signer.kind === kind) ?? null, [kind]);

  // Pick up a connection that is already there, without prompting anyone.
  useEffect(() => {
    let live = true;
    const wanted = remembered();
    if (wanted === null) {
      // Anything this build no longer knows how to connect — the retired passkey account — would
      // otherwise sit in storage for ever, claiming to be the last one used.
      remember(null);
    }
    const signer = SIGNERS.find((candidate) => candidate.kind === (wanted ?? "injected"));
    if (!signer) {
      return;
    }
    void signer.resume().then((resumed) => {
      if (live && resumed) {
        setKind(signer.kind);
        setAccount(resumed);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  // Follow the active signer when it changes underneath the page.
  useEffect(() => {
    if (!adapter?.subscribe) {
      return;
    }
    return adapter.subscribe((next) => {
      setAccount(next);
      if (!next) {
        setKind(null);
      }
    });
  }, [adapter]);

  const connectWith = useCallback(async (picked: SignerKind) => {
    const signer = SIGNERS.find((candidate) => candidate.kind === picked);
    if (!signer) {
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const connected = await signer.connect();
      if (connected) {
        setKind(picked);
        setAccount(connected);
        remember(picked);
        setChooserOpen(false);
        setHolding(null);
      }
    } catch (caught) {
      // 4001 is the person closing the prompt, which is an answer rather than a failure.
      const code = (caught as { code?: number }).code;
      setError(code === 4001 ? null : "That wallet could not connect. Try again.");
    } finally {
      setConnecting(false);
    }
  }, []);

  const connect = useCallback((held?: string) => {
    setHolding(held ?? null);
    setError(null);
    setChooserOpen(true);
  }, []);

  const disconnect = useCallback(async () => {
    await adapter?.disconnect();
    setAccount(null);
    setKind(null);
    remember(null);
  }, [adapter]);

  const switchChain = useCallback(async () => {
    const switched = await adapter?.switchChain?.();
    if (switched) {
      setAccount(switched);
    }
  }, [adapter]);

  const choices = useMemo<WalletChoice[]>(() => {
    const last = mounted ? remembered() : null;
    return SIGNERS.map((signer) => ({
      kind: signer.kind,
      unavailable: mounted ? signer.unavailableReason() : "Checking this browser…",
      note: mounted ? (signer.note?.() ?? null) : null,
      last: signer.kind === last,
    }));
  }, [mounted]);

  const value = useMemo<WalletState>(() => {
    const status: WalletStatus = account ? "connected" : connecting ? "connecting" : "disconnected";

    return {
      status,
      kind,
      address: account?.address ?? null,
      chainId: account?.chainId ?? null,
      balance: account?.balance ?? null,
      // A signer without a chain of its own is never on the wrong one.
      onTargetChain: account?.chainId == null || account.chainId === TARGET_CHAIN.chainId,
      canSwitchChain: adapter?.switchChain !== undefined,
      error,
      connect,
      disconnect,
      switchChain,
    };
  }, [account, adapter, connect, connecting, disconnect, error, kind, switchChain]);

  return (
    <WalletContext.Provider value={value}>
      {children}
      <ConnectModal
        open={chooserOpen}
        choices={choices}
        holding={holding}
        connecting={connecting}
        error={error}
        onPick={(picked) => void connectWith(picked)}
        onClose={() => setChooserOpen(false)}
      />
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const value = useContext(WalletContext);
  if (!value) {
    throw new Error("useWallet needs a WalletProvider above it");
  }
  return value;
}
