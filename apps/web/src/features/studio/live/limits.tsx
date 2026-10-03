"use client";
import Image from "next/image";
import { useState } from "react";
import { Icon } from "@pickler/ui";
import type { StudioWallets } from "../api";
import { arrived, shortAddress } from "../new-agent/model";
import { agentWalletRead, readClock } from "../shell/build-model";
import { CapSteppers } from "../shell/build-parts";
import { SaveOutcome, saveLabel, useSavedForm, useSetupSave } from "../shell/setup-save";
import { useCopied } from "../shell/use-copied";
import { useVersionedStudio } from "./brief";
import { capsPatch, limitsWallet, liveCapsView } from "./build-model";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { PULL_NOTE, liveCaps, liveWalletRead, type LiveCaps } from "./model";
import styles from "./build.module.css";

/**
 * Limits (canvas 456–498, spec L12). Left, its wallet: NO WITHDRAWALS, the address, AUSD · FREE,
 * AUSD · IN POSITIONS (0), MON · GAS, what arrived between two reads, "Fund from master" and
 * "Pull free AUSD back" (the Wallets modal on this wallet). Right, the five caps, saved, not
 * signed: "Save caps" and "Discard", one `PUT /setup` with `caps`, and the line that says who
 * holds them.
 */
export function Limits({ agent, live, canManage, onWallets }: LiveSectionProps) {
  const { caps: savedCaps, defaults } = liveCaps(agent);
  const [caps, setCaps] = useSavedForm<LiveCaps>(agent.version, savedCaps);
  const studio = useVersionedStudio(live);
  const { state, save, touch, saving } = useSetupSave(studio);
  const view = liveCapsView(caps, savedCaps, defaults);
  const canSave = canManage && view.canSave && !saving;

  return (
    <LiveSection section="limits">
      <div className={styles.grid}>
        <WalletCard agent={agent} live={live} canManage={canManage} onWallets={onWallets} />
        <div className={styles.card} data-dirty={view.dirty} id="live-limits-caps">
          <div className={styles.cardHead}>
            <h3 className={styles.cardLabel}>HARD CAPS</h3>
            <span className={styles.headTag} data-tone={view.dirty ? "caution" : "good"}>
              {view.tag}
            </span>
          </div>
          <p className={styles.cardNote}>{view.note}</p>
          <CapSteppers
            view={view}
            layout="rows"
            disabled={!canManage || saving}
            onChange={(next) => {
              setCaps(next);
              touch();
            }}
          />
          {view.inverted && (
            <p className={styles.alert} role="alert">
              <Icon name="alert" size={12} />A day&apos;s cap can&apos;t be below one trade&apos;s.
            </p>
          )}
          {(view.dirty || defaults || state.kind !== "idle") && (
            <div className={styles.saveRow}>
              <button
                type="button"
                className={styles.saveButton}
                disabled={!canManage}
                aria-disabled={!canSave || undefined}
                onClick={() => {
                  if (canSave) {
                    void save({ caps: capsPatch(caps) });
                  }
                }}
              >
                {saveLabel(state, view.dirty, "Save caps")}
              </button>
              {view.dirty && (
                <button
                  type="button"
                  className={styles.discardButton}
                  disabled={!canManage || saving}
                  onClick={() => {
                    setCaps(savedCaps);
                    touch();
                  }}
                >
                  Discard
                </button>
              )}
            </div>
          )}
          <SaveOutcome state={state} />
        </div>
      </div>
    </LiveSection>
  );
}

/** What arrived between two reads of this wallet, newest first. */
interface Arrivals {
  /** The read the list was last compared against. */
  seen: StudioWallets | null;
  list: { text: string; at: string }[];
}

function WalletCard({
  agent,
  live,
  canManage,
  onWallets,
}: Pick<LiveSectionProps, "agent" | "live" | "canManage" | "onWallets">) {
  const wallet = agent.wallet;
  const [copied, copy] = useCopied();

  /* Every new read of the wallets, a transfer's or a refresh's, is compared with the one before
     it (`arrived`): a balance that grew is news, stamped with the read's time. */
  const [arrivals, setArrivals] = useState<Arrivals>({ seen: live.wallets, list: [] });
  if (live.wallets !== arrivals.seen) {
    const before = wallet ? agentWalletRead(arrivals.seen, wallet.walletId) : null;
    const after = wallet ? agentWalletRead(live.wallets, wallet.walletId) : null;
    const found =
      before && after && live.wallets ? arrived(before, after, readClock(live.wallets.readAt)) : [];
    setArrivals({ seen: live.wallets, list: [...found, ...arrivals.list] });
  }

  if (!wallet) {
    return (
      <div className={styles.card} id="live-limits-wallet">
        <div className={styles.cardHead}>
          <h3 className={styles.cardLabel}>ITS WALLET</h3>
        </div>
        <p className={styles.cardNote}>This agent has no wallet of its own.</p>
      </div>
    );
  }

  const view = limitsWallet(liveWalletRead(wallet, live.wallets));

  return (
    <div className={styles.card} id="live-limits-wallet">
      <div className={styles.cardHead}>
        <h3 className={styles.cardLabel}>ITS WALLET</h3>
        <span className={styles.headTag}>NO WITHDRAWALS</span>
      </div>
      <div className={styles.walletRow}>
        <Image className={styles.walletMark} src="/brand/monad.png" alt="" width={30} height={30} />
        <span className={styles.walletAddress} title={wallet.address}>
          {shortAddress(wallet.address)}
        </span>
        <button
          type="button"
          className={styles.copyChip}
          aria-label={copied ? "Address copied" : "Copy its address"}
          onClick={() => copy(wallet.address)}
        >
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
      <div className={styles.balances}>
        <span className={styles.balance}>
          <span className={styles.balanceValue}>{view.free}</span>
          <span className={styles.balanceLabel}>AUSD · FREE</span>
        </span>
        <span className={styles.balance}>
          <span className={styles.balanceValue}>{view.inPositions}</span>
          <span className={styles.balanceLabel}>AUSD · IN POSITIONS</span>
        </span>
        <span className={styles.balance}>
          <span className={styles.balanceValue} data-low={view.gasLow}>
            {view.mon}
          </span>
          <span className={styles.balanceLabel}>MON · GAS</span>
        </span>
      </div>
      {arrivals.list.length > 0 && (
        <ol className={styles.arrivals} aria-label="Arrived">
          {arrivals.list.map((entry, index) => (
            <li key={`${entry.at}-${entry.text}-${index}`} className={styles.arrival}>
              <span className={styles.arrivalDot} aria-hidden="true" />
              <span className={styles.arrivalText}>{entry.text}</span>
              <span className={styles.arrivalAt} suppressHydrationWarning>
                {entry.at}
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className={styles.pair}>
        <button
          type="button"
          className={styles.fundButton}
          disabled={!canManage}
          onClick={() => onWallets(true)}
        >
          Fund from master
        </button>
        <button
          type="button"
          className={styles.pullButton}
          disabled={!canManage || !view.canPull}
          title={view.canPull ? undefined : "No free AUSD to pull back"}
          onClick={() => onWallets(false)}
        >
          Pull free AUSD back
        </button>
      </div>
      <span className={styles.hint} data-align="center">
        {PULL_NOTE}
      </span>
    </div>
  );
}
