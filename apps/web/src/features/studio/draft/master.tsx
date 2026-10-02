"use client";
import { useEffect, useRef, useState } from "react";
import { accentVars } from "@/lib/accent";
import { formatUnits, unitsOf } from "../new-agent/model";
import { allocationRows, ledgerRows } from "./run-model";
import { DraftSection, type DraftSectionProps } from "./section";
import { useCopied } from "./use-copied";
import styles from "./run.module.css";

export interface MasterProps extends DraftSectionProps {
  /** The signed-in account's handle, which the head names ("MASTER WALLET · @nightowl"). */
  accountHandle: string | null;
}

/**
 * Master wallet (canvas 806–833, spec D17): its address and Copy, its AUSD and MON, the allocation
 * (free in master, each agent wallet, positions and AI credits Soon), "Move to an agent" (the
 * Wallets modal's list), "Buy AI credits" (the credits modal), and the ledger of the person's
 * transfers, read the first time this section opens (`draft.readLedger`) and again with every
 * `draft.refresh`, which a transfer from the Wallets modal runs. A transfer's dot is this agent's
 * accent when it moved this agent's money, as the canvas draws it.
 */
export function Master({
  agent,
  draft,
  canManage,
  now,
  onWallets,
  onCredits,
  accountHandle,
}: MasterProps) {
  const { wallets, ledger, preview, readLedger } = draft;
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
  const allocation = allocationRows(wallets);
  const rows = ledger ? ledgerRows(ledger, new Date(now)) : null;
  let unread = "Reading your transfers…";
  if (preview) {
    unread = "No moves yet.";
  } else if (answered) {
    unread = "Couldn't read your transfers.";
  }

  const mineAccent = accentVars(agent.accent);

  return (
    <DraftSection section="master">
      <div className={styles.grid}>
        <div className={styles.master} id="draft-master-wallet">
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
            <button
              type="button"
              className={styles.whiteButton}
              disabled={!canManage}
              onClick={() => onWallets(null)}
            >
              Move to an agent
            </button>
            <button type="button" className={styles.darkButton} onClick={onCredits}>
              Buy AI credits
            </button>
          </div>
        </div>

        <div className={styles.column} id="draft-master-ledger">
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
    </DraftSection>
  );
}
