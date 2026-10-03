"use client";
import Image from "next/image";
import { useState } from "react";
import { useCopied } from "../shell/use-copied";
import { capsOf, starterCaps } from "./caps-model";
import type { DraftGoPublicStage } from "./fixture";
import { GoPublic } from "./go-public";
import { activityView, walletCardView } from "./model";
import { tradeCount, tradeRows } from "./runtime-model";
import { DraftSection, type DraftSectionProps } from "./draft-section";
import styles from "./draft.module.css";

export interface OverviewProps extends DraftSectionProps {
  /** Go Public's screen state on a `?stage=draft-x-*`, or null: the card starts closed. */
  goPublic: DraftGoPublicStage | null;
}

/**
 * Overview (canvas 339–441, spec §3.1): Go Public with Connect X (`go-public.tsx`,
 * `x-connect.tsx`); its wallet, read as Limits reads it, and the schedule, which unlocks with the
 * Perpl runtime (D19); its trades, the newest three paper positions as Trades lists them
 * (`runtime-model.ts`, perpl-paper-runtime-v1 R17), and its activity (D18), read from the API,
 * never made up, with Retry when the read failed.
 */
export function Overview({ goPublic, ...props }: OverviewProps) {
  const { agent, draft, canManage, now, onSection, onWallets } = props;
  const [copied, copy] = useCopied();
  const [retrying, setRetrying] = useState(false);

  const capsSource = {
    spend: agent.spend,
    configSpend: agent.config.spend,
    maxLeverage: agent.config.maxLeverage,
  };
  const wallet = walletCardView(
    agent.wallet,
    { caps: capsOf(capsSource), starter: starterCaps(capsSource) },
    draft.wallets,
  );
  const activity = draft.activity ? activityView(draft.activity, new Date(now)) : null;
  const trades = tradeRows(draft.positions).slice(0, 3);

  async function retryActivity() {
    if (retrying) {
      return;
    }
    setRetrying(true);
    try {
      await draft.readActivity();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <DraftSection section="overview">
      <div className={styles.overview}>
        <GoPublic
          agent={agent}
          draft={draft}
          canManage={canManage}
          onWallets={onWallets}
          stage={goPublic}
        />

        <div className={styles.stack}>
          <div className={styles.card} id="draft-overview-wallet">
            <div className={styles.cardHead}>
              <h3 className={styles.cardLabel}>ITS WALLET</h3>
              {wallet && <span className={styles.readyTag}>READY</span>}
            </div>
            {wallet ? (
              <>
                <div className={styles.walletRow}>
                  <Image
                    className={styles.walletMark}
                    src="/brand/monad.png"
                    alt=""
                    width={30}
                    height={30}
                  />
                  <span className={styles.walletText}>
                    <span className={styles.walletAddress} title={wallet.address}>
                      {wallet.short}
                    </span>
                    <span className={styles.walletCaps}>{wallet.caps}</span>
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
                    <span className={styles.balanceValue} data-funded={wallet.ausdFunded}>
                      {wallet.ausd}
                    </span>
                    <span className={styles.balanceLabel}>AUSD · TRADES</span>
                  </span>
                  <span className={styles.balance}>
                    <span className={styles.balanceValue} data-funded={wallet.monFunded}>
                      {wallet.mon}
                    </span>
                    <span className={styles.balanceLabel}>MON · GAS</span>
                  </span>
                </div>
                <div className={styles.pair}>
                  <button
                    type="button"
                    className={styles.whiteButton}
                    disabled={!canManage}
                    onClick={() => onWallets(true)}
                  >
                    Fund from master
                  </button>
                  <button
                    type="button"
                    className={styles.darkButton}
                    onClick={() => onSection("limits")}
                  >
                    Limits
                  </button>
                </div>
              </>
            ) : (
              <p className={styles.cardNote}>
                This draft was made before agents came with their own wallet, so it has none. It
                needs one to go public.
              </p>
            )}
          </div>

          <div className={styles.schedule}>
            <span className={styles.scheduleText}>
              <span className={styles.scheduleTitle}>
                Run on its own · every {agent.config.intervalHours}h
              </span>
              <span className={styles.scheduleNote}>Unlocks with the Perpl runtime.</span>
            </span>
            <span
              className={styles.switchOff}
              role="switch"
              aria-checked="false"
              aria-disabled="true"
              aria-label="Run on its own, unlocks with the Perpl runtime"
            >
              <span className={styles.switchKnob} />
            </span>
          </div>
        </div>

        <div className={styles.stack}>
          <div className={styles.list}>
            <div className={styles.listHead}>
              <h3 className={styles.listTitle}>Trades</h3>
              <span className={styles.cardCount}>{tradeCount(draft.positions)}</span>
            </div>
            {trades.length > 0 && (
              <ul className={styles.events} id="draft-overview-trades">
                {trades.map((row) => (
                  <li key={row.id} className={styles.event}>
                    <span className={styles.tradeDot} data-state={row.state} aria-hidden="true" />
                    <span className={styles.tradeTitle}>{row.title}</span>
                    <span className={styles.tradePnl} data-tone={row.pnl.tone}>
                      {row.state === "OPEN" ? `OPEN · ${row.pnl.text}` : row.pnl.text}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {trades.length === 0 && (
              <div className={styles.empty}>
                <span>Nothing yet. Run it on paper in the Console to see what it would do.</span>
                <button
                  type="button"
                  className={styles.whiteButton}
                  data-size="small"
                  onClick={() => onSection("console")}
                >
                  Open Console
                </button>
              </div>
            )}
          </div>
          <div className={styles.list} id="draft-overview-activity">
            <div className={styles.listHead}>
              <h3 className={styles.listTitle}>Activity</h3>
              {/* TODAY or the newest day, in local time: the server's zone may differ. */}
              <span className={styles.cardCount} suppressHydrationWarning>
                {activity?.label ?? ""}
              </span>
            </div>
            {activity === null && draft.activityFailed && (
              <div className={styles.readFailed} role="alert">
                <span>Couldn&apos;t read its activity.</span>
                <button
                  type="button"
                  className={styles.whiteButton}
                  data-size="small"
                  aria-disabled={retrying || undefined}
                  onClick={() => void retryActivity()}
                >
                  {retrying ? "Retrying…" : "Retry"}
                </button>
              </div>
            )}
            {activity === null && !draft.activityFailed && (
              <p className={styles.cardNote}>
                {draft.preview ? "Nothing yet." : "Reading its activity…"}
              </p>
            )}
            {activity?.rows.length === 0 && <p className={styles.cardNote}>Nothing yet.</p>}
            {activity && activity.rows.length > 0 && (
              <ol className={styles.events}>
                {activity.rows.map((row, index) => (
                  <li key={`${row.iso}-${index}`} className={styles.event}>
                    <span className={styles.eventDot} data-kind={row.kind} aria-hidden="true" />
                    <span className={styles.eventText}>{row.text}</span>
                    {/* Local time: the server's zone may differ from the browser's. */}
                    <time className={styles.eventAt} dateTime={row.iso} suppressHydrationWarning>
                      {row.at}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </DraftSection>
  );
}
