"use client";
import { StudioSkeleton } from "../skeleton";
import { useEffect, useId, useRef, useState } from "react";
import { Button, Icon, Skeleton, Tag } from "@pickler/ui";
import { networkByChainId } from "@pickler/chain";
import type { StudioWallets } from "../api";
import shell from "../studio.module.css";
import { AgentWalletBox } from "./agent-wallet-box";
import { formatUnits, unitsOf, type Accent, type Token } from "./model";
import { PasskeySheet } from "./passkey-sheet";
import { cleanAmount, maxAmount, moveSheetCopy, walletName } from "./transfer-model";
import { useDialog } from "./use-dialog";
import { useTransfer } from "./use-transfer";
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
  /** Open with this agent wallet's move form showing. */
  openOn: string | null;
  /** The direction of that form: toward the agent (the default), or back to master. */
  openToAgent?: boolean | undefined;
  draft: WalletsDraft | null;
  preview: boolean;
  onClose(): void;
  /** The canvas's "AI credits" tab. */
  onCredits(): void;
  /** Read balances through the owning screen; false retains the last known data. */
  onRefresh(): Promise<boolean>;
  /** A transfer went through, or may have: read the wallets again. */
  onMoved(): void;
}

const COPIED_MS = 1400;

/**
 * "Your wallets" (canvas: Wallets · AI credits modal, spec §3.3): the master wallet and each agent
 * wallet (`agent-wallet-box.tsx`), with "Fund from master" and "Pull back to master" (D7, D12). A
 * move is one token, one amount and one passkey sheet (`use-transfer.ts`). The rules are
 * `transfer-model.ts`'s.
 *
 * A native `<dialog>` (`use-dialog.ts`). The passkey sheet opens above it as its own dialog, a
 * sibling, so its Escape is its own; while it is up the modal is inert behind it.
 */
export function WalletsModal({
  open,
  wallets,
  openOn,
  openToAgent = true,
  draft,
  preview,
  onClose,
  onCredits,
  onRefresh,
  onMoved,
}: WalletsModalProps) {
  const titleId = useId();
  const network = wallets?.chainId == null ? null : networkByChainId(wallets.chainId);
  let networkLabel = "NETWORK UNAVAILABLE";
  if (network) {
    networkLabel = network.testnet ? "MONAD TESTNET" : "MONAD MAINNET";
  }
  const [moving, setMoving] = useState<{ walletId: string; toAgent: boolean } | null>(null);
  const [token, setToken] = useState<Token>("AUSD");
  const [amount, setAmountText] = useState("");
  /* The amount is MAX's for MON, which kept the gas reserve back: the note says so. */
  const [keptForGas, setKeptForGas] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const refreshPending = useRef(false);
  /* A new object per request, so asking for the same wallet twice focuses it twice. */
  const [focusOn, setFocusOn] = useState<{ walletId: string } | null>(null);
  /* The wallet whose move just went through: its "Fund from master" takes the focus back. */
  const refocus = useRef<string | null>(null);
  const transfer = useTransfer({
    preview,
    onMoved,
    onDone: (walletId) => {
      refocus.current = walletId;
      setMoving(null);
      setAmount("");
    },
  });
  const {
    ref: dialog,
    onKeyDown,
    onCancel,
  } = useDialog({
    open,
    busy: transfer.busy,
    onClose,
  });
  /* The press that ends in a click on the backdrop started there too: a drag out of the amount
     field that is released outside the card does not close the modal. */
  const downOnBackdrop = useRef(false);
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
  const [shown, setShown] = useState<{
    open: boolean;
    openOn: string | null;
    openToAgent: boolean;
  }>({
    open: false,
    openOn: null,
    openToAgent: true,
  });
  if (shown.open !== open || shown.openOn !== openOn || shown.openToAgent !== openToAgent) {
    setShown({ open, openOn, openToAgent });
    if (open) {
      setMoving(openOn ? { walletId: openOn, toAgent: openToAgent } : null);
      setToken("AUSD");
      setAmount("");
      transfer.setError("");
      setRefreshError("");
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
    if (transfer.pending || !refocus.current) {
      return;
    }
    const walletId = refocus.current;
    refocus.current = null;
    dialog.current?.querySelector<HTMLButtonElement>(`[data-fund="${walletId}"]`)?.focus();
  }, [transfer.pending, dialog]);

  function setAmount(value: string, max: { token: Token } | null = null) {
    setAmountText(value);
    setKeptForGas(max?.token === "MON");
  }

  function pick(walletId: string, toAgent: boolean) {
    setMoving({ walletId, toAgent });
    setAmount("");
    transfer.setError("");
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

  async function refreshBalances() {
    if (preview || transfer.busy || refreshPending.current) {
      return;
    }
    refreshPending.current = true;
    setRefreshing(true);
    setRefreshError("");
    try {
      if (!(await onRefresh()) && mounted.current) {
        setRefreshError(
          "Could not refresh your balances. Last known balances are shown. Try again.",
        );
      }
    } catch {
      if (mounted.current) {
        setRefreshError(
          "Could not refresh your balances. Last known balances are shown. Try again.",
        );
      }
    } finally {
      refreshPending.current = false;
      if (mounted.current) {
        setRefreshing(false);
      }
    }
  }

  const selectedAgent = moving
    ? wallets?.agents.find((agent) => agent.walletId === moving.walletId)
    : null;
  const focused = Boolean(selectedAgent);
  const selectedName = selectedAgent ? walletName(selectedAgent, draft) : "";
  const visibleAgents = selectedAgent ? [selectedAgent] : (wallets?.agents ?? []);

  return (
    <>
      <dialog
        ref={dialog}
        id="new-agent-wallets"
        className={styles.modal}
        // A dialog sits under the body, outside the screen's surface; it names the dark one.
        data-surface="dark"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        onCancel={onCancel}
        onPointerDown={(event) => {
          downOnBackdrop.current = event.target === event.currentTarget;
        }}
        onClick={(event) => {
          // The backdrop: the dialog itself, outside its card, pressed and released there.
          const onBackdrop = downOnBackdrop.current && event.target === event.currentTarget;
          downOnBackdrop.current = false;
          if (onBackdrop && !transfer.busy) {
            onClose();
          }
        }}
      >
        <div className={styles.modalCard}>
          <div className={styles.modalHead}>
            {focused ? (
              <Button variant="ghost" size="sm" onClick={() => setMoving(null)}>
                <Icon name="arrowLeft" size={14} /> All wallets
              </Button>
            ) : (
              <span className={styles.tabs} role="group" aria-label="Wallets and AI credits">
                <span className={styles.tab} aria-current="true">
                  Wallets
                </span>
                <button type="button" className={styles.tab} onClick={onCredits}>
                  AI credits
                </button>
              </span>
            )}
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
            {focused ? (moving?.toAgent ? `Fund ${selectedName}` : "Return funds") : "Your wallets"}
            <span>.</span>
          </h2>
          <p className={styles.modalLead}>
            {focused
              ? "Review the source and destination, choose an asset, then authorize with your passkey."
              : "Your wallet holds your funds. Each agent has a separate wallet with its own balance and limits."}
          </p>
          <div className={styles.walletRefresh}>
            <Tag className={styles.walletNetwork}>
              {wallets === null ? <Skeleton /> : networkLabel}
            </Tag>
            <Button
              variant="secondary"
              size="sm"
              aria-label="Refresh balances"
              aria-busy={refreshing}
              disabled={preview || refreshing || transfer.busy}
              onClick={() => void refreshBalances()}
            >
              <Icon name="refresh" size={14} />
              <span className={styles.refreshLabel}>
                {refreshing ? <Skeleton /> : "Refresh balances"}
              </span>
            </Button>
            <span className={styles.srOnly} role="status">
              {refreshing ? "Refreshing wallet balances" : ""}
            </span>
          </div>
          {network && (
            <p className={styles.networkNote}>
              Balances and transfers on {network.name}. Fund these wallets on this network only.
            </p>
          )}
          {wallets !== null && network === null && (
            <p className={styles.alert} role="alert">
              The wallet network could not be confirmed. Refresh before transferring funds.
            </p>
          )}
          {refreshError && (
            <p className={styles.alert} role="alert">
              {refreshError}
            </p>
          )}
          <span className={styles.srOnly} role="status">
            {copied ? "Address copied" : ""}
          </span>
          {!wallets ? (
            <StudioSkeleton variant="wallet" />
          ) : (
            <>
              {!focused && (
                <div className={styles.walletBox} data-master="true">
                  <div className={styles.walletBoxHead}>
                    <span className={`${shell.swatch} ${styles.masterMark}`} aria-hidden="true">
                      <i data-swatch="lime" />
                      <i data-swatch="violet" />
                      <i data-swatch="amber" />
                      <i data-swatch="blue" />
                    </span>
                    <span className={styles.walletBoxName}>
                      <b>Your wallet</b>
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
                          ? "Your wallet address copied"
                          : "Copy your wallet address"
                      }
                      onClick={() => copy(wallets.master.address)}
                    >
                      {copied === wallets.master.address ? "COPIED" : "COPY"}
                    </button>
                  </div>
                  <div className={styles.tiles}>
                    <span className={styles.tile}>
                      <b>
                        {refreshing ? (
                          <Skeleton className={styles.balancePlaceholder} />
                        ) : (
                          formatUnits(unitsOf(wallets.master.ausdMicro), "AUSD")
                        )}
                      </b>
                      <small>AUSD</small>
                    </span>
                    <span className={styles.tile}>
                      <b>
                        {refreshing ? (
                          <Skeleton className={styles.balancePlaceholder} />
                        ) : (
                          formatUnits(unitsOf(wallets.master.monWei), "MON")
                        )}
                      </b>
                      <small>MON · GAS</small>
                    </span>
                  </div>
                </div>
              )}

              {!focused && (
                <span className={styles.listTitle}>AGENT WALLETS · {wallets.agents.length}</span>
              )}
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
              {visibleAgents.map((agent) => {
                const name = walletName(agent, draft);
                const isOpen = moving?.walletId === agent.walletId;
                return (
                  <AgentWalletBox
                    key={agent.walletId}
                    agent={agent}
                    wallets={wallets}
                    name={name}
                    avatar={draft?.walletId === agent.walletId ? draft : null}
                    moving={isOpen ? { toAgent: moving.toAgent } : null}
                    token={token}
                    amount={amount}
                    keptForGas={keptForGas}
                    error={isOpen ? transfer.error : ""}
                    copied={copied === agent.address}
                    preview={preview}
                    refreshing={refreshing}
                    networkKnown={network !== null}
                    onPick={(toAgent) => pick(agent.walletId, toAgent)}
                    onToken={(next) => {
                      setToken(next);
                      setAmount("");
                    }}
                    onAmount={(text) => setAmount(cleanAmount(text))}
                    onMax={(held) => setAmount(maxAmount(held, token), { token })}
                    onSend={(move) =>
                      transfer.start({
                        move,
                        amount,
                        copy: moveSheetCopy({
                          amount,
                          token,
                          toAgent: move.toAgent,
                          agentName: name,
                          address: agent.address,
                        }),
                      })
                    }
                    onCancel={() => setMoving(null)}
                    onCopy={() => copy(agent.address)}
                  />
                );
              })}
            </>
          )}
        </div>
      </dialog>
      <PasskeySheet
        open={transfer.pending !== null}
        title={transfer.pending?.copy.title ?? ""}
        body={transfer.pending?.copy.body ?? ""}
        done={transfer.pending?.copy.done ?? ""}
        phase={transfer.phase}
        twoStep={false}
        step={1}
        onContinue={() => void transfer.sign()}
        onClose={transfer.closeSheet}
      />
    </>
  );
}
