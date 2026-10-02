"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Button, Icon } from "@pickler/ui";
import {
  MIN_START,
  balanceNote,
  formatUnits,
  funded,
  shortAddress,
  step0Copy,
  walletTag,
  type NewAgentForm,
  type WalletView,
} from "./model";
import type { Arrival } from "./wallet-reads";
import styles from "./new-agent.module.css";

export interface WalletPanelProps {
  wallet: WalletView | null;
  /** No delegated user yet: creating the wallet is two signatures. */
  firstTime: boolean;
  /**
   * The wallet exists but Pickler's delegated user does not (step 2 was cancelled): `wallet` is
   * null, and "Create its wallet" is step 2 only.
   */
  pendingDelegate: boolean;
  /** Named, a free handle and a voice, and the wallet is not funded: only the money is missing. */
  outlined: boolean;
  form: NewAgentForm;
  checkedAt: string;
  /**
   * A wallet read is in flight: the refresh button spins, and the buttons refuse a press through
   * aria-disabled, so the one that has the focus keeps it. Only the reads, never a passkey wait.
   */
  refreshing: boolean;
  arrivals: readonly Arrival[];
  /** A passkey is up: the panel's buttons are disabled. */
  busy: boolean;
  preview: boolean;
  onCreateWallet(): void;
  onRefresh(): void;
  onFund(): void;
}

const COPIED_MS = 1400;

/**
 * "Its wallet" (canvas: Studio · Agent wallet overview). Step 0 until the wallet and Pickler's
 * delegated user both exist, then the address, the balances against the minimums, the caps the
 * create sheet will set, what arrived, and "Fund from master wallet". The words are `model.ts`'s.
 */
export function WalletPanel({
  wallet,
  firstTime,
  pendingDelegate,
  outlined,
  form,
  checkedAt,
  refreshing,
  arrivals,
  busy,
  preview,
  onCreateWallet,
  onRefresh,
  onFund,
}: WalletPanelProps) {
  const [copied, setCopied] = useState(false);
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
  const isFunded = funded(wallet);
  /* What the harness proves: no wallet yet, one below either minimum, or one that can create. */
  const walletState = !wallet ? "none" : isFunded ? "funded" : "empty";
  const step0 = step0Copy({ firstTime, pendingDelegate });

  function copy(address: string) {
    navigator.clipboard?.writeText(address).then(
      () => {
        if (!mounted.current) {
          return;
        }
        setCopied(true);
        if (copiedTimer.current) {
          clearTimeout(copiedTimer.current);
        }
        copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
      },
      () => undefined,
    );
  }

  return (
    <aside className={styles.side} aria-label="Its wallet">
      <Image className={styles.mascot} src="/brand/mascot.webp" alt="" width={96} height={80} />
      <div
        className={styles.walletCard}
        id="new-agent-wallet"
        data-outline={outlined}
        data-state={walletState}
        data-funded={isFunded}
      >
        <div className={styles.walletHead}>
          <span className={styles.walletTitle}>ITS WALLET</span>
          <span className={styles.walletTag} data-tone={isFunded ? "good" : "caution"}>
            {wallet ? walletTag(wallet) : step0.tag}
          </span>
        </div>
        {!wallet ? (
          <div className={styles.step0} id="new-agent-wallet-step0">
            <div className={styles.step0Head}>
              <span className={styles.step0Mark} aria-hidden="true">
                {pendingDelegate ? <Icon name="check" size={14} /> : "?"}
              </span>
              <span className={styles.step0Text}>
                <b>{pendingDelegate ? "Step 2 left" : "No wallet yet"}</b>
                <small>ITS OWN KEYS · ITS OWN CAPS</small>
              </span>
            </div>
            <p className={styles.step0Note}>{step0.note}</p>
            {step0.steps.length > 0 && (
              <ol className={styles.step0Steps}>
                {step0.steps.map((step) => (
                  <li key={step.n} data-done={step.done}>
                    <span aria-hidden="true">
                      {step.done ? <Icon name="check" size={10} /> : step.n}
                    </span>
                    {step.text}
                    {step.done && <span className={styles.srOnly}> · done</span>}
                  </li>
                ))}
              </ol>
            )}
            <Button
              block
              disabled={busy || preview}
              aria-disabled={refreshing || undefined}
              onClick={() => {
                if (!refreshing) {
                  onCreateWallet();
                }
              }}
            >
              <Icon name="key" size={15} />
              {step0.cta}
            </Button>
          </div>
        ) : (
          <div className={styles.walletBody}>
            <div className={styles.address}>
              <Image
                src="/brand/monad.png"
                alt=""
                width={30}
                height={30}
                className={styles.monad}
              />
              <span className={styles.addressText}>
                <b title={wallet.address}>{shortAddress(wallet.address)}</b>
                <small>AGENT WALLET · PICKLER MAY TRADE</small>
              </span>
              <button
                type="button"
                className={styles.chipButton}
                aria-label={copied ? "Address copied" : "Copy the address"}
                onClick={() => copy(wallet.address)}
              >
                {copied ? "COPIED" : "COPY"}
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Refresh balance"
                title="Refresh balance · if you sent AUSD from elsewhere"
                aria-busy={refreshing}
                aria-disabled={refreshing || undefined}
                disabled={busy || preview}
                onClick={() => {
                  if (!refreshing) {
                    onRefresh();
                  }
                }}
              >
                <Icon name="refresh" size={14} />
              </button>
            </div>
            <div className={styles.tiles}>
              <span className={styles.tile}>
                <b data-good={(wallet.ausdMicro ?? 0n) >= MIN_START.ausdMicro}>
                  {formatUnits(wallet.ausdMicro, "AUSD")}
                </b>
                <small>AUSD · TRADES</small>
              </span>
              <span className={styles.tile}>
                <b data-good={(wallet.monWei ?? 0n) >= MIN_START.monWei}>
                  {formatUnits(wallet.monWei, "MON")}
                </b>
                <small>MON · GAS</small>
              </span>
            </div>
            <div className={styles.row}>
              <small>CAPS · TRADE / DAY / LEV</small>
              <b>{`${form.perTrade} / ${form.perDay} / ${form.leverage}×`}</b>
            </div>
            <span className={styles.balanceNote} role="status">
              {balanceNote(wallet, checkedAt)}
            </span>
            {!isFunded && (
              <div className={styles.row} data-tone="caution">
                <small>MIN TO START</small>
                <b>
                  {formatUnits(MIN_START.ausdMicro, "AUSD")} <i>AUSD</i> ·{" "}
                  {formatUnits(MIN_START.monWei, "MON")} <i>MON</i>
                </b>
              </div>
            )}
            {arrivals.map((arrival) => (
              <div key={arrival.id} className={styles.arrival}>
                <i aria-hidden="true" />
                <span>{arrival.text}</span>
                <small>{arrival.at}</small>
              </div>
            ))}
            {!isFunded && (
              <>
                <Button variant="secondary" block disabled={preview} onClick={onFund}>
                  <Icon name="wallet" size={14} />
                  Fund from master wallet
                </Button>
                <span className={styles.fundNote}>
                  ONE PASSKEY PER TOKEN · OR SEND TO THE ADDRESS FROM ANY MONAD WALLET, THEN REFRESH
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
