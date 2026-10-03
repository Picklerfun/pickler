"use client";
import { useState } from "react";
import { Icon } from "@pickler/ui";
import { useNow } from "@/lib/now";
import { VIEW_ONLY_REASON } from "./build-model";
import type { LiveSectionProps } from "./live-section";
import { Reason } from "./reason";
import {
  flatLine,
  manualCheckView,
  openPnlLabel,
  positionView,
  proposalView,
  proposalsSub,
  stopConfirm,
  type PositionView,
} from "./runtime-model";
import styles from "./runtime.module.css";

type Live = LiveSectionProps["live"];

/** A write's failure, said under the control pressed: the message, or nothing. */
function useActionError() {
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    }
  }
  return { error, run };
}

function ActionError({ text }: { text: string }) {
  if (!text) {
    return null;
  }
  return (
    <p className={styles.error} role="alert">
      <Icon name="alert" size={12} />
      {text}
    </p>
  );
}

/** The stop–target meter and its three labels (canvas 212–215, 251–254). */
function Meter({ view }: { view: PositionView }) {
  if (!view.meter) {
    return <p className={styles.meterNone}>NO STOP OR TARGET ON THIS POSITION</p>;
  }
  return (
    <div className={styles.meter}>
      <div className={styles.meterTrack} aria-hidden="true">
        <span
          className={styles.meterKnob}
          style={{ left: `${(view.meter.fill * 100).toFixed(1)}%` }}
        />
      </div>
      <div className={styles.meterLabels}>
        <span className={styles.meterStop}>{view.meter.stop}</span>
        <span className={styles.meterText}>{view.meter.text}</span>
        <span className={styles.meterTarget}>{view.meter.target}</span>
      </div>
    </div>
  );
}

/** "Close now": one click, no passkey (paper, R12); pending until the position is gone. */
function CloseNow({
  live,
  view,
  canManage,
}: {
  live: Live;
  view: PositionView;
  canManage: boolean;
}) {
  const { error, run } = useActionError();
  const closing = live.pending.some(
    (action) => action.kind === "close" && action.positionId === view.id,
  );
  const shut = !canManage || closing;
  const reasonId = `live-close-reason-${view.id}`;
  return (
    <>
      <button
        type="button"
        className={styles.darkButton}
        aria-disabled={shut || undefined}
        aria-busy={closing || undefined}
        aria-describedby={canManage ? undefined : reasonId}
        title={canManage ? undefined : VIEW_ONLY_REASON}
        onClick={() => {
          if (!shut) {
            void run(() => live.closePosition(view.id));
          }
        }}
      >
        {closing ? "Closing…" : "Close now"}
      </button>
      <Reason id={reasonId} text={canManage ? null : VIEW_ONLY_REASON} />
      {error && (
        <span className={styles.rowBreak}>
          <ActionError text={error} />
        </span>
      )}
    </>
  );
}

/**
 * The open positions as cards: Overview's compact one (canvas 209–217) or Positions' full one
 * (243–258) with the figures, the time stop, entry, mark and liquidation, and "Why this trade".
 */
export function PositionCards({
  live,
  now,
  canManage,
  full,
  paused,
  title,
  id,
  onWhy,
}: {
  live: Live;
  now: number;
  canManage: boolean;
  full: boolean;
  /** Entries are paused: the flat line says so. */
  paused: boolean;
  title: string;
  id: string;
  onWhy(checkId: string | null): void;
}) {
  const read = live.positions;
  const open = read && read !== "failed" ? read.open : [];
  return (
    <div className={styles.list} id={id}>
      <div className={styles.listHead}>
        <h3 className={styles.listTitle}>{title}</h3>
        <span className={styles.listMeta}>{read === "failed" ? "—" : openPnlLabel(open)}</span>
      </div>
      {read === "failed" && (
        <div className={styles.empty} role="alert">
          Couldn&apos;t read its positions.
          <button
            type="button"
            className={styles.inlineButton}
            onClick={() => void live.readRuntime()}
          >
            Retry
          </button>
        </div>
      )}
      {read !== "failed" && open.length === 0 && (
        <div className={styles.empty}>{flatLine(paused)}</div>
      )}
      {open.map((position) => {
        const view = positionView(position, now);
        return (
          <article
            key={view.id}
            className={styles.position}
            data-full={full}
            id={`live-position-${view.id}`}
          >
            <div className={styles.positionHead}>
              <span className={styles.side} data-long={view.long}>
                {view.side}
              </span>
              <span className={styles.market}>{view.market}</span>
              <span className={styles.pnl} data-tone={view.tone ?? undefined}>
                {view.pnl} AUSD
                {full && view.pnlPct && <span className={styles.pnlPct}> {view.pnlPct}</span>}
              </span>
            </div>
            {full ? (
              <div className={styles.figures}>
                <span className={styles.figure}>
                  <span className={styles.figureValue}>{view.size} AUSD</span>
                  <span className={styles.figureLabel}>IT PUT IN</span>
                </span>
                <span className={styles.figure}>
                  <span className={styles.figureValue}>{view.notional} AUSD</span>
                  <span className={styles.figureLabel}>
                    OF {view.asset} · {view.leverage}×
                  </span>
                </span>
                <span className={styles.figure}>
                  <span className={styles.figureValue} data-tone={view.tone ?? undefined}>
                    {view.worth} AUSD
                  </span>
                  <span className={styles.figureLabel}>WORTH NOW</span>
                </span>
              </div>
            ) : (
              <p className={styles.positionLine} suppressHydrationWarning>
                {view.line}
              </p>
            )}
            <Meter view={view} />
            {full && view.time && (
              <div className={styles.time}>
                <div className={styles.timeHead}>
                  <span suppressHydrationWarning>TIME STOP · {view.time.text}</span>
                  <span className={styles.timeCloses} suppressHydrationWarning>
                    CLOSES {view.time.closesAt}
                  </span>
                </div>
                <span className={styles.timeTrack} aria-hidden="true">
                  <span
                    className={styles.timeFill}
                    style={{ width: `${(view.time.fill * 100).toFixed(1)}%` }}
                  />
                </span>
              </div>
            )}
            {full && (
              <div className={styles.facts}>
                <span>ENTRY {view.entry}</span>
                <span>MARK {view.mark}</span>
                <span>LIQ {view.liq}</span>
              </div>
            )}
            <div className={styles.actions}>
              <CloseNow live={live} view={view} canManage={canManage} />
              {full && view.checkId && (
                <button
                  type="button"
                  className={styles.quietButton}
                  onClick={() => onWhy(view.checkId!)}
                >
                  Why this trade
                </button>
              )}
              <span className={styles.opened} suppressHydrationWarning>
                OPENED {view.opened}
                {full && view.decision ? ` · DECISION ${view.decision}` : ""}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** One proposal's Enter / Skip, each with its pending state and an inline failure. */
function ProposalActions({
  live,
  id,
  cta,
  skip,
  expired,
  canManage,
}: {
  live: Live;
  id: string;
  cta: string;
  skip: string;
  expired: boolean;
  canManage: boolean;
}) {
  const { error, run } = useActionError();
  const [skipping, setSkipping] = useState(false);
  const approving = live.pending.some(
    (action) => action.kind === "approve" && action.proposalId === id,
  );
  const shut = !canManage || approving || skipping || expired;
  const reasonId = `live-proposal-reason-${id}`;
  let reason: string | null = null;
  if (!canManage) {
    reason = VIEW_ONLY_REASON;
  } else if (expired) {
    reason = "It expired after 15 minutes.";
  }
  return (
    <>
      <div className={styles.proposalActions}>
        <button
          type="button"
          className={styles.limeButton}
          aria-disabled={shut || undefined}
          aria-busy={approving || undefined}
          aria-describedby={reason ? reasonId : undefined}
          title={reason ?? undefined}
          onClick={() => {
            if (!shut) {
              void run(() => live.approve(id));
            }
          }}
        >
          {approving ? "Entering…" : cta}
        </button>
        <button
          type="button"
          className={styles.skipButton}
          aria-disabled={shut || undefined}
          aria-busy={skipping || undefined}
          aria-describedby={reason ? reasonId : undefined}
          title={reason ?? undefined}
          onClick={() => {
            if (!shut) {
              setSkipping(true);
              void run(() => live.skip(id)).finally(() => setSkipping(false));
            }
          }}
        >
          {skipping ? "Skipping…" : skip}
        </button>
      </div>
      <Reason id={reasonId} text={reason} />
      <ActionError text={error} />
    </>
  );
}

/**
 * "Waiting on you" (canvas 178–203, R8): each pending proposal with what it puts in, the notional,
 * the check's entry lines, Enter / Skip (one tap, no passkey: paper) and a live countdown to its
 * expiry. Hidden with none, as before the runtime.
 */
export function ProposalCards({
  live,
  now,
  canManage,
}: {
  live: Live;
  now: number;
  canManage: boolean;
}) {
  /* The countdown ticks every second; a staged studio keeps its fixed clock. */
  const tick = useNow(1000);
  const clockNow = live.preview ? now : tick;
  const proposals = Array.isArray(live.proposals) ? live.proposals : [];
  if (proposals.length === 0) {
    return null;
  }
  const checks = Array.isArray(live.checks) ? live.checks : [];
  return (
    <div className={styles.list} id="live-overview-proposals">
      <div className={styles.listHead}>
        <h3 className={styles.listTitle}>Waiting on you</h3>
        <span className={styles.proposalSub}>{proposalsSub(proposals.length)}</span>
      </div>
      {proposals.map((proposal) => {
        const check = checks.find((candidate) => candidate.id === proposal.checkId) ?? null;
        const view = proposalView(proposal, clockNow, check);
        return (
          <article key={view.id} className={styles.proposal} id={`live-proposal-${view.id}`}>
            <div className={styles.proposalHead}>
              <span className={styles.proposalKind}>{view.head}</span>
              <span className={styles.proposalAt} suppressHydrationWarning>
                {view.at} · <span aria-live="off">{view.ttl}</span>
              </span>
            </div>
            <p className={styles.proposalTitle}>{view.title}</p>
            <div className={styles.figures} data-two="true">
              <span className={styles.figure}>
                <span className={styles.figureValue}>{view.putIn} AUSD</span>
                <span className={styles.figureLabel}>IT PUTS IN · PAPER</span>
              </span>
              <span className={styles.figure}>
                <span className={styles.figureValue}>{view.notional} AUSD</span>
                <span className={styles.figureLabel}>
                  OF {view.asset} · {view.leverage}×
                </span>
              </span>
            </div>
            <ul className={styles.why}>
              {view.why.map((line) => (
                <li key={line.key} className={styles.whyRow}>
                  <span className={styles.whyDot} data-tag={line.tag} aria-hidden="true" />
                  <span className={styles.whyText}>{line.text}</span>
                  <span className={styles.whyTag} data-tag={line.tag}>
                    {line.tag}
                  </span>
                </li>
              ))}
            </ul>
            <ProposalActions
              live={live}
              id={view.id}
              cta={view.cta}
              skip={view.skip}
              expired={view.expired}
              canManage={canManage}
            />
          </article>
        );
      })}
    </div>
  );
}

/**
 * "Stop · close all" on paper (R12): pressed, it asks inline; confirmed, it pauses the agent and
 * closes every paper position, no passkey. `id` keeps the header's and Controls' apart.
 */
export function StopAll({
  live,
  canManage,
  id,
  className,
}: {
  live: Live;
  canManage: boolean;
  id: string;
  /** The button's look where it sits (the header's pill, Controls' row button). */
  className: string | undefined;
}) {
  const [asking, setAsking] = useState(false);
  const { error, run } = useActionError();
  const stopping = live.pending.some((action) => action.kind === "stop");
  const shut = !canManage || stopping;
  const open = live.positions && live.positions !== "failed" ? live.positions.open.length : 0;
  const confirm = stopConfirm(open);
  const reasonId = `${id}-reason`;
  return (
    <div className={styles.stopAll}>
      <button
        type="button"
        className={className}
        id={id}
        aria-disabled={shut || undefined}
        aria-busy={stopping || undefined}
        aria-expanded={asking}
        aria-controls={`${id}-confirm`}
        aria-describedby={canManage ? undefined : reasonId}
        title={canManage ? undefined : VIEW_ONLY_REASON}
        onClick={() => {
          if (!shut) {
            setAsking(!asking);
          }
        }}
      >
        <Icon name="x" size={14} />
        {stopping ? "Stopping…" : "Stop · close all"}
      </button>
      <Reason id={reasonId} text={canManage ? null : VIEW_ONLY_REASON} />
      {asking && (
        <div
          className={styles.confirm}
          id={`${id}-confirm`}
          role="group"
          aria-label={confirm.title}
        >
          <span className={styles.confirmTitle}>{confirm.title}</span>
          <span className={styles.confirmNote}>{confirm.note}</span>
          <span className={styles.confirmActions}>
            <button
              type="button"
              className={styles.dangerButton}
              onClick={() => {
                setAsking(false);
                void run(() => live.stopAll());
              }}
            >
              {confirm.cta}
            </button>
            <button type="button" className={styles.quietButton} onClick={() => setAsking(false)}>
              Cancel
            </button>
          </span>
        </div>
      )}
      <ActionError text={error} />
    </div>
  );
}

/**
 * "Run a check now" (R2: at most 6 manual checks a UTC day): pending while the check runs, shut
 * with the reason at the limit, MANUAL_LIMIT and the other refusals said inline.
 */
export function RunCheck({ live, canManage }: { live: Live; canManage: boolean }) {
  const { error, run } = useActionError();
  const [sending, setSending] = useState(false);
  const record = live.record;
  if (!record || record === "failed" || !record.runtimeEnabled) {
    return null;
  }
  const checking = sending || live.pending.some((action) => action.kind === "check");
  const view = manualCheckView(record.today, checking);
  const reason = canManage ? view.shut : VIEW_ONLY_REASON;
  const shut = reason !== null;
  return (
    <div className={styles.runCheck} id="live-run-check">
      <button
        type="button"
        className={styles.whiteButton}
        aria-disabled={shut || undefined}
        aria-busy={checking || undefined}
        aria-describedby={reason ? "live-run-check-reason" : undefined}
        title={reason ?? undefined}
        onClick={() => {
          if (!shut) {
            setSending(true);
            void run(() => live.runCheck()).finally(() => setSending(false));
          }
        }}
      >
        <Icon name="play" size={13} />
        {view.label}
      </button>
      <span className={styles.runNote}>{view.note}</span>
      <Reason id="live-run-check-reason" text={reason} />
      <ActionError text={error} />
    </div>
  );
}
