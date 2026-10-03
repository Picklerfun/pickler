"use client";
import Image from "next/image";
import { useState } from "react";
import { Icon } from "@pickler/ui";
import { formatUnits, shortAddress } from "../new-agent/model";
import { ArrivalList, useArrivals } from "../shell/arrivals";
import { agentWalletRead } from "../shell/build-model";
import { CapSteppers } from "../shell/build-parts";
import { SaveOutcome, saveLabel, useSavedForm, useSetupSave } from "../shell/setup-save";
import { useCopied } from "../shell/use-copied";
import { capsOf, capsStepper, checkedLabel, starterCaps } from "./caps-model";
import { DraftSection, type DraftSectionProps } from "./draft-section";
import styles from "./build.module.css";

/**
 * Limits & funding (canvas 479–526, spec §3.3, D11). Left, its wallet: the address, Refresh
 * (re-reads `GET /wallets`), AUSD and MON, when it was last read, what arrived between two reads,
 * and "Fund from master wallet". Right, the hard caps, saved through `draft.saveSetup`: Pickler
 * holds each trade to them, so the copy says so and nothing is signed (D11). Caps it was never
 * given read STARTER CAPS, as the canvas tags them, and Save writes them as they are.
 */
export function Limits({ agent, draft, canManage, onWallets }: DraftSectionProps) {
  const capsSource = {
    spend: agent.spend,
    configSpend: agent.config.spend,
    maxLeverage: agent.config.maxLeverage,
  };
  const savedCaps = capsOf(capsSource);
  const [caps, setCaps] = useSavedForm(agent.version, savedCaps);
  const { state, save, touch, saving } = useSetupSave(draft);
  const view = capsStepper(caps, savedCaps, starterCaps(capsSource));
  const canSave = canManage && view.canSave && !saving;

  return (
    <DraftSection section="limits">
      <div className={styles.limits}>
        <WalletCard agent={agent} draft={draft} canManage={canManage} onWallets={onWallets} />
        <div className={styles.card} id="draft-limits-caps">
          <div className={styles.cardHead}>
            <h3 className={styles.cardLabel}>CAPS</h3>
            <span className={styles.stateTag} data-dirty={view.dirty}>
              {view.tag}
            </span>
          </div>
          <p className={styles.cardNote}>
            Pickler holds every trade to these. On-chain caps come with live trading.
          </p>
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
          {(view.dirty || view.starter || state.kind !== "idle") && (
            <button
              type="button"
              className={styles.saveButton}
              data-wide="true"
              disabled={!canManage}
              aria-disabled={!canSave || undefined}
              onClick={() => {
                if (canSave) {
                  void save({ caps });
                }
              }}
            >
              {saveLabel(state, view.dirty, "Save caps")}
            </button>
          )}
          <SaveOutcome state={state} />
          <div className={styles.chips}>
            <span className={styles.chip} data-tone="lime">
              PERPL · MONAD
            </span>
            <span className={styles.chip} data-tone="magenta">
              NO WITHDRAWALS
            </span>
          </div>
        </div>
      </div>
    </DraftSection>
  );
}

function WalletCard({
  agent,
  draft,
  canManage,
  onWallets,
}: Pick<DraftSectionProps, "agent" | "draft" | "canManage" | "onWallets">) {
  const wallet = agent.wallet;
  const [copied, copy] = useCopied();
  const [refreshing, setRefreshing] = useState(false);

  /* Every new read of the wallets, Refresh's or a transfer's, is compared with the one before it. */
  const arrivals = useArrivals(draft.wallets, wallet?.walletId ?? null);

  if (!wallet) {
    return (
      <div className={styles.card} id="draft-limits-wallet">
        <div className={styles.cardHead}>
          <h3 className={styles.cardLabel}>ITS WALLET</h3>
        </div>
        <p className={styles.cardNote}>
          This draft was made before agents came with their own wallet, so it has none. It needs one
          to go public.
        </p>
      </div>
    );
  }

  const read = agentWalletRead(draft.wallets, wallet.walletId);
  const ausdMicro = read?.ausdMicro ?? BigInt(Math.round(wallet.balanceAusd * 1_000_000));
  const monWei = read?.monWei ?? null;

  async function refresh() {
    if (refreshing) {
      return;
    }
    setRefreshing(true);
    try {
      await draft.readWallets();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className={styles.card} id="draft-limits-wallet">
      <div className={styles.cardHead}>
        <h3 className={styles.cardLabel}>ITS WALLET</h3>
        <span className={styles.plainTag}>PICKLER MAY TRADE</span>
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
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Refresh its balance"
          aria-busy={refreshing}
          onClick={() => void refresh()}
        >
          <Icon name="refresh" size={13} />
        </button>
      </div>
      <div className={styles.balances}>
        <span className={styles.balance}>
          <span className={styles.balanceValue} data-funded={ausdMicro > 0n}>
            {formatUnits(ausdMicro, "AUSD")}
          </span>
          <span className={styles.balanceLabel}>AUSD · TRADES</span>
        </span>
        <span className={styles.balance}>
          <span className={styles.balanceValue} data-funded={monWei !== null && monWei > 0n}>
            {formatUnits(monWei, "MON")}
          </span>
          <span className={styles.balanceLabel}>MON · GAS</span>
        </span>
      </div>
      {/* Local time: the server's zone may differ from the browser's. */}
      <span className={styles.hint} data-tone="muted" suppressHydrationWarning>
        {checkedLabel(draft.wallets?.readAt ?? null, read)}
      </span>
      <ArrivalList arrivals={arrivals} radius="sm" />
      <button
        type="button"
        className={styles.fundButton}
        disabled={!canManage}
        onClick={() => onWallets(true)}
      >
        Fund from master wallet
      </button>
      <span className={styles.hint} data-align="center">
        ONE PASSKEY PER TOKEN · OR SEND TO THE ADDRESS FROM ANY MONAD WALLET
      </span>
    </div>
  );
}
