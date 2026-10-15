"use client";

import { ActionButton, type ActionButtonState } from "@pickler/ui";
import type { WalletFailure } from "@/features/wallet/lib/wallet-request-error";
import styles from "./public-trade-action.module.css";

export type TradeActionState =
  | "ready"
  | "preparing"
  | "wallet"
  | "approval"
  | "trade"
  | "pending"
  | "unknown"
  | "success"
  | "error"
  | "review";

interface Props {
  state: TradeActionState;
  label: string;
  hint?: string | undefined;
  failure?: WalletFailure | null | undefined;
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
}

const HINTS: Record<string, string> = {
  "Public trading is not enabled on this deployment yet.": "Trading is not available yet",
  "This token is not confirmed for trading.": "Token confirmation is missing",
  "Too many requests. Try again later.": "Too many requests · try later",
  "The curve is complete. DEX trading is not connected yet.":
    "Curve complete · DEX trading pending",
  "Your wallet does not have enough of the selected asset.": "Not enough funds in your wallet",
  "Your wallet needs MON for gas.": "Add MON to your wallet for gas",
  "This amount is too small.": "Enter a larger amount",
  "This purchase exceeds the remaining curve supply.": "Lower the amount to fit the curve",
  "Contract verification failed. Trading is unavailable.": "Contract verification failed",
  "Could not read the network. No swap was sent.": "Network unavailable · no swap sent",
  "Could not complete the wallet request. Your amount is kept.":
    "Wallet request failed · amount kept",
  "Could not prepare the trade. No swap was sent.": "Quote unavailable · no swap sent",
  "Transaction failed. No swap completed.": "Transaction failed · no swap completed",
  "Could not finish checking this transaction. Its hash is kept.":
    "Network unavailable · transaction saved",
  "The quote does not match this trade.": "Quote changed · prepare again",
};

export function PublicTradeAction({ state, label, hint, failure, disabled, busy, onClick }: Props) {
  const feedback: ActionButtonState =
    state === "error" || state === "unknown" || state === "success" || state === "wallet"
      ? state
      : ["preparing", "approval", "trade"].includes(state)
        ? "working"
        : state === "pending"
          ? "waiting"
          : "ready";
  const visibleHint = hint?.startsWith("Signature cancelled")
    ? undefined
    : (HINTS[hint ?? ""] ?? hint);
  return (
    <div className={styles.action} data-state={state}>
      <ActionButton
        state={feedback}
        label={label}
        hint={visibleHint}
        icon={label.startsWith("Cancelled") ? "x" : "arrow"}
        disabled={disabled}
        busy={busy}
        onClick={onClick}
      />
      {failure && !busy && (
        <details className={styles.failure}>
          <summary>
            {failure.title}
            {failure.code !== null ? ` · ${failure.code}` : ""}
          </summary>
          <p>{failure.detail}</p>
          <small>Wallet request · {failure.method}</small>
        </details>
      )}
    </div>
  );
}
