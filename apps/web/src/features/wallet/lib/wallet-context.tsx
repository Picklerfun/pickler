"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { ConnectModal } from "../components/connect-modal";
import { injectedSigner } from "./injected-signer";
import { getProvider, TARGET_CHAIN } from "./provider";
import { signIn } from "./connect";
import { fromInjectedProvider } from "./signer-adapters";
import {
  adoptSession,
  dropWalletSession,
  heldBy,
  releases,
  type HeldSession,
} from "./wallet-session";
import { signInAs, type SignInResult } from "./wallet-sign-in";
import { getSupabase } from "@/features/auth/lib/supabase-browser";
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
type WalletStatus = "disconnected" | "connecting" | "connected";

/**
 * Whether there is an account behind the connection.
 *
 * Connecting and signing in are two things on purpose, and the chooser says so on itself:
 * "Connecting is not signing." Signing in costs a wallet prompt, so it happens when something
 * actually needs an account — claiming a handle, linking a second wallet — and never as a surprise
 * on top of connecting. A signature prompt nobody asked for is how people learn to approve
 * prompts without reading them.
 */
type SessionStatus = "none" | "signing" | "active";

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
  /** Whether this wallet has an account behind it yet. */
  session: SessionStatus;
  /** What went wrong signing in, in words for a screen, or null when nothing did. */
  sessionError: string | null;
  /**
   * Sign in with the connected wallet: one signature over a string the server built. Answers with
   * the access token, or with the error — null when the person simply closed the prompt, which is
   * an answer rather than a failure. A caller shows the error from this result: `sessionError` is
   * for whoever renders later, and is not yet set in the render the caller awaited from.
   */
  signInWithWallet: () => Promise<SignInResult>;
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
  const [signing, setSigning] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  // The session is kept with the address it was issued for, never as a bare token: see
  // wallet-session.ts. The ref is the same value for the callbacks that run outside a render.
  const [held, setHeld] = useState<HeldSession | null>(null);
  const heldRef = useRef<HeldSession | null>(null);
  // The account as of the last render, for telling a change of chain from a change of
  // address when the held session has no address of its own.
  const accountRef = useRef<SignerAccount | null>(null);
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

  const hold = useCallback((next: HeldSession | null) => {
    heldRef.current = next;
    setHeld(next);
  }, []);

  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  // A reload forgets what the page held, but not the browser's session. If that is a wallet
  // account's, hold it again, so that switching or disconnecting still signs the browser out.
  useEffect(() => {
    let live = true;
    const supabase = getSupabase();
    if (!supabase) {
      return;
    }
    void supabase.auth.getSession().then(
      ({ data }) => {
        // A sign-in that finished first is the better answer: it knows its address.
        if (live && !heldRef.current) {
          hold(adoptSession(data.session));
        }
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [hold]);

  /**
   * Lets go of the session unless it belongs to `next`: the token is forgotten and the browser is
   * signed out of it, so nothing done as the next wallet can go out under the last one's name.
   * A change of chain keeps the address, and so keeps the session.
   */
  const release = useCallback(
    (next: SignerAccount | null) => {
      const cached = heldRef.current;
      setSessionError(null);
      const previous = accountRef.current;
      const changed = releases(
        cached,
        previous && { address: previous.address, namespace: "eip155" },
        next && { address: next.address, namespace: "eip155" },
      );
      if (!cached || !changed) {
        return;
      }
      hold(null);
      // Best effort: the token is already forgotten here, which is what keeps it from being sent.
      void dropWalletSession(getSupabase(), cached).catch(() => {});
    },
    [hold],
  );

  // Follow the active signer when it changes underneath the page.
  useEffect(() => {
    if (!adapter?.subscribe) {
      return;
    }
    return adapter.subscribe((next) => {
      release(next);
      setAccount(next);
      if (!next) {
        setKind(null);
      }
    });
  }, [adapter, release]);

  const connectWith = useCallback(
    async (picked: SignerKind) => {
      const signer = SIGNERS.find((candidate) => candidate.kind === picked);
      if (!signer) {
        return;
      }
      setConnecting(true);
      setError(null);
      try {
        const connected = await signer.connect();
        if (connected) {
          release(connected);
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
    },
    [release],
  );

  const signInWithWallet = useCallback(async (): Promise<SignInResult> => {
    const provider = getProvider();
    setSigning(true);
    setSessionError(null);
    try {
      const { result, session } = await signInAs({
        cached: heldRef.current,
        signer:
          provider && account
            ? fromInjectedProvider(
                provider,
                account.address,
                account.chainId ?? TARGET_CHAIN.chainId,
              )
            : null,
        supabase: getSupabase(),
        signIn,
        now: new Date(),
      });
      if (session) {
        hold(session);
      }
      setSessionError("error" in result ? result.error : null);
      return result;
    } finally {
      setSigning(false);
    }
  }, [account, hold]);

  const connect = useCallback((held?: string) => {
    setHolding(held ?? null);
    setError(null);
    setChooserOpen(true);
  }, []);

  const disconnect = useCallback(async () => {
    // First, and whatever the wallet then answers: a disconnect that failed half-way must not
    // leave the last address's session behind.
    release(null);
    await adapter?.disconnect();
    setAccount(null);
    setKind(null);
    remember(null);
  }, [adapter, release]);

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
    // Derived from whose session is held, so it cannot say "active" for a wallet it was not
    // issued to.
    const session: SessionStatus = signing
      ? "signing"
      : heldBy(held, account && { address: account.address, namespace: "eip155" })
        ? "active"
        : "none";

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
      session,
      sessionError,
      signInWithWallet,
      connect,
      disconnect,
      switchChain,
    };
  }, [
    account,
    adapter,
    connect,
    connecting,
    disconnect,
    error,
    held,
    kind,
    sessionError,
    signInWithWallet,
    signing,
    switchChain,
  ]);

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
