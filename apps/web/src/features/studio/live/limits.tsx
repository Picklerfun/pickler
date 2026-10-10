"use client";
import { useState } from "react";
import Image from "next/image";
import { Chip, Field, Icon, Input } from "@pickler/ui";
import { errorCode } from "../api";
import { useStudioMemory } from "../routing/memory";
import { shortAddress } from "../new-agent/model";
import { ArrivalList, useArrivals } from "../shell/arrivals";
import { CapSteppers } from "../shell/build-parts";
import {
  SaveOutcome,
  saveLabel,
  useSavedForm,
  useSetupSave,
  type SaveState,
} from "../shell/setup-save";
import { useCopied } from "../shell/use-copied";
import {
  VIEW_ONLY_FUNDS,
  VIEW_ONLY_REASON,
  capsPatch,
  limitsWallet,
  pullReason,
} from "./build-model";
import {
  advicePriceLocks,
  advicePriceOutcome,
  advicePriceView,
  priceFormDirty,
  savedPriceForm,
  type PriceForm,
} from "./advice-price-model";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { liveCaps, liveCapsStepper, liveWalletRead, pullNote, type LiveCaps } from "./model";
import { Reason } from "./reason";
import { paperShown, runtimeCapsView, runtimeOn } from "./runtime-model";
import styles from "./build.module.css";

/**
 * Limits (canvas 456–498, spec L12). Left, its wallet: NO WITHDRAWALS, the address, AUSD · FREE,
 * AUSD · IN POSITIONS (0), MON · GAS, what arrived between two reads, "Add funds to agent" and
 * "Return funds to master wallet" (the Wallets modal on this wallet). Right, the five caps, saved, not
 * signed: "Save caps" and "Discard", one `PUT /setup` with `caps`, and the line that says who
 * holds them. With the Perpl runtime on, the day-loss line and that note say what runs now
 * (`runtimeCapsView`, perpl-paper-runtime-v1 R11). Under the wallet, ANALYSES IN THE APP: the
 * price of one analysis bought in the app, saved with `PUT /advice-price` (`AdvicePriceCard`).
 */
export function Limits({ agent, live, canManage, onWallets }: LiveSectionProps) {
  const { caps: savedCaps, defaults } = liveCaps(agent);
  const [caps, setCaps] = useSavedForm<LiveCaps>(
    agent.version,
    savedCaps,
    `${agent.productId ?? agent.id}:limits:form`,
  );
  const { state, save, touch, saving } = useSetupSave(
    live,
    `${agent.productId ?? agent.id}:limits`,
    agent.version,
  );
  const stepper = liveCapsStepper(caps, savedCaps, defaults);
  const view = runtimeOn(live.record) ? runtimeCapsView(stepper) : stepper;
  const canSave = canManage && view.canSave && !saving;

  return (
    <LiveSection section="limits">
      <div className={styles.grid}>
        <div className={styles.column}>
          <WalletCard agent={agent} live={live} canManage={canManage} onWallets={onWallets} />
          <AdvicePriceCard agent={agent} live={live} canManage={canManage} />
        </div>
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

/**
 * ANALYSES IN THE APP (agent-advice phase 2): the AUSD price of one analysis, or not for sale.
 * Saved by `PUT /advice-price`, which carries no version, so the card keeps its own outcome
 * instead of the `PUT /setup` hook's. Without a wallet the price cannot be set, only cleared.
 */
function AdvicePriceCard({
  agent,
  live,
  canManage,
}: Pick<LiveSectionProps, "agent" | "live" | "canManage">) {
  const memory = useStudioMemory();
  const scope = `${agent.productId ?? agent.id}:advice`;
  const saved = savedPriceForm(agent);
  const [form, setForm] = useSavedForm<PriceForm>(agent.version, saved, `${scope}:form`);
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const view = advicePriceView(agent, form, canManage);
  const locks = advicePriceLocks(agent, form, canManage);
  const saving = state.kind === "saving";
  const canSave = view.canSave && !saving;

  /* The memory compares raw text; the card compares prices. When the card sees no edit ("1.50" for
     a saved 1.5, or text hidden by the toggle), the memory is told so too, so leaving does not
     warn, while the field keeps what was typed. */
  const edit = (next: PriceForm) => {
    setForm(next);
    if (!priceFormDirty(agent, next)) {
      memory.committed(scope);
    }
    setState({ kind: "idle" });
  };

  const save = async () => {
    if (!canSave || view.body === null) {
      return;
    }
    setState({ kind: "saving" });
    memory.begin(scope);
    try {
      await live.saveAdvicePrice(view.body);
      /* Not dirty any more: the form follows the reloaded price, and leaving asks nothing. */
      memory.committed(scope);
      setState({ kind: "saved" });
    } catch (caught) {
      setState(advicePriceOutcome(errorCode(caught)));
    } finally {
      memory.end(scope);
    }
  };

  return (
    <div className={styles.card} data-dirty={view.dirty} id="live-limits-advice">
      <div className={styles.cardHead}>
        <h3 className={styles.cardLabel}>ANALYSES IN THE APP</h3>
        <span className={styles.headTag} data-tone={view.tone}>
          {view.tag}
        </span>
      </div>
      <p className={styles.cardNote}>{view.note}</p>
      {view.walletLine && <p className={styles.hint}>{view.walletLine}</p>}
      <Chip
        className={styles.saleChip}
        selected={form.forSale}
        aria-disabled={locks.toggle || saving || undefined}
        aria-describedby={view.disabledReason ? "live-advice-reason" : undefined}
        title={view.disabledReason ?? undefined}
        onClick={() => {
          if (!locks.toggle && !saving) {
            edit({ ...form, forSale: !form.forSale });
          }
        }}
      >
        For sale
      </Chip>
      {form.forSale && (
        <Field label="PRICE PER ANALYSIS" htmlFor="live-advice-price">
          <Input
            id="live-advice-price"
            aria-labelledby="live-advice-price-label"
            aria-describedby={view.inputError ? "live-advice-price-error" : undefined}
            inputMode="decimal"
            mono
            prefix="AUSD"
            placeholder="1.50"
            invalid={view.inputError !== null}
            disabled={locks.input || saving}
            value={form.text}
            onChange={(event) => edit({ ...form, text: event.target.value })}
          />
        </Field>
      )}
      {view.inputError && (
        <p className={styles.alert} role="alert" id="live-advice-price-error">
          <Icon name="alert" size={12} />
          {view.inputError}
        </p>
      )}
      {(view.dirty || state.kind !== "idle") && (
        <div className={styles.saveRow}>
          <button
            type="button"
            className={styles.saveButton}
            aria-disabled={!canSave || undefined}
            aria-describedby={view.disabledReason ? "live-advice-reason" : undefined}
            title={view.disabledReason ?? undefined}
            onClick={() => void save()}
          >
            {saveLabel(state, view.dirty, "Save price")}
          </button>
          {view.dirty && (
            <button
              type="button"
              className={styles.discardButton}
              aria-disabled={!canManage || saving || undefined}
              onClick={() => {
                if (canManage && !saving) {
                  edit(saved);
                }
              }}
            >
              Discard
            </button>
          )}
        </div>
      )}
      {view.disabledReason && (
        <p className={styles.hint} id="live-advice-reason">
          {view.disabledReason}
        </p>
      )}
      <SaveOutcome state={state} />
    </div>
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
          <h3 className={styles.cardLabel}>AGENT WALLET</h3>
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
        <h3 className={styles.cardLabel}>AGENT WALLET</h3>
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
          Add funds to agent
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
          Return funds to master wallet
        </button>
        <Reason id="live-fund-reason" text={canManage ? null : VIEW_ONLY_FUNDS} />
        <Reason id="live-pull-reason" text={pullShut} />
      </div>
      <span className={styles.hint} data-align="center">
        {pullNote(paperShown(live.record))}
      </span>
    </div>
  );
}
