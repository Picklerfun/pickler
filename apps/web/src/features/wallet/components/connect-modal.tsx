"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Button, Icon, Input } from "@pickler/ui";
import type { IconName } from "@pickler/ui";
import type { ConnectFlowState, ConnectStep } from "../lib/connect-flow";
import { shortAddress } from "../lib/provider";
import type { ConnectMode, SignerKind } from "../lib/signer";
import { useHandleClaim, type HandleState } from "../lib/use-handle-claim";
import type { WalletChoice } from "../lib/wallet-context";
import styles from "./connect-modal.module.css";

/**
 * The chooser. Where the person picks one of the marketplace's two wallets — the passkey wallet,
 * or the browser wallet they brought — and then finishes arriving: one signature to sign in, and
 * a username if the account has none (docs/specs/mera-web-v1.md §3). Somebody whose account is
 * under their other wallet says so on the username step, signs with that wallet, and the one they
 * connected opens that account from then on (§9).
 *
 * The username, link, not-a-wallet and linked steps are drawn from the "Pickler Connect Link
 * Wallet" canvas, and the other steps wear the same card. Colours are the surface's tokens, not
 * the canvas's literals: its label grey does not reach the contrast floor on this ground.
 *
 * It holds up what the person was about to do, the way the app's own sign-in screen does, so the
 * wallet is a step inside their action rather than a wall in front of it. A choice this browser
 * cannot offer stays visible with the reason on it, which tells someone what is missing rather
 * than leaving them in front of an empty list.
 */

interface ChoiceCopy {
  title: string;
  sub: string;
  icon: IconName;
  /** The line under the description while nothing is happening. */
  idle: string;
}

const COPY: Record<string, ChoiceCopy> = {
  "mera-create": {
    title: "Passkey wallet",
    sub: "Create one with Face ID, Touch ID or this device's PIN. No seed phrase, no extension.",
    icon: "fingerprint",
    idle: "NEW · BY MERA",
  },
  "mera-existing": {
    title: "I already have a passkey wallet",
    sub: "Open the one you made here or in the Pickler app. Same passkey, same account.",
    icon: "fingerprint",
    idle: "ONE PROMPT · BY MERA",
  },
  injected: {
    title: "Browser wallet",
    sub: "MetaMask, Rabby, or whatever this browser injects.",
    icon: "wallet",
    idle: "DETECTED",
  },
};

/** The same two wallets, worded for somebody whose account is already under one of them. */
const JOIN_COPY: Record<string, ChoiceCopy> = {
  "mera-existing": {
    title: "Passkey wallet",
    sub: "Face ID, Touch ID or a security key you set up on Pickler.",
    icon: "fingerprint",
    idle: "ONE SIGNATURE · BY MERA",
  },
  injected: {
    title: "Browser wallet",
    sub: "MetaMask, Rabby or any wallet already in your browser.",
    icon: "wallet",
    idle: "ONE SIGNATURE · DETECTED",
  },
};

const WAITING: Record<SignerKind, string> = {
  mera: "WAITING FOR YOUR PASSKEY…",
  injected: "WAITING FOR YOUR WALLET…",
};

const KIND: Record<SignerKind, string> = {
  mera: "PASSKEY WALLET",
  injected: "BROWSER WALLET",
};

const EYEBROW: Record<Exclude<ConnectStep, "closed">, string> = {
  choose: "CONNECT · CHOOSE A WALLET",
  signin: "CONNECT · SIGN IN",
  username: "CONNECT · PICK YOUR USERNAME",
  join: "CONNECT · LINK TO YOUR ACCOUNT",
  prf: "CONNECT · PASSKEY",
  joined: "CONNECT · LINKED",
};

interface ConnectModalProps {
  flow: ConnectFlowState;
  choices: WalletChoice[];
  /** The wallets an existing account can be signed with, on the link step. */
  joinChoices: WalletChoice[];
  /** The account that was just joined: its username when known, and the wallet that signed. */
  joined: { handle: string | null; via: string } | null;
  /** What the person was about to do when the wallet got in the way. */
  holding: string | null;
  /** The connected address, once there is one. */
  address: string | null;
  kind: SignerKind | null;
  /** The wallet the chooser is waiting on: the one just picked, not the one connected. */
  picking: SignerKind | null;
  onPick: (kind: SignerKind, mode: ConnectMode | null) => void;
  onSignIn: () => void;
  /** From the username step: "I already have an account". */
  onJoin: () => void;
  /** The wallet that account is under was picked. */
  onJoinWith: (kind: SignerKind) => void;
  onBack: () => void;
  onClose: () => void;
}

export function ConnectModal(props: ConnectModalProps) {
  const { flow, holding, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const open = flow.step !== "closed";

  // `showModal` is what makes it a modal: the page behind goes inert, focus is trapped, and
  // Escape closes it without a keydown listener of our own.
  useEffect(() => {
    const element = dialog.current;
    if (!element) {
      return;
    }
    if (open && !element.open) {
      element.showModal();
    }
    if (!open && element.open) {
      element.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      // A dialog sits at the top of the body, outside whatever subtree opened it, so it inherits
      // no surface and would fall through to the default. It carries its own, and it is dark
      // because that is what this card has always been.
      data-surface="dark"
      aria-labelledby="connect-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // A click that lands on the dialog itself landed on the backdrop: the card is a child.
      onClick={(event) => {
        if (event.target === dialog.current) {
          onClose();
        }
      }}
    >
      <div className={styles.card} id={open ? `connect-step-${flow.step}` : undefined}>
        <header className={styles.head}>
          <p className={styles.label}>{flow.step === "closed" ? "" : EYEBROW[flow.step]}</p>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <Icon name="x" size={14} />
          </button>
        </header>

        {holding && (
          <div className={styles.held}>
            <p className={styles.label}>WE KEPT WHAT YOU WERE ABOUT TO DO</p>
            <p className={styles.heldAction}>{holding}</p>
          </div>
        )}

        {/* Keyed by the step, so each one arrives rather than swapping in place. */}
        {open && (
          <div className={styles.step} key={flow.step}>
            {flow.step === "choose" && <Choose {...props} />}
            {flow.step === "signin" && <SignIn {...props} />}
            {flow.step === "username" && <Username {...props} />}
            {flow.step === "prf" && <NoPrf {...props} />}
            {flow.step === "join" && <Join {...props} />}
            {flow.step === "joined" && <Joined {...props} />}
          </div>
        )}
      </div>
    </dialog>
  );
}

/** A step's title, with the full stop that carries its colour. */
function Title({ children, tone = "good" }: { children: ReactNode; tone?: "good" | "bad" }) {
  return (
    <h2 id="connect-title" className={styles.title}>
      {children}
      <span className={styles.stop} data-tone={tone}>
        .
      </span>
    </h2>
  );
}

/** The line at the foot of a step: what is on the left, and whose wallet this is about. */
function Foot({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className={styles.foot}>
      <span>{left}</span>
      <span className={styles.footValue}>{right}</span>
    </div>
  );
}

/** The wallets to pick from, each with why it cannot be picked here when it cannot. */
function Options({
  choices,
  copy,
  busy,
  picking,
  onPick,
}: {
  choices: WalletChoice[];
  copy: Record<string, ChoiceCopy>;
  busy: boolean;
  /** The wallet being waited on, when one is. */
  picking: SignerKind | null;
  onPick: (choice: WalletChoice) => void;
}) {
  // Two rows of one wallet both wait when it is picked; only the first shows it.
  const waitingKey = busy ? choices.find((choice) => choice.kind === picking)?.key : undefined;

  return (
    <ul className={styles.options}>
      {choices.map((choice) => {
        const words = copy[choice.key] ?? COPY[choice.key]!;
        const off = choice.unavailable !== null;
        const waiting = choice.key === waitingKey;
        return (
          <li key={choice.key}>
            <button
              type="button"
              className={styles.option}
              data-off={off || undefined}
              data-waiting={waiting || undefined}
              data-aside={(busy && !waiting) || undefined}
              disabled={off || busy}
              onClick={() => onPick(choice)}
            >
              <span className={styles.optionIcon} aria-hidden="true">
                {waiting && <span className={styles.spinner} />}
                <Icon name={words.icon} size={22} />
              </span>
              <span className={styles.optionText}>
                <span className={styles.optionTitle}>
                  {words.title}
                  {choice.last && <span className={styles.lastUsed}>LAST USED</span>}
                </span>
                {!off && <span className={styles.optionSub}>{words.sub}</span>}
                {off && (
                  <span className={styles.optionMeta} data-tone="bad">
                    NOT AVAILABLE · {choice.unavailable}
                  </span>
                )}
                {!off && waiting && (
                  <span className={styles.optionMeta} data-tone="wait" role="status">
                    {WAITING[choice.kind]}
                  </span>
                )}
                {!off && !waiting && <span className={styles.optionMeta}>{words.idle}</span>}
                {!off && choice.note && <span className={styles.optionNote}>{choice.note}</span>}
              </span>
              {!off && !waiting && <Icon name="arrow" size={16} className={styles.optionArrow} />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Choose({ flow, choices, picking, onPick }: ConnectModalProps) {
  return (
    <>
      <div className={styles.intro}>
        <Title>CONNECT A WALLET</Title>
        <p className={styles.lead}>
          Reading and following never need an account. The wallet appears the first time money moves
          — paying for a read, or buying a token.
        </p>
      </div>

      <Options
        choices={choices}
        copy={COPY}
        busy={flow.busy}
        picking={picking}
        onPick={(choice) => onPick(choice.kind, choice.mode)}
      />
      <Failure flow={flow} />

      <p className={styles.fine}>
        Connecting signs you in with one signature that costs nothing and moves nothing. Every
        operation after that is confirmed on its own.
      </p>
    </>
  );
}

/** A browser wallet's second step: the one signature that says the wallet is theirs. */
function SignIn({ flow, address, kind, onSignIn }: ConnectModalProps) {
  return (
    <>
      <div className={styles.intro}>
        <Title>SIGN IN</Title>
        <p className={styles.lead}>
          One signature tells Pickler that {address ? shortAddress(address) : "this wallet"} is
          yours. It is a line of text: it costs nothing and moves nothing.
        </p>
      </div>

      <Button variant="primary" block disabled={flow.busy} onClick={onSignIn}>
        {flow.busy ? "Check your wallet…" : "Sign in"}
        {!flow.busy && <Icon name="arrow" size={16} />}
      </Button>
      <Failure flow={flow} />

      <p className={styles.fine}>
        Your wallet will show the message before you sign it. Close this to stay connected without
        an account.
      </p>
      <Connected address={address} kind={kind} />
    </>
  );
}

function Connected({ address, kind }: { address: string | null; kind: SignerKind | null }) {
  if (!address) {
    return null;
  }
  return <Foot left="CONNECTED" right={`${shortAddress(address)} · ${KIND[kind ?? "injected"]}`} />;
}

/** What stands under the username field, in the canvas's voice. */
function handleNote(state: HandleState, handle: string, min: number, max: number): string {
  switch (state) {
    case "empty":
      return `PICK ONE · ${min}–${max}`;
    case "invalid_characters":
      return "LETTERS, NUMBERS, UNDERSCORE ONLY";
    case "too_short":
      return `TOO SHORT · ${min} MIN`;
    case "too_long":
      return `TOO LONG · ${max} MAX`;
    case "reserved":
      return "THAT ONE IS SPOKEN FOR";
    case "taken":
      return `@${handle.trim().toUpperCase()} IS TAKEN`;
    case "checking":
      return "CHECKING…";
    case "unknown":
      // Never "taken": a lookup that failed is not an answer.
      return "COULD NOT CHECK · YOU CAN STILL CLAIM IT";
    case "ok":
      return "AVAILABLE";
  }
}

const NOTE_TONE: Partial<Record<HandleState, "good" | "bad" | "quiet">> = {
  ok: "good",
  invalid_characters: "bad",
  too_long: "bad",
  reserved: "bad",
  taken: "bad",
  empty: "quiet",
};

/** The last step, for an account with no username yet, whichever wallet it came with. */
function Username({ flow, address, kind, onJoin }: ConnectModalProps) {
  // The claim tells the wallet context, which closes the chooser: nothing to do here afterwards.
  const form = useHandleClaim();
  const refused = form.problem !== null || form.state === "taken";

  return (
    <>
      <div className={styles.intro}>
        <Title>PICK YOUR USERNAME</Title>
        <p className={styles.lead}>
          How you show up on the board. Letters, numbers, underscore — {form.minLength} to{" "}
          {form.maxLength}.
        </p>
      </div>

      <div className={styles.handle} data-state={form.state}>
        <div className={styles.handleField}>
          <Input
            id="connect-username"
            aria-label="Username"
            aria-describedby="connect-username-note"
            value={form.handle}
            size="lg"
            shape="pill"
            prefix="@"
            autoComplete="off"
            spellCheck={false}
            maxLength={form.maxLength}
            invalid={refused && form.state !== "too_short"}
            placeholder="username"
            onChange={(event) => form.setHandle(event.target.value.replace(/^@/, ""))}
          />
          {form.state === "ok" && <span className={styles.handleOk} aria-hidden="true" />}
        </div>
        <p
          id="connect-username-note"
          className={styles.handleNote}
          data-tone={NOTE_TONE[form.state]}
        >
          {handleNote(form.state, form.handle, form.minLength, form.maxLength)}
        </p>
      </div>

      <Button
        variant="primary"
        block
        disabled={!form.askable || form.state === "taken" || form.busy}
        onClick={() => void form.claim()}
      >
        {form.busy ? "Claiming…" : "Claim it"}
        {!form.busy && <Icon name="arrow" size={16} />}
      </Button>
      {form.failed && <Problem>{form.failed}</Problem>}
      <Failure flow={flow} />

      {/* The other way out: this wallet is new here, and the person is not. */}
      <button type="button" className={styles.textLink} disabled={form.busy} onClick={onJoin}>
        Already have a Pickler account? <span>Link this wallet to it</span>
      </button>

      <Connected address={address} kind={kind} />
    </>
  );
}

/**
 * "I already have an account": the person signs with the wallet it is under, and the wallet they
 * connected opens that account from then on.
 */
function Join({ flow, joinChoices, address, picking, onJoinWith, onBack }: ConnectModalProps) {
  return (
    <>
      <div className={styles.intro}>
        <Title>LINK TO YOUR ACCOUNT</Title>
        <p className={styles.lead}>
          Connect with the wallet that already has your account and sign once. From then on, either
          wallet opens the same account.
        </p>
      </div>

      <Options
        choices={joinChoices}
        copy={JOIN_COPY}
        busy={flow.busy}
        picking={picking}
        onPick={(choice) => onJoinWith(choice.kind)}
      />
      <Failure flow={flow} />

      <Foot
        left={
          <button type="button" className={styles.back} disabled={flow.busy} onClick={onBack}>
            <Icon name="arrowLeft" size={14} />
            Back
          </button>
        }
        right={
          <>
            <span className={styles.footLabel}>LINKING</span>{" "}
            {address ? shortAddress(address) : "THIS WALLET"}
          </>
        }
      />
    </>
  );
}

/** It happened: say which account this wallet opens now. */
function Joined({ address, kind, joined, onClose }: ConnectModalProps) {
  const wallet = address ? shortAddress(address) : "This wallet";
  const account = joined?.handle ? `@${joined.handle}` : "your account";
  return (
    <>
      <span className={styles.done} aria-hidden="true">
        <Icon name="check" size={30} />
      </span>
      <div className={styles.intro}>
        <Title>LINKED</Title>
        <p className={styles.lead}>
          <strong>{wallet}</strong> now opens <strong>{account}</strong>. Either wallet signs you in
          from here.
        </p>
      </div>

      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>THIS WALLET</dt>
          <dd>
            {wallet} · {KIND[kind ?? "injected"]}
          </dd>
        </div>
        <div className={styles.fact}>
          <dt>ACCOUNT</dt>
          <dd>
            {account}
            {joined && ` · VIA ${shortAddress(joined.via)}`}
          </dd>
        </div>
      </dl>

      <Button variant="primary" block onClick={onClose}>
        Done
      </Button>
    </>
  );
}

/**
 * A passkey that exists and cannot open a wallet: say what to change, and offer the other way.
 * While linking, the other way is the wallet that holds the account.
 */
function NoPrf({ flow, onBack }: ConnectModalProps) {
  if (flow.joining) {
    return (
      <>
        <div className={styles.intro}>
          <Title tone="bad">THAT PASSKEY ISN&rsquo;T A WALLET</Title>
          <p className={styles.lead}>
            It signed, but it cannot open a Pickler wallet. Pick the passkey you created here, or
            use the browser wallet that holds the account.
          </p>
        </div>
        <Button variant="secondary" block onClick={onBack}>
          Try another wallet
        </Button>
      </>
    );
  }
  return (
    <>
      <div className={styles.intro}>
        <Title tone="bad">THAT PASSKEY CANNOT OPEN A WALLET</Title>
        <p className={styles.lead}>
          The password manager that saved it did not hand over the secret a wallet is made from. An
          up-to-date Apple Passwords (iCloud Keychain), Google Password Manager or Windows Hello
          does; some other managers, and older systems, do not.
        </p>
        <p className={styles.lead}>
          If a passkey named Pickler was just saved there, it is no use and can be deleted.
        </p>
      </div>
      <Button variant="secondary" block onClick={onBack}>
        Choose another way
      </Button>
    </>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p className={styles.error} role="alert">
      <span className={styles.errorMark} aria-hidden="true" />
      {children}
    </p>
  );
}

function Failure({ flow }: { flow: ConnectFlowState }) {
  return flow.error ? <Problem>{flow.error}</Problem> : null;
}
