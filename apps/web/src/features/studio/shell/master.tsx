"use client";
import { useEffect, useRef, useState } from "react";
import { accentVars } from "@/lib/accent";
import type { Agent } from "../api";
import { formatUnits, unitsOf } from "../new-agent/model";
import type { UseAgentStudio } from "./use-agent-studio";
import { useCopied } from "./use-copied";
import { ledgerRows, type AllocationRow } from "./wallet-model";
import type { StudioIdPrefix } from "./model";
import styles from "./cards.module.css";

export interface MasterProps {
  /** `draft` or `live`: the card is `#<idPrefix>-master-wallet`, the ledger `#<idPrefix>-master-ledger`. */
  idPrefix: StudioIdPrefix;
  agent: Agent;
  /** The studio's data: the wallets, and the ledger with its lazy read. */
  studio: Pick<UseAgentStudio, "wallets" | "ledger" | "preview" | "readLedger">;
  /** The person may change this workspace; a view-only member sees the fund button shut. */
  canManage: boolean;
  /** The clock times are read against: the fixture's on a stage, the wall clock otherwise. */
  now: number;
  /** The signed-in account's handle, which the head names ("MASTER WALLET · @nightowl"). */
  accountHandle: string | null;
  /** The allocation as the studio's canvas draws it (the draft's `allocationRows`). */
  allocation: AllocationRow[];
  /** The card's first action: "Move to an agent" on a draft, "Fund {name}" on a public agent. */
  fundLabel: string;
  /** Open "Your wallets": its list, or this agent's move form. */
  onFund(): void;
  /** "Buy AI credits" beside it (the credits modal); left out, the fund button stands alone. */
  onCredits?(): void;
}

/**
 * Master wallet (draft canvas 806–833, spec D17; studio-live-v1 L20), one implementation for both
 * studios: its address and Copy, its AUSD and MON, the allocation each studio hands it, the fund
 * button (the Wallets modal), "Buy AI credits" (the credits modal), and the ledger of the person's
 * transfers, read the first time this section opens (`studio.readLedger`) and again with every
 * `studio.refresh`, which a transfer from the Wallets modal runs. A transfer's dot is this agent's
 * accent when it moved this agent's money, as the canvas draws it. The section's frame is the
 * studio's own.
 */
export function Master({
  idPrefix,
  agent,
  studio,
  canManage,
  now,
  accountHandle,
  allocation,
  fundLabel,
  onFund,
  onCredits,
}: MasterProps) {
  const { wallets, ledger, preview, readLedger } = studio;
  const [copied, copy] = useCopied();

  /* The ledger is read once, when Master wallet first opens; a stage already holds its own. */
  const asked = useRef(false);
  /* Set once the read came back: a ledger still null then is one that could not be read. */
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    if (ledger === null && !preview && !asked.current) {
      asked.current = true;
      void readLedger().finally(() => setAnswered(true));
    }
  }, [ledger, preview, readLedger]);

  const master = wallets?.master ?? null;
  const rows = ledger ? ledgerRows(ledger, new Date(now)) : null;
  let unread = "Reading your transfers…";
  if (preview) {
    unread = "No moves yet.";
  } else if (answered) {
    unread = "Couldn't read your transfers.";
  }

  const mineAccent = accentVars(agent.accent);

  return (
    <div className={styles.grid}>
      <div className={styles.master} id={`${idPrefix}-master-wallet`}>
        <div className={styles.cardHead}>
          <h3 className={styles.cardLabel}>
            MASTER WALLET{accountHandle ? ` · @${accountHandle}` : ""}
          </h3>
          <span className={styles.passkey}>PASSKEY</span>
        </div>
        <div className={styles.address}>
          <span className={styles.addressText} title={master?.address}>
            {master?.address ?? "—"}
          </span>
          {master && (
            <button
              type="button"
              className={styles.copyChip}
              aria-label={copied ? "Address copied" : "Copy the master wallet's address"}
              onClick={() => copy(master.address)}
            >
              {copied ? "COPIED" : "COPY"}
            </button>
          )}
        </div>
        <div className={styles.balances}>
          <span className={styles.balance}>
            <span className={styles.balanceValue}>
              {master ? formatUnits(unitsOf(master.ausdMicro), "AUSD") : "—"}
            </span>
            <span className={styles.balanceLabel}>AUSD · FREE</span>
          </span>
          <span className={styles.balance}>
            <span className={styles.balanceValue}>
              {master ? formatUnits(unitsOf(master.monWei), "MON") : "—"}
            </span>
            <span className={styles.balanceLabel}>MON · GAS</span>
          </span>
        </div>
        <ul className={styles.rows} aria-label="Allocation">
          {allocation.map((row) => {
            const mine = wallets?.agents.find((entry) => entry.walletId === row.key);
            const accent = mine && mine.walletId === agent.wallet?.walletId ? mineAccent : {};
            return (
              <li key={row.key} className={styles.allocation} style={accent}>
                <span className={styles.dot} data-kind={row.kind} aria-hidden="true" />
                <span className={styles.allocationLabel}>{row.label}</span>
                <span className={styles.allocationValue} data-soon={row.soon}>
                  {row.value}
                </span>
              </li>
            );
          })}
        </ul>
        <div className={styles.pair}>
          <button type="button" className={styles.fund} disabled={!canManage} onClick={onFund}>
            {fundLabel}
          </button>
          {onCredits && (
            <button type="button" className={styles.darkButton} onClick={onCredits}>
              Buy AI credits
            </button>
          )}
        </div>
      </div>

      <div className={styles.column} id={`${idPrefix}-master-ledger`}>
        <div className={styles.listHead}>
          <h3 className={styles.listTitle}>Ledger</h3>
          <span className={styles.listMeta}>EVERY MOVE · ON MONAD</span>
        </div>
        {rows === null && <p className={styles.quiet}>{unread}</p>}
        {rows?.length === 0 && <p className={styles.quiet}>No moves yet.</p>}
        {rows && rows.length > 0 && (
          <ol className={styles.rows}>
            {rows.map((row) => (
              <li
                key={row.key}
                className={styles.ledgerRow}
                style={row.agentName !== null && row.agentName === agent.name ? mineAccent : {}}
              >
                <span className={styles.dot} data-kind="transfer" aria-hidden="true" />
                <span className={styles.ledgerText}>
                  <span className={styles.ledgerTitle}>{row.text}</span>
                  <span className={styles.ledgerSub}>{row.sub}</span>
                </span>
                <span className={styles.ledgerAmount} data-in={row.toMaster}>
                  {row.amount}
                </span>
                {/* Local time: the server renders in its own zone. */}
                <time className={styles.ledgerAt} dateTime={row.iso} suppressHydrationWarning>
                  {row.at}
                </time>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
