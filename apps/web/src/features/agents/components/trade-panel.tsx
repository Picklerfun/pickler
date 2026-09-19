"use client";

import type { AgentProfileDto } from "@pickler/api-schema";
import { useState } from "react";
import { Button, Segmented, Chip } from "@pickler/ui";
import styles from "../agents.module.css";
import { useWallet } from "@/features/wallet/lib/wallet-context";
import { formatBalance, shortAddress, TARGET_CHAIN } from "@/features/wallet/lib/provider";
import { formatInteger, formatTokenPrice } from "../lib/format";
import { CurveProgress } from "./agent-parts";

const QUICK_AMOUNTS = [10, 25, 100, 250];

/**
 * Buy or sell the agent's token. Connecting a wallet works today, so the panel's first action is a
 * live one; the trade behind it does not, because the launcher contract is not deployed. The button
 * says which of the two is missing rather than sitting disabled for both reasons at once.
 */
export function TradePanel({ agent }: { agent: AgentProfileDto }) {
  const wallet = useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");

  const token = agent.token;
  const price = agent.market?.price ?? 0;
  const value = Number.parseFloat(amount);
  const entered = Number.isFinite(value) && value > 0;
  const graduated = token?.stage === "graduated";

  // Rough curve impact, only to show the direction of the move.
  const depth = graduated ? 160_000 : 3_400;
  const after = price * (1 + (side === "buy" ? 1 : -1) * ((entered ? value : 0) / depth));

  return (
    <section className={`${styles.panel} ${styles.tradePanel}`} aria-labelledby="trade-title">
      <h2 id="trade-title" className={styles.srOnly}>
        {graduated ? "Trade" : "Back"} {agent.name}
      </h2>

      <Segmented
        label="Side"
        tone="lime"
        className={styles.sideToggle}
        optionClassName={styles.sideButton}
        value={side}
        onChange={setSide}
        options={[
          { value: "buy", label: "Buy" },
          { value: "sell", label: "Sell" },
        ]}
      />

      <div className={styles.amountRow}>
        <input
          className={styles.amountInput}
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          placeholder="0"
          aria-label={`Amount in MON to ${side}`}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <span className={styles.unitChip}>MON</span>
      </div>

      <p className={styles.balanceRow}>
        {wallet.status !== "connected"
          ? "No wallet connected"
          : !wallet.onTargetChain
            ? `Wrong network · switch to ${TARGET_CHAIN.name}`
            : `${wallet.balance === null ? "—" : formatBalance(wallet.balance)} ${TARGET_CHAIN.nativeCurrency.symbol} · ${shortAddress(wallet.address!)}`}
      </p>

      {wallet.status === "connected" ? (
        !wallet.onTargetChain ? (
          <Button className={styles.ctaButton} block onClick={() => void wallet.switchChain()}>
            Switch to {TARGET_CHAIN.name}
          </Button>
        ) : (
          // Connected and on the right chain; what is missing now is the launcher contract.
          <Button className={styles.ctaButton} block disabled aria-describedby="trade-status">
            {side === "buy" ? (graduated ? "Buy" : "Back") : "Sell"} {agent.ticker}
          </Button>
        )
      ) : (
        <Button
          className={styles.ctaButton}
          block
          onClick={() => void wallet.connect()}
          disabled={wallet.status === "connecting" || wallet.status === "unsupported"}
          aria-describedby="trade-status"
        >
          {wallet.status === "connecting"
            ? "Waiting for your wallet…"
            : wallet.status === "unsupported"
              ? "No wallet found"
              : "Connect wallet"}
        </Button>
      )}

      <div className={styles.quickRow} role="group" aria-label="Amount">
        {QUICK_AMOUNTS.map((quick) => (
          <Chip key={quick} className={styles.quickButton} onClick={() => setAmount(String(quick))}>
            {quick}
          </Chip>
        ))}
      </div>

      <dl className={styles.quoteList}>
        <div className={styles.quoteRow}>
          <dt>{side === "buy" ? "You get" : "You sell"}</dt>
          <dd>{entered && price > 0 ? `${formatInteger(value / price)} ${agent.ticker}` : "—"}</dd>
        </div>
        <div className={styles.quoteRow}>
          <dt>{graduated ? "Pool price after" : "Curve price after"}</dt>
          <dd className={styles.quiet}>
            {entered && price > 0 ? `${formatTokenPrice(after)} MON` : "—"}
          </dd>
        </div>
      </dl>

      {token && token.stage !== "graduated" && (
        <div className={styles.curveBlock}>
          <p className={styles.curveHead}>
            <span>CURVE</span>
            <span className={styles.toneCurve}>
              {Math.round((token.raised / token.graduationTarget) * 100)}%
            </span>
          </p>
          <CurveProgress token={token} />
        </div>
      )}

      <p id="trade-status" className={styles.disclaimer}>
        {wallet.status === "connected"
          ? "Trading opens with the testnet contracts; your wallet is connected and nothing is charged today. Backing an agent is not a bet on a game — it is a bet on its record."
          : "Connect a wallet to back this agent. Trading opens with the testnet contracts, and backing an agent is not a bet on a game — it is a bet on its record."}
      </p>
    </section>
  );
}
