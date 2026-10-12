"use client";

import { useId } from "react";
import { Button, Icon } from "@pickler/ui";
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

export function PublicTradeAction({ state, label, hint, disabled, busy, onClick }: Props) {
  const description = useId();
  const failed = state === "error" || state === "unknown";
  const spinning = ["preparing", "approval", "trade"].includes(state);
  let icon: "arrow" | "wallet" | "clock" | "check" | "alert" | "x" = "arrow";
  if (state === "wallet") {
    icon = "wallet";
  } else if (state === "success") {
    icon = "check";
  } else if (state === "pending") {
    icon = "clock";
  } else if (failed) {
    icon = label.startsWith("Cancelled") ? "x" : "alert";
  }
  const visibleHint = hint?.startsWith("Signature cancelled")
    ? undefined
    : (HINTS[hint ?? ""] ?? hint);
  return (
    <div className={styles.action} data-state={state}>
      <Button
        block
        className={styles.button}
        disabled={disabled}
        aria-label={label}
        aria-describedby={hint ? description : undefined}
        aria-busy={busy}
        onClick={onClick}
      >
        {busy && <span className={styles.sweep} aria-hidden="true" />}
        <span key={`${state}.${label}`} className={styles.content} aria-hidden="true">
          <span className={styles.mark}>
            {spinning ? <span className={styles.ring} /> : <Icon name={icon} size={19} />}
          </span>
          <span className={styles.words}>
            <span>{label}</span>
            {visibleHint && <span className={styles.hint}>{visibleHint}</span>}
          </span>
        </span>
      </Button>
      <span className={styles.announcement} role="status" aria-atomic="true">
        {failed ? "" : label}
      </span>
      <span id={description} className={styles.announcement} role={failed ? "alert" : undefined}>
        {failed ? `${label}. ${hint ?? ""}` : hint}
      </span>
    </div>
  );
}
