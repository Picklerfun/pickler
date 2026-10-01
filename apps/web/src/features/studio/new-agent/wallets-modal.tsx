"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Button, Icon, Segmented } from "@pickler/ui";
import { SessionExpired } from "@/features/auth/lib/custody";
import { accentVars } from "@/lib/accent";
import {
  StudioError,
  errorCode,
  transferConfirm,
  transferPrepare,
  type StudioWallets,
} from "../api";
import { relyingParty, stampActivity } from "../lib/passkey";
import shell from "../studio.module.css";
import { AvatarGrid } from "./identity";
import {
  agentWalletTag,
  canMove,
  exactUnits,
  formatUnits,
  moveBody,
  moveNote,
  moveSheetCopy,
  moveSource,
  transferLabel,
  unitsOf,
  walletName,
  type Accent,
  type Move,
  type Token,
} from "./model";
import { PasskeySheet, type SheetPhase } from "./passkey-sheet";
import { useDialog } from "./use-dialog";
import styles from "./new-agent.module.css";

/** The agent this screen is creating: names and draws its wallet before an agent has it. */
export interface WalletsDraft {
  walletId: string;
  name: string;
  accent: Accent;
  pattern: number;
}

export interface WalletsModalProps {
  open: boolean;
  wallets: StudioWallets | null;
  /** Open with this agent wallet's move form showing, toward the agent. */
  openOn: string | null;
  draft: WalletsDraft | null;
  preview: boolean;
  onClose(): void;
  /** The canvas's "AI credits" tab. */
  onCredits(): void;
  /** A transfer went through, or may have: read the wallets again. */
  onMoved(): void;
}

/** The two names a WebAuthn prompt fails with when the person closed it or it timed out. */
const CLOSED_PROMPT = new Set(["NotAllowedError", "AbortError"]);
/** How long the sheet shows its "Moved" before it closes. */
const DONE_MS = 650;
const COPIED_MS = 1400;
const TOKENS = [
  { value: "AUSD", label: "AUSD" },
  { value: "MON", label: "MON" },
] as const;

/** The move the sheet is signing, with its words fixed when Send was pressed. */
interface Pending {
  move: Move;
  amount: string;
  copy: { title: string; body: string; done: string };
}

/**
 * "Your wallets" (canvas: Wallets · AI credits modal, spec §3.3): the master wallet and each agent
 * wallet, with "Fund from master" and "Pull back to master" (D7, D12). A move is one token, one
 * amount and one passkey sheet: prepare, the person's stamp, confirm. The rules are `model.ts`'s.
 *
 * A native `<dialog>` (`use-dialog.ts`). The passkey sheet opens above it as its own dialog, a
 * sibling, so its Escape is its own; while it is up the modal is inert behind it.
 */
export function WalletsModal({
  open,
  wallets,
  openOn,
  draft,
  preview,
  onClose,
  onCredits,
  onMoved,
}: WalletsModalProps) {
  const titleId = useId();
  const [moving, setMoving] = useState<{ walletId: string; toAgent: boolean } | null>(null);
  const [token, setToken] = useState<Token>("AUSD");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [phase, setPhase] = useState<SheetPhase>("idle");
  /* A new object per request, so asking for the same wallet twice focuses it twice. */
  const [focusOn, setFocusOn] = useState<{ walletId: string } | null>(null);
  const sheetBusy = pending !== null && phase === "busy";
  const { ref: dialog, onKeyDown, onCancel } = useDialog({ open, busy: sheetBusy, onClose });
  /* A transfer is in flight: a second press starts nothing. */
  const running = useRef(false);
  /* The wallet whose move just went through: its "Fund from master" takes the focus back. */
  const refocus = useRef<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (copiedTimer.current) {
        clearTimeout(copiedTimer.current);
      }
    };
  }, []);

  /* Each opening starts clean, on the wallet it was opened on (set while rendering, not in an
     effect, so the first frame is already the right one). */
  const [shown, setShown] = useState<{ open: boolean; openOn: string | null }>({
    open: false,
    openOn: null,
  });
  if (shown.open !== open || shown.openOn !== openOn) {
    setShown({ open, openOn });
    if (open) {
      setMoving(openOn ? { walletId: openOn, toAgent: true } : null);
      setToken("AUSD");
      setAmount("");
      setError("");
      setFocusOn(openOn ? { walletId: openOn } : null);
    }
  }

  /* A form a press (or the opening) just showed: its amount takes the focus. */
  useEffect(() => {
    const input = focusOn
      ? dialog.current?.querySelector<HTMLInputElement>(`[data-amount="${focusOn.walletId}"]`)
      : null;
    input?.focus();
    input?.scrollIntoView({ block: "nearest" });
  }, [focusOn, dialog]);

  /* After "Moved" the form is gone; the focus goes to that wallet's first action, not the page. */
  useEffect(() => {
    if (pending || !refocus.current) {
      return;
    }
    const walletId = refocus.current;
    refocus.current = null;
    dialog.current?.querySelector<HTMLButtonElement>(`[data-fund="${walletId}"]`)?.focus();
  }, [pending, dialog]);

  function pick(walletId: string, toAgent: boolean) {
    setMoving({ walletId, toAgent });
    setAmount("");
    setError("");
    setFocusOn({ walletId });
  }

  function copy(address: string) {
    navigator.clipboard?.writeText(address).then(
      () => {
        if (!mounted.current) {
          return;
        }
        setCopied(address);
        if (copiedTimer.current) {
          clearTimeout(copiedTimer.current);
        }
        copiedTimer.current = setTimeout(() => setCopied(null), COPIED_MS);
      },
      () => undefined,
    );
  }

  async function sign() {
    if (!pending || running.current || preview) {
      return;
    }
    running.current = true;
    setPhase("busy");
    setError("");
    let stamped = false;
    try {
      // Every transfer body goes through toTransferBody (moveBody): the server does not trim.
      const body = moveBody(pending.move, pending.amount);
      const unsigned = await transferPrepare(body);
      const signed = await stampActivity(await relyingParty(), unsigned);
      stamped = true;
      await transferConfirm(body, signed);
    } catch (caught) {
      if (!mounted.current) {
        running.current = false;
        return;
      }
      if (caught instanceof Error && CLOSED_PROMPT.has(caught.name)) {
        running.current = false;
        setPhase("err");
        return;
      }
      if (errorCode(caught) !== "TRANSFER_ALREADY_RECORDED") {
        running.current = false;
        setPending(null);
        setPhase("idle");
        setError(failure(caught, stamped));
        if (stamped) {
          onMoved();
        }
        return;
      }
      // Already recorded: the first confirm went through. It is done.
    }
    if (!mounted.current) {
      running.current = false;
      return;
    }
    setPhase("ok");
    setTimeout(() => {
      running.current = false;
      if (!mounted.current) {
        return;
      }
      refocus.current = pending.move.walletId;
      setPending(null);
      setPhase("idle");
      setMoving(null);
      setAmount("");
      onMoved();
    }, DONE_MS);
  }

  function closeSheet() {
    if (sheetBusy || phase === "ok") {
      return;
    }
    setPending(null);
    setPhase("idle");
  }

  return (
    <>
      <dialog
        ref={dialog}
        className={styles.modal}
        // A dialog sits under the body, outside the screen's surface; it names the dark one.
        data-surface="dark"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        onCancel={onCancel}
        onClick={(event) => {
          // The backdrop: the dialog itself, outside its card.
          if (event.target === event.currentTarget && !sheetBusy) {
            onClose();
          }
        }}
      >
        <div className={styles.modalCard}>
          <div className={styles.modalHead}>
            <span className={styles.tabs}>
              <button type="button" className={styles.tab} aria-current="true">
                Wallets
              </button>
              <button type="button" className={styles.tab} onClick={onCredits}>
                AI credits
              </button>
            </span>
            <button
              type="button"
              className={styles.modalClose}
              aria-label="Close"
              onClick={onClose}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
          <h2 className={styles.modalTitle} id={titleId}>
            YOUR WALLETS<span>.</span>
          </h2>
          <p className={styles.modalLead}>
            One master wallet funds everything. Each agent gets its own, capped by its brief. All on
            Monad testnet, all behind your passkey.
          </p>
          {!wallets ? (
            <p className={styles.modalLead} role="status">
              Reading your wallets…
            </p>
          ) : (
            <>
              <div className={styles.walletBox} data-master="true">
                <div className={styles.walletBoxHead}>
                  <span className={`${shell.swatch} ${styles.masterMark}`} aria-hidden="true">
                    <i data-swatch="lime" />
                    <i data-swatch="violet" />
                    <i data-swatch="amber" />
                    <i data-swatch="blue" />
                  </span>
                  <span className={styles.walletBoxName}>
                    <b>Master wallet</b>
                    <small title={wallets.master.address}>{wallets.master.address}</small>
                  </span>
                  <span className={styles.walletTag} data-tone="good">
                    FUNDS AGENTS
                  </span>
                  <button
                    type="button"
                    className={styles.chipButton}
                    aria-label={
                      copied === wallets.master.address
                        ? "Master address copied"
                        : "Copy the master address"
                    }
                    onClick={() => copy(wallets.master.address)}
                  >
                    {copied === wallets.master.address ? "COPIED" : "COPY"}
                  </button>
                </div>
                <div className={styles.tiles}>
                  <span className={styles.tile}>
                    <b>{formatUnits(unitsOf(wallets.master.ausdMicro), "AUSD")}</b>
                    <small>AUSD</small>
                  </span>
                  <span className={styles.tile}>
                    <b>{formatUnits(unitsOf(wallets.master.monWei), "MON")}</b>
                    <small>MON · GAS</small>
                  </span>
                </div>
              </div>

              <span className={styles.listTitle}>AGENT WALLETS · {wallets.agents.length}</span>
              {wallets.agents.length === 0 && (
                <div className={styles.walletBox}>
                  <div className={styles.walletBoxHead}>
                    <span className={styles.walletBoxName}>
                      <b>
                        {draft?.name.trim() || "Your new agent"} <i>· agent wallet</i>
                      </b>
                      <small>No wallet yet · create it in the Studio</small>
                    </span>
                    <span className={styles.walletTag} data-tone="quiet">
                      NO WALLET
                    </span>
                  </div>
                </div>
              )}
              {wallets.agents.map((agent) => {
                const name = walletName(agent, draft);
                const isOpen = moving?.walletId === agent.walletId;
                const toAgent = isOpen ? (moving?.toAgent ?? true) : true;
                const move: Move = { walletId: agent.walletId, toAgent, token };
                const held = moveSource(wallets, move);
                const input = { amount, token, toAgent, held, agentName: name };
                const label = transferLabel(input);
                const ok = canMove(input);
                const over = label.startsWith("More");
                const mine = draft?.walletId === agent.walletId ? draft : null;
                return (
                  <div key={agent.walletId} className={styles.walletBox}>
                    <div className={styles.walletBoxHead}>
                      {mine ? (
                        <span
                          className={styles.walletMark}
                          data-accent="true"
                          style={accentVars(mine.accent)}
                          aria-hidden="true"
                        >
                          <AvatarGrid pattern={mine.pattern} small />
                        </span>
                      ) : (
                        <span className={styles.walletMark} aria-hidden="true">
                          {name.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span className={styles.walletBoxName}>
                        <b>
                          {name} <i>· agent wallet</i>
                        </b>
                        <small title={agent.address}>{agent.address}</small>
                      </span>
                      <span
                        className={styles.walletTag}
                        data-tone={agent.agentId ? undefined : "quiet"}
                      >
                        {agentWalletTag(agent)}
                      </span>
                      <button
                        type="button"
                        className={styles.chipButton}
                        aria-label={
                          copied === agent.address
                            ? `${name}'s address copied`
                            : `Copy ${name}'s address`
                        }
                        onClick={() => copy(agent.address)}
                      >
                        {copied === agent.address ? "COPIED" : "COPY"}
                      </button>
                    </div>
                    <div className={styles.tiles}>
                      <span className={styles.tile}>
                        <b>{formatUnits(unitsOf(agent.ausdMicro), "AUSD")}</b>
                        <small>AUSD · TRADES</small>
                      </span>
                      <span className={styles.tile}>
                        <b>{formatUnits(unitsOf(agent.monWei), "MON")}</b>
                        <small>MON · GAS</small>
                      </span>
                    </div>
                    {agent.caps && (
                      <div className={styles.row}>
                        <small>CAPS · TRADE / DAY / LEV</small>
                        <b>{`${agent.caps.perTradeAusd} / ${agent.caps.perDayAusd} / ${agent.caps.maxLeverage}×`}</b>
                      </div>
                    )}
                    <div className={styles.moveButtons}>
                      <button
                        type="button"
                        className={styles.direction}
                        data-fund={agent.walletId}
                        aria-pressed={isOpen && toAgent}
                        disabled={preview}
                        onClick={() => pick(agent.walletId, true)}
                      >
                        <Icon name="arrowUp" size={12} />
                        Fund from master
                      </button>
                      <button
                        type="button"
                        className={styles.direction}
                        aria-pressed={isOpen && !toAgent}
                        disabled={preview}
                        onClick={() => pick(agent.walletId, false)}
                      >
                        <Icon name="arrowDown" size={12} />
                        Pull back to master
                      </button>
                    </div>
                    {isOpen && (
                      <div className={styles.move}>
                        <div className={styles.moveRow}>
                          <Segmented
                            label="Token"
                            className={styles.tokenSwitch}
                            options={TOKENS}
                            value={token}
                            onChange={(next: Token) => {
                              setToken(next);
                              setAmount("");
                            }}
                          />
                          <span className={styles.amountField} data-bad={over}>
                            <input
                              type="text"
                              inputMode="decimal"
                              aria-label={`Amount in ${token}`}
                              placeholder="0"
                              data-amount={agent.walletId}
                              value={amount}
                              onChange={(event) =>
                                setAmount(event.target.value.replace(/[^0-9.]/g, ""))
                              }
                            />
                            <button
                              type="button"
                              className={styles.chipButton}
                              aria-label={`Fill all the ${token} the source holds`}
                              disabled={held === null}
                              onClick={() => setAmount(exactUnits(held, token))}
                            >
                              MAX
                            </button>
                            <small>{token}</small>
                          </span>
                        </div>
                        <div className={styles.moveButtons}>
                          <Button
                            block
                            disabled={!ok || preview}
                            onClick={() =>
                              setPending({
                                move,
                                amount,
                                copy: moveSheetCopy({
                                  amount,
                                  token,
                                  toAgent,
                                  agentName: name,
                                  address: agent.address,
                                }),
                              })
                            }
                          >
                            {label}
                          </Button>
                          <Button variant="ghost" onClick={() => setMoving(null)}>
                            Cancel
                          </Button>
                        </div>
                        <span className={styles.moveNote}>
                          {moveNote({ toAgent, held, token })}
                        </span>
                        {error && (
                          <p className={styles.alert} role="alert">
                            <Icon name="alert" size={13} />
                            {error}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </dialog>
      <PasskeySheet
        open={pending !== null}
        title={pending?.copy.title ?? ""}
        body={pending?.copy.body ?? ""}
        done={pending?.copy.done ?? ""}
        phase={phase}
        twoStep={false}
        step={1}
        onContinue={() => void sign()}
        onClose={closeSheet}
      />
    </>
  );
}

/* Only our own words reach the screen: the studio's message for a code, else what is known. */
function failure(caught: unknown, stamped: boolean): string {
  if (caught instanceof SessionExpired) {
    return "Your sign-in expired. Sign in again; nothing moved.";
  }
  if (caught instanceof StudioError && caught.message) {
    return caught.message;
  }
  return stamped
    ? "It may not have gone through. Your wallets are being read again."
    : "It did not go through. Nothing moved.";
}
