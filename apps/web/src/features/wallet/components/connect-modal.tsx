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
 * a username if the account has none (docs/specs/mera-web-v1.md §3).
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
  /** What the person was about to do when the wallet got in the way. */
  holding: string | null;
  /** The connected address, once there is one. */
  address: string | null;
  kind: SignerKind | null;
  onPick: (kind: SignerKind, mode: ConnectMode | null) => void;
  onSignIn: () => void;
  onBack: () => void;
  onClaimed: () => void;
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
      </div>
    </dialog>
  );
}

function Choose({ flow, choices, kind, onPick }: ConnectModalProps) {
  return (
    <>
      <h2 id="connect-title" className={styles.title}>
        CONNECT A WALLET.
      </h2>
      <p className={styles.lead}>
        Reading and following never need an account. The wallet appears the first time money moves —
        paying for a read, or buying a token.
      </p>

      <ul className={styles.choices}>
        {choices.map((choice) => {
          const copy = COPY[choice.key]!;
          return (
            <li key={choice.key}>
              <button
                type="button"
                className={styles.choice}
                disabled={choice.unavailable !== null || flow.busy}
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

      {flow.busy && <p className={styles.waiting}>{WAITING[kind ?? "injected"]}</p>}
      <Failure flow={flow} />

      <p className={styles.foot}>
        Connecting signs you in with one signature that costs nothing and moves nothing. Every
        operation after that is confirmed on its own.
      </p>
    </>
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
function Username({ flow, onClaimed }: ConnectModalProps) {
  const form = useHandleClaim(onClaimed);
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

      <p className={styles.foot}>
        You are signed in. Close this to pick a username later; your portfolio will ask again.
      </p>
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
        The password manager that saved it does not hand over the secret a wallet is made from.
        Apple Passwords (iCloud Keychain), Google Password Manager and Windows Hello do. Bitwarden,
        Dashlane and a passkey kept in the Chrome profile do not.
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
