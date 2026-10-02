"use client";

import { useEffect, useRef } from "react";
import { Button, Field, Icon, Input } from "@pickler/ui";
import type { IconName } from "@pickler/ui";
import type { ConnectFlowState } from "../lib/connect-flow";
import { shortAddress } from "../lib/provider";
import type { ConnectMode, SignerKind } from "../lib/signer";
import { useHandleClaim } from "../lib/use-handle-claim";
import type { WalletChoice } from "../lib/wallet-context";
import styles from "./connect-modal.module.css";

/**
 * The chooser. Where the person picks one of the marketplace's two wallets — the passkey wallet,
 * or the browser wallet they brought — and then finishes arriving: one signature to sign in, and
 * a username if the account has none (docs/specs/mera-web-v1.md §3). Somebody whose account is
 * under their other wallet says so on the username step, signs with that wallet, and the one they
 * connected opens that account from then on (§9).
 *
 * It holds up what the person was about to do, the way the app's own sign-in screen does, so the
 * wallet is a step inside their action rather than a wall in front of it. A choice this browser
 * cannot offer stays visible with the reason on it, which tells someone what is missing rather
 * than leaving them in front of an empty list.
 */

const COPY: Record<string, { title: string; sub: string; icon: IconName }> = {
  "mera-create": {
    title: "Passkey wallet",
    sub: "Create one with Face ID, Touch ID or this device's PIN. No seed phrase, no extension.",
    icon: "key",
  },
  "mera-existing": {
    title: "I already have a passkey wallet",
    sub: "Open the one you made here or in the Pickler app. Same passkey, same account.",
    icon: "key",
  },
  injected: {
    title: "Browser wallet",
    sub: "MetaMask, Rabby, or whatever this browser injects.",
    icon: "wallet",
  },
};

const WAITING: Record<SignerKind, string> = {
  mera: "Waiting for your passkey…",
  injected: "Waiting for your wallet…",
};

interface ConnectModalProps {
  flow: ConnectFlowState;
  choices: WalletChoice[];
  /** The wallets an existing account can be signed with, on the join step. */
  joinChoices: WalletChoice[];
  /** The username of the account that was just joined, when it is known. */
  joinedHandle: string | null;
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
          <p className={styles.label}>WALLET</p>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>

        {holding && (
          <div className={styles.held}>
            <p className={styles.label}>WE KEPT WHAT YOU WERE ABOUT TO DO</p>
            <p className={styles.heldAction}>{holding}</p>
          </div>
        )}

        {flow.step === "choose" && <Choose {...props} />}
        {flow.step === "signin" && <SignIn {...props} />}
        {flow.step === "username" && <Username {...props} />}
        {flow.step === "prf" && <NoPrf {...props} />}
        {flow.step === "join" && <Join {...props} />}
        {flow.step === "joined" && <Joined {...props} />}
      </div>
    </dialog>
  );
}

function Choose({ flow, choices, kind, picking, onPick }: ConnectModalProps) {
  return (
    <>
      <h2 id="connect-title" className={styles.title}>
        CONNECT A WALLET.
      </h2>
      <p className={styles.lead}>
        Reading and following never need an account. The wallet appears the first time money moves —
        paying for a read, or buying a token.
      </p>

      <Choices choices={choices} busy={flow.busy} onPick={onPick} />

      {flow.busy && <p className={styles.waiting}>{WAITING[picking ?? kind ?? "injected"]}</p>}
      <Failure flow={flow} />

      <p className={styles.foot}>
        Connecting signs you in with one signature that costs nothing and moves nothing. Every
        operation after that is confirmed on its own.
      </p>
    </>
  );
}

/** The wallets to pick from, each with why it cannot be picked here when it cannot. */
function Choices({
  choices,
  busy,
  onPick,
}: {
  choices: WalletChoice[];
  busy: boolean;
  onPick: (kind: SignerKind, mode: ConnectMode | null) => void;
}) {
  return (
    <ul className={styles.choices}>
      {choices.map((choice) => {
        const copy = COPY[choice.key]!;
        return (
          <li key={choice.key}>
            <button
              type="button"
              className={styles.choice}
              disabled={choice.unavailable !== null || busy}
              onClick={() => onPick(choice.kind, choice.mode)}
            >
              <span className={styles.choiceIcon} aria-hidden="true">
                <Icon name={copy.icon} size={18} />
              </span>
              <span className={styles.choiceText}>
                <span className={styles.choiceTitle}>
                  {copy.title}
                  {choice.last && <span className={styles.lastUsed}>LAST USED</span>}
                </span>
                <span className={styles.choiceSub}>{choice.unavailable ?? copy.sub}</span>
                {choice.unavailable === null && choice.note && (
                  <span className={styles.choiceNote}>{choice.note}</span>
                )}
              </span>
              {choice.unavailable === null && <Icon name="arrow" size={16} />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** A browser wallet's second step: the one signature that says the wallet is theirs. */
function SignIn({ flow, address, onSignIn }: ConnectModalProps) {
  return (
    <>
      <h2 id="connect-title" className={styles.title}>
        SIGN IN.
      </h2>
      <p className={styles.lead}>
        One signature tells Pickler that {address ? shortAddress(address) : "this wallet"} is yours.
        It is a line of text: it costs nothing and moves nothing.
      </p>

      <div className={styles.actions}>
        <Button variant="primary" block disabled={flow.busy} onClick={onSignIn}>
          {flow.busy ? "Check your wallet…" : "Sign in"}
        </Button>
      </div>
      <Failure flow={flow} />

      <p className={styles.foot}>
        Your wallet will show the message before you sign it. Close this to stay connected without
        an account.
      </p>
    </>
  );
}

/** The last step, for an account with no username yet, whichever wallet it came with. */
function Username({ flow, onJoin }: ConnectModalProps) {
  // The claim tells the wallet context, which closes the chooser: nothing to do here afterwards.
  const form = useHandleClaim();
  return (
    <>
      <h2 id="connect-title" className={styles.title}>
        PICK YOUR USERNAME.
      </h2>
      <p className={styles.lead}>
        It is the name the board shows beside what you back and what you ask. Without one you appear
        as your address.
      </p>

      <Field
        label="USERNAME"
        htmlFor="connect-username"
        {...(form.shown ? { note: form.shown.text, tone: form.shown.tone } : {})}
      >
        <Input
          id="connect-username"
          value={form.handle}
          mono
          prefix="@"
          autoComplete="off"
          spellCheck={false}
          maxLength={form.maxLength}
          invalid={form.problem !== null}
          placeholder="nightowl"
          onChange={(event) => form.setHandle(event.target.value)}
        />
      </Field>

      <div className={styles.actions}>
        <Button
          variant="primary"
          block
          disabled={!form.askable || form.busy}
          onClick={() => void form.claim()}
        >
          {form.busy ? "Claiming…" : "Claim it"}
        </Button>
      </div>
      {form.failed && (
        <p className={styles.error} role="alert">
          {form.failed}
        </p>
      )}
      <Failure flow={flow} />

      {/* The other way out: this wallet is new here, and the person is not. */}
      <div className={styles.actions}>
        <Button variant="ghost" block disabled={form.busy} onClick={onJoin}>
          Already have a Pickler account? Link this wallet to it
        </Button>
      </div>

      <p className={styles.foot}>
        You are signed in. Close this to pick a username later; your portfolio will ask again.
      </p>
    </>
  );
}

/**
 * "I already have an account": the person signs with the wallet it is under, and the wallet they
 * connected opens that account from then on.
 */
function Join({
  flow,
  joinChoices,
  address,
  kind,
  picking,
  onJoinWith,
  onBack,
}: ConnectModalProps) {
  return (
    <>
      <h2 id="connect-title" className={styles.title}>
        LINK TO YOUR ACCOUNT.
      </h2>
      <p className={styles.lead}>
        Sign with the wallet your Pickler account is under. After that{" "}
        {address ? shortAddress(address) : "this wallet"} opens the same account: the same username,
        the same reads.
      </p>

      <Choices choices={joinChoices} busy={flow.busy} onPick={(picked) => onJoinWith(picked)} />

      {flow.busy && <p className={styles.waiting}>{WAITING[picking ?? kind ?? "injected"]}</p>}
      <Failure flow={flow} />

      <div className={styles.actions}>
        <Button variant="secondary" block disabled={flow.busy} onClick={onBack}>
          Back
        </Button>
      </div>

      <p className={styles.foot}>
        That wallet signs one line of text, the same as when it signs in. It costs nothing and moves
        nothing, and nothing leaves either wallet.
      </p>
    </>
  );
}

/** It happened: say which account this wallet opens now. */
function Joined({ address, joinedHandle, onClose }: ConnectModalProps) {
  return (
    <>
      <h2 id="connect-title" className={styles.title}>
        LINKED.
      </h2>
      <p className={styles.lead}>
        {address ? shortAddress(address) : "This wallet"} now opens{" "}
        {joinedHandle ? `@${joinedHandle}` : "your account"}. Connect with either wallet and you are
        in the same place.
      </p>

      <div className={styles.actions}>
        <Button variant="primary" block onClick={onClose}>
          Done
        </Button>
      </div>
    </>
  );
}

/** A passkey that exists and cannot open a wallet: say what to change, and offer the other way. */
function NoPrf({ onBack }: ConnectModalProps) {
  return (
    <>
      <h2 id="connect-title" className={styles.title}>
        THAT PASSKEY CANNOT OPEN A WALLET.
      </h2>
      <p className={styles.lead}>
        The password manager that saved it did not hand over the secret a wallet is made from. An
        up-to-date Apple Passwords (iCloud Keychain), Google Password Manager or Windows Hello does;
        some other managers, and older systems, do not.
      </p>
      <p className={styles.lead}>
        If a passkey named Pickler was just saved there, it is no use and can be deleted.
      </p>

      <div className={styles.actions}>
        <Button variant="secondary" block onClick={onBack}>
          Choose another way
        </Button>
      </div>
    </>
  );
}

function Failure({ flow }: { flow: ConnectFlowState }) {
  return flow.error ? (
    <p className={styles.error} role="alert">
      {flow.error}
    </p>
  ) : null;
}
