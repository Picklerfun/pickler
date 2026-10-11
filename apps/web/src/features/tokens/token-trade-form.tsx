"use client";
import { Button, Field, Icon, Input, Segmented } from "@pickler/ui";
import { toBaseUnits } from "@pickler/chain";
import type { TokenOperationDto, TokenStateDto } from "@pickler/api-schema";
import { useStudioForm } from "../studio/routing/memory";
import styles from "./token.module.css";

export function TokenTradeForm({
  agentId,
  state,
  preview,
  disabled,
  pendingAction,
  prepare,
}: {
  agentId: string;
  state: TokenStateDto;
  preview: boolean;
  disabled: boolean;
  pendingAction: TokenOperationDto["action"] | null;
  prepare: (
    action: TokenOperationDto["action"],
    trade: { amount: string; slippageBps: number },
  ) => void;
}) {
  const [form, edit] = useStudioForm(`${agentId}:token:trade`, 0, {
    side: "buy" as "buy" | "sell",
    buyAmount: "1",
    sellAmount: "1000",
    slippage: "50",
  });
  const buying = form.side === "buy";
  const input = buying ? form.buyAmount : form.sellAmount;
  let amount: string | null = null;
  try {
    const atomic = toBaseUnits(input, buying ? 6 : 18);
    if (atomic > 0n && atomic < 2n ** 256n) {
      amount = atomic.toString();
    }
  } catch {
    // Keep the editable decimal string; no floating-point amount reaches the API.
  }
  if (state.venue?.status !== "curve") {
    return (
      <p className={styles.quiet}>
        {state.venue
          ? "Curve trading ends at graduation. DEX swaps are not connected yet."
          : "Trading venue is not confirmed yet."}
      </p>
    );
  }
  const asset = buying ? "AUSD" : state.token!.ticker;
  const approvalPending = pendingAction === (buying ? "approve_buy" : "approve_sell");
  const tradePending = pendingAction === form.side;
  function request(approval: boolean) {
    if (amount) {
      prepare(approval ? (buying ? "approve_buy" : "approve_sell") : form.side, {
        amount,
        slippageBps: Number(form.slippage),
      });
    }
  }
  return (
    <section className={styles.trade} aria-label="Trade token">
      <div className={styles.head}>
        <h4>Trade from master wallet</h4>
        <Segmented
          label="Trade side"
          value={form.side}
          disabled={disabled}
          options={[
            { value: "buy", label: "Buy" },
            { value: "sell", label: "Sell" },
          ]}
          onChange={(side) => edit({ ...form, side })}
        />
      </div>
      <Field
        label={`Amount · ${asset}`}
        note={preview ? "Fixed simulated amount" : `Up to ${buying ? 6 : 18} decimal places`}
      >
        <Input
          aria-label={`Amount · ${asset}`}
          inputMode="decimal"
          value={input}
          readOnly={preview}
          maxLength={80}
          disabled={disabled}
          invalid={!amount}
          onChange={(e) => edit({ ...form, [buying ? "buyAmount" : "sellAmount"]: e.target.value })}
        />
      </Field>
      <div className={styles.head}>
        <span className={styles.quiet}>Slippage limit</span>
        <Segmented
          label="Slippage limit"
          value={form.slippage}
          disabled={disabled || preview}
          options={[
            { value: "50", label: "0.5%" },
            { value: "100", label: "1%" },
          ]}
          onChange={(slippage) => edit({ ...form, slippage })}
        />
      </div>
      <div className={styles.actions}>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || !amount}
          onClick={() => request(true)}
        >
          {approvalPending && <Icon name="refresh" size={16} className={styles.spinner} />}
          {approvalPending ? "Preparing approval…" : `Approve ${asset} amount`}
        </Button>
        <Button size="sm" disabled={disabled || !amount} onClick={() => request(false)}>
          {tradePending && <Icon name="refresh" size={16} className={styles.spinner} />}
          {tradePending ? "Preparing trade…" : `Review ${form.side}`}
        </Button>
      </div>
      <p className={styles.exampleNote}>
        Approval only permits the exact amount. Review and sign the trade separately. Gas is paid in
        MON.
      </p>
    </section>
  );
}
