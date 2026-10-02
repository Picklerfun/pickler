"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { ConnectModal } from "../components/connect-modal";
import { CLOSED, connectFlow, type ConnectFlowState, type ConnectStep } from "./connect-flow";
import { readProfile } from "./handles";
import { injectedSigner } from "./injected-signer";
import { PrfUnavailableError } from "./mera-ceremony";
import { meraSigner } from "./mera-signer";
import { getProvider, TARGET_CHAIN } from "./provider";
import { signIn, type ConnectResult, type Signer } from "./connect";
import { joinWords, signInWords } from "./sign-in-words";
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
import type { ConnectMode, SignerAccount, SignerAdapter, SignerKind } from "./signer";

/**
 * Who is connected, with what, on which chain, and what they hold. One connection for the whole
 * public site: the nav shows it, the portfolio reads it, and the reads list is only meaningful
 * with it.
 *
 * The connection is one of the marketplace's two wallets: the Mera passkey wallet, which is the
 * same account as in the mobile app, or a browser wallet the person brought. The studio's Turnkey
 * wallet is never connected here: it belongs to another product, on another host, and nothing in
 * this feature knows it exists. Which address is connected stays visible — the page never shows
 * an empty portfolio without saying whose it is.
 *
 * Asking to connect opens the chooser rather than prompting a wallet directly. A page that wanted
 * something first says so, and the chooser holds it up while the person picks, the way the app
 * does. The chooser then goes on: connecting signs in, and an account with no username is asked
 * for one, whichever wallet it came with (docs/specs/mera-web-v1.md §3).
 */

/**
 * There is no "unsupported" any more. A browser with nothing to connect still opens the chooser,
 * which names what is missing rather than presenting a dead button.
 */
type WalletStatus = "disconnected" | "connecting" | "connected";

/**
 * Whether there is an account behind the connection.
 *
 * Connecting and signing in are two things, and the chooser does both in order. The passkey
 * wallet signs in inside the ceremony that connects it, so the person is asked for their passkey
 * once. A browser wallet signs in as the chooser's next step, behind its own button and with the
 * reason on it, never as a prompt that appears by itself: a signature nobody asked for is how
 * people learn to approve prompts without reading them.
 */
type SessionStatus = "none" | "signing" | "active";

// The passkey wallet first: it is the marketplace's own. Two signers, and never a third.
const SIGNERS: SignerAdapter[] = [meraSigner, injectedSigner];

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
    return value === "injected" || value === "mera" ? value : null;
  } catch {
    return null;
  }
}

const subscribeToBrowser = () => () => {};
const inBrowser = () => true;
const onServer = () => false;

/** What signing in answered, and whether that account has a username (null: not known). */
interface Kept {
  result: SignInResult;
  profile: boolean | null;
  /** The account's username, when a session was just issued and its profile was read. */
  handle: string | null;
}

/** How long a new session waits for the last one's sign-out before going ahead anyway. */
const RELEASE_WAIT_MS = 3_000;

/** An address for the chooser's steps when the design harness opens them without a wallet. */
const PREVIEW_ADDRESS = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";

const PREVIEW_STEPS: readonly ConnectStep[] = [
  "choose",
  "signin",
  "username",
  "prf",
  "join",
  "joined",
];

/** The username the `joined` step shows when the design harness opens it without an account. */
const PREVIEW_HANDLE = "nightowl";

/** Whether an account has a username, from what reading its profile answered. */
const hasUsername = (profile: Awaited<ReturnType<typeof readProfile>>) =>
  profile === null ? null : profile !== false;

/**
 * `?wallet=<step>` opens the chooser on a step, outside production only. Every step after the
 * first sits behind a wallet prompt no headless browser can answer, so without this door the
 * design checks would never see them.
 */
function previewStep(): ConnectStep | null {
  if (process.env.NODE_ENV === "production") {
    return null;
  }
  const asked = new URLSearchParams(window.location.search).get("wallet");
  return PREVIEW_STEPS.find((step) => step === asked) ?? null;
}

export interface WalletChoice {
  /** Unique among the choices: the passkey wallet appears twice, once per way in. */
  key: string;
  kind: SignerKind;
  /** How this choice connects, where a wallet has more than one way. */
  mode: ConnectMode | null;
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
   * Whether the signed-in account has a username: yes, no, or null when it is not known. Only a
   * known "no" asks for one.
   */
  hasProfile: boolean | null;
  /** The account just claimed its username. */
  profileClaimed: () => void;
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
  const [flow, dispatch] = useReducer(connectFlow, CLOSED);
  const [previewClosed, setPreviewClosed] = useState(false);
  const [profile, setProfile] = useState<boolean | null>(null);
  // The same value, for the callbacks that answer with it outside a render.
  const profileRef = useRef<boolean | null>(null);
  // The username of the account that was just joined, for the step that says so.
  const [joinedHandle, setJoinedHandle] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  // The session is kept with the address it was issued for, never as a bare token: see
  // wallet-session.ts. The ref is the same value for the callbacks that run outside a render.
  const [held, setHeld] = useState<HeldSession | null>(null);
  const heldRef = useRef<HeldSession | null>(null);
  // The account as of the last render, for telling a change of chain from a change of
  // address when the held session has no address of its own.
  const accountRef = useRef<SignerAccount | null>(null);
  // Which connect is the current one: a later pick takes over from one still waiting on a wallet.
  const generation = useRef(0);
  // A passkey ceremony is running. Unlike a browser wallet's prompt it always ends.
  const meraFlight = useRef(false);
  // The wallet the chooser is waiting on, for its waiting line.
  const [picking, setPicking] = useState<SignerKind | null>(null);
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
    // A browser wallet that connected before is picked back up even when nothing was remembered:
    // `eth_accounts` never prompts. The passkey wallet is only resumed when it was the last used.
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

  /** What is known about the held session's account having a username. */
  const know = useCallback((next: boolean | null) => {
    profileRef.current = next;
    setProfile(next);
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
        if (!live || heldRef.current) {
          return;
        }
        const adopted = adoptSession(data.session);
        hold(adopted);
        if (!adopted || !data.session) {
          return;
        }
        // Whether that account has a username yet, so the portfolio can still ask after a reload.
        void readProfile(data.session.access_token).then((profile) => {
          if (live && heldRef.current === adopted) {
            know(hasUsername(profile));
          }
        });
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [hold, know]);

  /**
   * Lets go of the session unless it belongs to `next`: the token is forgotten and the browser is
   * signed out of it, so nothing done as the next wallet can go out under the last one's name.
   * A change of chain keeps the address, and so keeps the session.
   */
  const release = useCallback(
    (next: SignerAccount | null): Promise<void> => {
      const cached = heldRef.current;
      setSessionError(null);
      const previous = accountRef.current;
      const changed = releases(
        cached,
        previous && { address: previous.address, namespace: "eip155" },
        next && { address: next.address, namespace: "eip155" },
      );
      if (!cached || !changed) {
        return Promise.resolve();
      }
      hold(null);
      // What is known about a username is known about that session's account.
      know(null);
      // Best effort: the token is already forgotten here, which is what keeps it from being sent.
      // The promise is for a caller about to put another session in the same client: the sign-out
      // reads which session is there before it ends it, so it has to finish first.
      return dropWalletSession(getSupabase(), cached).catch(() => {});
    },
    [hold, know],
  );

  // Follow the active signer when it changes underneath the page.
  useEffect(() => {
    if (!adapter?.subscribe) {
      return;
    }
    return adapter.subscribe((next) => {
      void release(next);
      setAccount(next);
      if (!next) {
        setKind(null);
      }
    });
  }, [adapter, release]);

  /**
   * Takes the session a sign-in issued: the browser's Supabase client holds it, and the page
   * holds it with the address it was issued for. `profile` is whether that account has a username.
   * It is read again whenever a session is issued, so it always describes the account that just
   * signed in — after a reload the page may be holding what it knew about another one.
   */
  const keep = useCallback(
    async (
      signer: Signer | null,
      issue: (signer: Signer) => Promise<ConnectResult>,
    ): Promise<Kept> => {
      const { result, session } = await signInAs({
        cached: heldRef.current,
        signer,
        supabase: getSupabase(),
        signIn: issue,
        now: new Date(),
      });
      setSessionError("error" in result ? result.error : null);
      if (!session) {
        // Refused, or the token already held was handed back: nothing new is known.
        return { result, profile: profileRef.current, handle: null };
      }
      hold(session);
      know(null);
      const profile = await readProfile(session.token);
      const known = hasUsername(profile);
      if (heldRef.current === session) {
        know(known);
      }
      return { result, profile: known, handle: profile ? profile.handle : null };
    },
    [hold, know],
  );

  const connectWith = useCallback(
    async (picked: SignerKind, mode?: ConnectMode) => {
      const signer = SIGNERS.find((candidate) => candidate.kind === picked);
      // A passkey ceremony always ends — its prompt is modal and its requests time out — so a
      // second pick waits for it rather than starting another beside it.
      if (!signer || meraFlight.current) {
        return;
      }
      if (picked === "mera" && !getSupabase()) {
        // The passkey wallet signs in while it connects. With nowhere to keep a session, the
        // prompt would make a passkey and an account for nothing.
        dispatch({ type: "failed", error: "Signing in is not configured in this build." });
        return;
      }
      // A browser wallet may never answer: its window was closed, or ignored. So a later pick
      // takes over rather than waiting, and whatever the earlier one says afterwards is dropped.
      const mine = ++generation.current;
      const current = () => mine === generation.current;
      meraFlight.current = picked === "mera";
      setPicking(picked);
      setConnecting(true);
      setError(null);
      dispatch({ type: "working" });
      try {
        const connected = await signer.connect(mode);
        if (!current()) {
          return;
        }
        if (!connected) {
          dispatch({ type: "prompt_closed" });
          return;
        }
        const { session: issued, ...shown } = connected;
        const released = release(shown);
        setKind(picked);
        setAccount(shown);
        remember(picked);
        if (!issued) {
          // A browser wallet: signing in is the chooser's next step, behind its own button.
          dispatch({ type: "connected", signedIn: false, hasProfile: null });
          return;
        }
        // The passkey wallet signed in inside the ceremony that connected it. The last session is
        // signed out of first, or its sign-out would end this one; a sign-out that hangs is not
        // waited for, since it was best effort to begin with.
        await Promise.race([released, new Promise((done) => setTimeout(done, RELEASE_WAIT_MS))]);
        const { result, profile: known } = await keep(
          {
            address: shown.address,
            chainId: TARGET_CHAIN.chainId,
            signMessage: async () => {
              throw new Error("The ceremony already signed");
            },
          },
          async () => issued,
        );
        if ("error" in result) {
          dispatch({
            type: "failed",
            error: result.error ?? "That sign-in did not go through. Try again.",
          });
          return;
        }
        dispatch({ type: "connected", signedIn: true, hasProfile: known });
        if (known !== false) {
          setHolding(null);
        }
      } catch (caught) {
        if (!current()) {
          return;
        }
        if (caught instanceof PrfUnavailableError) {
          dispatch({ type: "prf_unavailable" });
          return;
        }
        // 4001 is the person closing the prompt, which is an answer rather than a failure.
        if ((caught as { code?: number }).code === 4001) {
          dispatch({ type: "prompt_closed" });
          return;
        }
        const words =
          picked === "mera"
            ? (signInWords(caught) ?? "That passkey could not open a wallet. Try again.")
            : "That wallet could not connect. Try again.";
        setError(words);
        dispatch({ type: "failed", error: words });
      } finally {
        if (picked === "mera") {
          meraFlight.current = false;
        }
        if (current()) {
          setConnecting(false);
        }
      }
    },
    [keep, release],
  );

  /** Signs in with the connected wallet, and says whether the account has a username. */
  const signInKeeping = useCallback(async (): Promise<Kept> => {
    setSigning(true);
    setSessionError(null);
    try {
      if (!account) {
        return await keep(null, signIn);
      }
      // The passkey wallet signs with its own ceremony: one prompt, restricted to this account.
      const own = adapter?.signIn;
      if (own) {
        return await keep(
          {
            address: account.address,
            chainId: TARGET_CHAIN.chainId,
            signMessage: async () => {
              throw new Error("The passkey ceremony signs by itself");
            },
          },
          () => own(account.address),
        );
      }
      const provider = getProvider();
      if (!provider) {
        return await keep(null, signIn);
      }
      return await keep(
        fromInjectedProvider(provider, account.address, account.chainId ?? TARGET_CHAIN.chainId),
        (signer) => signIn(signer, fetch, "eoa"),
      );
    } finally {
      setSigning(false);
    }
  }, [account, adapter, keep]);

  const signInWithWallet = useCallback(
    async (): Promise<SignInResult> => (await signInKeeping()).result,
    [signInKeeping],
  );

  /** The chooser's sign-in step: one signature, then on to the username or out. */
  const signInFromChooser = useCallback(async () => {
    dispatch({ type: "working" });
    const { result, profile: known } = await signInKeeping();
    if ("error" in result) {
      dispatch(
        result.error === null ? { type: "prompt_closed" } : { type: "failed", error: result.error },
      );
      return;
    }
    dispatch({ type: "signed_in", hasProfile: known });
    if (known !== false) {
      setHolding(null);
    }
  }, [signInKeeping]);

  /**
   * The join step: the person already has an account under another wallet. That wallet signs, the
   * bare account this wallet was given is folded into it, and the page takes the session of the
   * account that is kept. The connected wallet stays the connected wallet.
   */
  const joinWith = useCallback(
    async (picked: SignerKind) => {
      const signer = SIGNERS.find((candidate) => candidate.kind === picked);
      const connected = accountRef.current;
      if (!signer || !connected || meraFlight.current) {
        return;
      }
      const mine = ++generation.current;
      const current = () => mine === generation.current;
      setPicking(picked);
      dispatch({ type: "working" });
      try {
        // The session of the account being given up. The chooser signed in a moment ago, so this
        // hands back the token it holds and asks nobody for anything.
        const own = await signInKeeping();
        if (!current()) {
          return;
        }
        if ("error" in own.result) {
          dispatch(
            own.result.error === null
              ? { type: "prompt_closed" }
              : { type: "failed", error: own.result.error },
          );
          return;
        }
        meraFlight.current = picked === "mera";
        const joined = await signer.join(own.result.token);
        if (!current()) {
          return;
        }
        if (!joined) {
          dispatch({ type: "prompt_closed" });
          return;
        }
        // The session held is the account that no longer exists. Let go of it without signing
        // the browser out, and keep the one the API answered with, for this same address.
        hold(null);
        const {
          result,
          profile: known,
          handle,
        } = await keep(
          {
            address: connected.address,
            chainId: TARGET_CHAIN.chainId,
            signMessage: async () => {
              throw new Error("The other wallet already signed");
            },
          },
          async () => joined.session,
        );
        if ("error" in result) {
          dispatch({
            type: "failed",
            error: result.error ?? "The account was joined. Connect again to open it.",
          });
          return;
        }
        setJoinedHandle(handle);
        dispatch({ type: "joined", hasProfile: known });
        if (known !== false) {
          setHolding(null);
        }
      } catch (caught) {
        if (!current()) {
          return;
        }
        if (caught instanceof PrfUnavailableError) {
          dispatch({ type: "prf_unavailable" });
          return;
        }
        const words = joinWords(caught);
        dispatch(words === null ? { type: "prompt_closed" } : { type: "failed", error: words });
      } finally {
        if (picked === "mera") {
          meraFlight.current = false;
        }
      }
    },
    [hold, keep, signInKeeping],
  );

  const profileClaimed = useCallback(() => {
    know(true);
    setHolding(null);
    dispatch({ type: "claimed" });
  }, [know]);

  const closeChooser = useCallback(() => {
    setPreviewClosed(true);
    dispatch({ type: "close" });
    if (!meraFlight.current) {
      // A browser wallet that has not answered may never answer. The site stops saying it is
      // waiting, so the person can ask again; if the wallet does answer, it still connects.
      setConnecting(false);
    }
  }, []);

  const connect = useCallback((held?: string) => {
    setHolding(held ?? null);
    setError(null);
    dispatch({ type: "open" });
    if (meraFlight.current) {
      // Closed and opened again while a passkey ceremony is finishing: the chooser waits for it.
      // A browser wallet that has not answered is not waited for; picking again takes over.
      dispatch({ type: "working" });
    }
    for (const signer of SIGNERS) {
      signer.prepare?.();
    }
  }, []);

  const disconnect = useCallback(async () => {
    // First, and whatever the wallet then answers: a disconnect that failed half-way must not
    // leave the last address's session behind.
    void release(null);
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
    return SIGNERS.flatMap((signer): WalletChoice[] => {
      const shared = {
        kind: signer.kind,
        unavailable: mounted ? signer.unavailableReason() : "Checking this browser…",
        note: mounted ? (signer.note?.() ?? null) : null,
      };
      if (signer.kind !== "mera") {
        return [{ ...shared, key: signer.kind, mode: null, last: signer.kind === last }];
      }
      // Creating a passkey and opening one are different ceremonies, so they are two choices.
      return [
        { ...shared, key: "mera-create", mode: "create", last: false },
        // The caveat is about the wallet, not the way in: it is said once.
        { ...shared, note: null, key: "mera-existing", mode: "existing", last: last === "mera" },
      ];
    });
  }, [mounted]);

  /**
   * The wallets an account already had can be signed with from the join step. A second account of
   * the same browser wallet is not offered: selecting it there is the wallet changing under the
   * page, which the page follows as a new connection.
   */
  const joinChoices = useMemo<WalletChoice[]>(
    () =>
      choices
        .filter((choice) => choice.mode !== "create")
        .map((choice) => ({
          ...choice,
          last: false,
          unavailable:
            choice.kind === "injected" && kind === "injected"
              ? "You are connected with your browser wallet. A second account of the same wallet cannot sign here yet."
              : choice.unavailable,
        })),
    [choices, kind],
  );

  // The design harness's door: a step shown without the prompts that lead to it.
  const preview = mounted && !previewClosed && flow.step === "closed" ? previewStep() : null;
  const shownFlow: ConnectFlowState = preview
    ? {
        step: preview,
        busy: false,
        error: null,
        joining: preview === "join" || preview === "joined",
      }
    : flow;

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
      hasProfile: profile,
      profileClaimed,
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
    profile,
    profileClaimed,
    sessionError,
    signInWithWallet,
    signing,
    switchChain,
  ]);

  return (
    <WalletContext.Provider value={value}>
      {children}
      <ConnectModal
        flow={shownFlow}
        choices={choices}
        joinChoices={joinChoices}
        joinedHandle={joinedHandle ?? (preview ? PREVIEW_HANDLE : null)}
        holding={holding}
        address={account?.address ?? (preview ? PREVIEW_ADDRESS : null)}
        kind={kind}
        picking={picking}
        onPick={(picked, mode) => void connectWith(picked, mode ?? undefined)}
        onSignIn={() => void signInFromChooser()}
        onJoin={() => dispatch({ type: "join" })}
        onJoinWith={(picked) => void joinWith(picked)}
        onBack={() => dispatch({ type: "back" })}
        onClose={closeChooser}
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
