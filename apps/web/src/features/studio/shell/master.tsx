"use client";
import { useEffect, useRef, useState } from "react";
import { accentVars } from "@/lib/accent";
import type { Agent } from "../api";
import { formatUnits, unitsOf } from "../new-agent/model";
import type { UseAgentStudio } from "./use-agent-studio";
import { useCopied } from "./use-copied";
import { VIEW_ONLY_FUNDS, ledgerRows, type AllocationRow } from "./wallet-model";
import type { StudioIdPrefix } from "./model";
import styles from "./cards.module.css";
import shell from "./shell.module.css";

export interface MasterCardProps {
  /** `draft` or `live`: the card is `#<idPrefix>-master-wallet`. */
  idPrefix: StudioIdPrefix;
  agent: Agent;
  /** `GET /wallets`; null until read (dashes). */
  wallets: UseAgentStudio["wallets"];
  /** The person may change this workspace; a view-only member sees the fund button shut, with why. */
  canManage: boolean;
  /** The signed-in account's handle, which the head names ("MASTER WALLET · @nightowl"). */
  accountHandle: string | null;
  /** The head in place of "MASTER WALLET · @handle" (the live canvas's "YOURS · MASTER · @…"). */
  label?: string;
  /** The allocation as the studio's canvas draws it. */
  allocation: AllocationRow[];
  /** The card's first action: "Move to an agent" on a draft, "Fund {name}" on a public agent. */
  fundLabel: string;
  /** Open "Your wallets": its list, or this agent's move form. */
  onFund(): void;
  /** "Buy AI credits" beside it (the credits modal). */
  onCredits?(): void;
  /** "Deposit · copy address" beside it, which copies master's address and says so a moment. */
  deposit?: { label: string; copied: string };
  /**
   * The COPY chip beside the address (default true). The live canvas draws the address without it,
   * because its Deposit already copies the address.
   */
  copyChip?: boolean;
}

export interface MasterProps extends Omit<MasterCardProps, "wallets"> {
  /** The studio's data: the wallets, and the ledger with its lazy read. */
  studio: Pick<UseAgentStudio, "wallets" | "ledger" | "preview" | "readLedger">;
  /** The clock times are read against: the fixture's on a stage, the wall clock otherwise. */
  now: number;
}

/**
 * Master wallet (draft canvas 806–833, spec D17; studio-live-v1 L20), one implementation for both
 * studios: the card (`MasterCard`) beside the ledger of the person's transfers (`Ledger`). The
 * draft draws it whole; the live studio draws the two pieces with its agent's wallet between them.
 * The section's frame is the studio's own.
 */
export function Master({ studio, now, ...card }: MasterProps) {
  return (
    <div className={styles.grid}>
      <MasterCard {...card} wallets={studio.wallets} />
      <Ledger idPrefix={card.idPrefix} agent={card.agent} studio={studio} now={now} />
    </div>
  );
}

/**
 * Master's card: its address and Copy, its AUSD and MON, the allocation each studio hands it, the
 * fund button (the Wallets modal) and, beside it, "Buy AI credits" (the credits modal) or
 * "Deposit · copy address".
 */
export function MasterCard({
  idPrefix,
  agent,
  wallets,
  canManage,
  accountHandle,
  label,
  allocation,
  fundLabel,
  onFund,
  onCredits,
  deposit,
  copyChip = true,
}: MasterCardProps) {
  const reasonId = `${idPrefix}-master-fund-reason`;
  const [copied, copy] = useCopied();
  const [deposited, copyForDeposit] = useCopied();
  const master = wallets?.master ?? null;
  const mineAccent = accentVars(agent.accent);

  return (
    <div className={styles.master} id={`${idPrefix}-master-wallet`}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardLabel}>
          {label ?? `MASTER WALLET${accountHandle ? ` · @${accountHandle}` : ""}`}
        </h3>
        <span className={styles.passkey}>PASSKEY</span>
      </div>
      <div className={styles.address}>
        <span className={styles.addressText} title={master?.address}>
          {master?.address ?? "—"}
        </span>
        {master && copyChip && (
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
          className={styles.fund}
          aria-disabled={!canManage || undefined}
          aria-describedby={canManage ? undefined : reasonId}
          title={canManage ? undefined : VIEW_ONLY_FUNDS}
          onClick={() => {
            if (canManage) {
              onFund();
            }
          }}
        >
          {fundLabel}
        </button>
        {onCredits && (
          <button type="button" className={styles.darkButton} onClick={onCredits}>
            Buy AI credits
          </button>
        )}
        {deposit && (
          <button
            type="button"
            className={styles.darkButton}
            disabled={!master}
            onClick={() => {
              if (master) {
                copyForDeposit(master.address);
              }
            }}
          >
            {deposited ? deposit.copied : deposit.label}
          </button>
        )}
        {/* What the Deposit copied, said once (its label changes, which is not announced). */}
        {deposit && (
          <span className={shell.srOnly} role="status">
            {deposited ? deposit.copied : ""}
          </span>
        )}
        {!canManage && (
          <span id={reasonId} className={shell.srOnly}>
            {VIEW_ONLY_FUNDS}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The ledger of the person's transfers, read the first time it is drawn (`studio.readLedger`) and
 * again with every `studio.refresh`, which a transfer from the Wallets modal runs. A transfer's dot
 * is this agent's accent when it moved this agent's money, as the canvas draws it.
 */
export function Ledger({
  idPrefix,
  agent,
  studio,
  now,
}: {
  /** The list is `#<idPrefix>-master-ledger`. */
  idPrefix: StudioIdPrefix;
  agent: Agent;
  studio: Pick<UseAgentStudio, "ledger" | "preview" | "readLedger">;
  now: number;
}) {
  const { ledger, preview, readLedger } = studio;

  /* The ledger is read once, when it is first drawn; a stage already holds its own. */
  const asked = useRef(false);
  /* Set once the read came back: a ledger still null then is one that could not be read. */
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    if (ledger === null && !preview && !asked.current) {
      asked.current = true;
      void readLedger().finally(() => setAnswered(true));
    }
  }, [ledger, preview, readLedger]);

  const rows = ledger ? ledgerRows(ledger, new Date(now)) : null;
  let unread = "Reading your transfers…";
  if (preview) {
    unread = "No moves yet.";
  } else if (answered) {
    unread = "Couldn't read your transfers.";
  }

  const mineAccent = accentVars(agent.accent);

  return (
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
  );
}
