"use client";
import Image from "next/image";
import { Icon } from "@pickler/ui";
import { shortAddress } from "../new-agent/model";
import { ArrivalList, useArrivals } from "../shell/arrivals";
import { CapSteppers } from "../shell/build-parts";
import { SaveOutcome, saveLabel, useSavedForm, useSetupSave } from "../shell/setup-save";
import { useCopied } from "../shell/use-copied";
import {
  VIEW_ONLY_FUNDS,
  VIEW_ONLY_REASON,
  capsPatch,
  limitsWallet,
  pullReason,
} from "./build-model";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { PULL_NOTE, liveCaps, liveCapsStepper, liveWalletRead, type LiveCaps } from "./model";
import { Reason } from "./reason";
import { runtimeCapsView, runtimeOn } from "./runtime-model";
import styles from "./build.module.css";

/**
 * Limits (canvas 456–498, spec L12). Left, its wallet: NO WITHDRAWALS, the address, AUSD · FREE,
 * AUSD · IN POSITIONS (0), MON · GAS, what arrived between two reads, "Fund from master" and
 * "Pull free AUSD back" (the Wallets modal on this wallet). Right, the five caps, saved, not
 * signed: "Save caps" and "Discard", one `PUT /setup` with `caps`, and the line that says who
 * holds them. With the Perpl runtime on, the day-loss line and that note say what runs now
 * (`runtimeCapsView`, perpl-paper-runtime-v1 R11).
 */
export function Limits({ agent, live, canManage, onWallets }: LiveSectionProps) {
  const { caps: savedCaps, defaults } = liveCaps(agent);
  const [caps, setCaps] = useSavedForm<LiveCaps>(agent.version, savedCaps);
  const { state, save, touch, saving } = useSetupSave(live);
  const stepper = liveCapsStepper(caps, savedCaps, defaults);
  const view = runtimeOn(live.record) ? runtimeCapsView(stepper) : stepper;
  const canSave = canManage && view.canSave && !saving;

  return (
    <LiveSection section="limits">
      <div className={styles.grid}>
        <WalletCard agent={agent} live={live} canManage={canManage} onWallets={onWallets} />
        <div className={styles.card} data-dirty={view.dirty} id="live-limits-caps">
          <div className={styles.cardHead}>
            <h3 className={styles.cardLabel}>CAPS</h3>
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
                aria-disabled={!canSave || undefined}
                aria-describedby={canManage ? undefined : "live-caps-reason"}
                title={canManage ? undefined : VIEW_ONLY_REASON}
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
                  aria-disabled={!canManage || saving || undefined}
                  onClick={() => {
                    if (canManage && !saving) {
                      setCaps(savedCaps);
                      touch();
                    }
                  }}
                >
                  Discard
                </button>
              )}
              <Reason id="live-caps-reason" text={canManage ? null : VIEW_ONLY_REASON} />
            </div>
          )}
          <SaveOutcome state={state} />
        </div>
      </div>
    </LiveSection>
  );
}

function WalletCard({
  agent,
  live,
  canManage,
  onWallets,
}: Pick<LiveSectionProps, "agent" | "live" | "canManage" | "onWallets">) {
  const wallet = agent.wallet;
  const [copied, copy] = useCopied();

  /* Every new read of the wallets, a transfer's or a refresh's, is compared with the one before it. */
  const arrivals = useArrivals(live.wallets, wallet?.walletId ?? null);

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
  const pullShut = pullReason(canManage, view.canPull);

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
      <ArrivalList arrivals={arrivals} radius="md" />
      <div className={styles.pair}>
        <button
          type="button"
          className={styles.fundButton}
          aria-disabled={!canManage || undefined}
          aria-describedby={canManage ? undefined : "live-fund-reason"}
          title={canManage ? undefined : VIEW_ONLY_FUNDS}
          onClick={() => {
            if (canManage) {
              onWallets(true);
            }
          }}
        >
          Fund from master
        </button>
        <button
          type="button"
          className={styles.pullButton}
          aria-disabled={pullShut !== null || undefined}
          aria-describedby={pullShut ? "live-pull-reason" : undefined}
          title={pullShut ?? undefined}
          onClick={() => {
            if (!pullShut) {
              onWallets(false);
            }
          }}
        >
          Pull free AUSD back
        </button>
        <Reason id="live-fund-reason" text={canManage ? null : VIEW_ONLY_FUNDS} />
        <Reason id="live-pull-reason" text={pullShut} />
      </div>
      <span className={styles.hint} data-align="center">
        {PULL_NOTE}
      </span>
    </div>
  );
}
