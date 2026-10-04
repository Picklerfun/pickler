"use client";
import { useState } from "react";
import { StudioError } from "../api";
import { TalkSoon } from "../shell/talk-soon";
import { PREVIEW_NOTE } from "../shell/use-agent-studio";
import { DraftSection, type DraftSectionProps } from "./draft-section";
import { INTERVAL_OPTIONS, nextRuns, runInputs, runsPerDay } from "./run-model";
import {
  checkRefusal,
  didMeta,
  outcomeCard,
  runButtonView,
  runState,
  runtimeOpen,
  scheduleCopy,
  stepLines,
} from "./runtime-model";
import type { IntervalHours } from "./use-draft";
import styles from "./run.module.css";

/** The canvas's starters for Talk to it, drawn shut until it opens (spec D12). */
const STARTERS = [
  "Why BTC and not ETH?",
  "Read coindesk.com too",
  "Run every 12h",
  "Per trade 10 AUSD",
  "Run it now",
];

/**
 * Console (canvas 530–636, spec §3.4, D12, D13, D19): the inputs a paper run reads, the run button,
 * the schedule's interval (it saves) and its next runs (with the runtime on, ON ITS OWN says a
 * draft runs only when you run it and hourly once public, and the interval is not drawn: R2), What it did, and Talk to it drawn shut with
 * a Soon tag (`../shell/talk-soon.tsx`).
 *
 * With the Perpl runtime off (`draft.record` unread or `runtimeEnabled` false) the run button is
 * shut with "Paper runs open with the Perpl runtime" and What it did is idle, as before. With it on
 * (perpl-paper-runtime-v1 R2, R17) "Run it on paper" starts a manual check, What it did streams its
 * timed steps while it runs (`use-draft.ts` polls every 1.5 s) and then shows the outcome card;
 * the rules are `runtime-model.ts`. Accept / Reject / Ask are decision review and stay out.
 */
export function Console({ agent, draft, canManage, now, onSection }: DraftSectionProps) {
  /* The interval being saved: drawn chosen while the call is out, so the click shows at once. */
  const [saving, setSaving] = useState<IntervalHours | null>(null);
  const [error, setError] = useState("");
  const [runError, setRunError] = useState("");
  const open = draft.record !== null && runtimeOpen(draft.record);
  const current = saving ?? agent.config.intervalHours;
  const inputs = runInputs(agent.config.sources?.web);
  const runs = nextRuns(current, new Date(now));
  const schedule = scheduleCopy(open, current);

  async function choose(hours: IntervalHours) {
    if (!canManage || saving !== null || hours === agent.config.intervalHours) {
      return;
    }
    setSaving(hours);
    setError("");
    try {
      await draft.saveInterval(hours);
    } catch (caught) {
      if (caught instanceof StudioError && caught.code === "PREVIEW") {
        setError(PREVIEW_NOTE);
      } else {
        setError(caught instanceof Error ? caught.message : "Could not save the schedule.");
      }
    } finally {
      setSaving(null);
    }
  }

  async function run() {
    if (!draft.record || draft.checking) {
      return;
    }
    const limit = draft.record.today.manualLimit;
    setRunError("");
    try {
      await draft.runCheck();
    } catch (caught) {
      if (caught instanceof StudioError) {
        setRunError(
          caught.code === "PREVIEW"
            ? PREVIEW_NOTE
            : checkRefusal(caught.code, limit, caught.message),
        );
      } else {
        setRunError(caught instanceof Error ? caught.message : "Could not start the run.");
      }
    }
  }

  const button = draft.record
    ? runButtonView({
        record: draft.record,
        running: draft.checking,
        ran: draft.check?.status === "finished",
        canManage,
      })
    : null;
  const check = open ? draft.check : null;
  const steps = check ? stepLines(check) : [];
  const card =
    check?.status === "finished" ? outcomeCard(check, agent.config.brief, draft.positions) : null;

  return (
    <DraftSection section="console">
      <div className={styles.grid}>
        <div className={styles.column}>
          <div className={styles.card} id="draft-console-run">
            <div className={styles.cardHead}>
              <h3 className={styles.cardLabel}>RUN IT ON PAPER</h3>
              <span className={styles.meta} data-live={(open && draft.checking) || undefined}>
                {open ? runState(draft.checking, draft.check) : "IDLE"}
              </span>
            </div>
            <p className={styles.cardNote}>
              Same brief, same sources, real prices. Nothing is signed. Watch what it decides, then
              tune the brief, the sources or the caps and run again.
            </p>
            <div className={styles.chips}>
              {inputs.map((input) => (
                <button
                  key={input.key}
                  type="button"
                  className={styles.inputChip}
                  onClick={() => onSection("skills")}
                >
                  <span className={styles.inputDot} data-kind={input.key} aria-hidden="true" />
                  {input.label}
                </button>
              ))}
            </div>
            {open && button ? (
              <>
                <button
                  type="button"
                  id="draft-console-run-button"
                  className={styles.runOpen}
                  data-again={button.label === "Run it again" || undefined}
                  aria-disabled={button.shut || undefined}
                  aria-describedby="draft-console-run-note"
                  onClick={() => void (button.shut ? undefined : run())}
                >
                  {draft.checking && <span className={styles.runBlink} aria-hidden="true" />}
                  {button.label}
                </button>
                <p className={styles.runNote} id="draft-console-run-note">
                  {button.note}
                </p>
                {runError && (
                  <p className={styles.error} role="alert">
                    {runError}
                  </p>
                )}
              </>
            ) : (
              <button type="button" className={styles.runButton} disabled>
                Paper runs open with the Perpl runtime
                <span className={styles.soon}>SOON</span>
              </button>
            )}
          </div>

          <div className={styles.card} id="draft-console-schedule">
            <div className={styles.cardHead}>
              <h3 className={styles.cardLabel}>ON ITS OWN</h3>
              <span className={styles.caution}>{schedule.tag}</span>
            </div>
            <p className={styles.cardNote}>{schedule.note}</p>
            {schedule.intervals && (
              <>
                <div className={styles.every}>
                  <span className={styles.everyLabel} id="draft-console-every">
                    Every
                  </span>
                  <span
                    className={styles.intervals}
                    role="group"
                    aria-labelledby="draft-console-every"
                  >
                    {INTERVAL_OPTIONS.map((hours) => (
                      <button
                        key={hours}
                        type="button"
                        className={styles.interval}
                        aria-pressed={current === hours}
                        disabled={!canManage}
                        aria-disabled={saving !== null || undefined}
                        onClick={() => void choose(hours)}
                      >
                        {hours}h
                      </button>
                    ))}
                  </span>
                  <span className={styles.perDay} role="status">
                    {saving !== null ? "SAVING…" : `${runsPerDay(current)} RUNS / DAY`}
                  </span>
                </div>
                {error && (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                )}
                <ol className={styles.runs}>
                  {runs.map((run, index) => (
                    <li key={index} className={styles.run}>
                      <span className={styles.runDot} aria-hidden="true" />
                      {/* Local time: the server renders in its own zone, so the day may differ too. */}
                      <span className={styles.runLabel} suppressHydrationWarning>
                        {run.label}
                      </span>
                      <span className={styles.runAt} suppressHydrationWarning>
                        {run.at}
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>

          <div className={styles.card} id="draft-console-did">
            <div className={styles.cardHead}>
              <h3 className={styles.cardLabel}>WHAT IT DID</h3>
              {/* Local time: the server's zone may differ from the browser's. */}
              <span className={styles.meta} suppressHydrationWarning>
                {didMeta(check)}
              </span>
            </div>
            {steps.length === 0 && !(open && draft.checking) && (
              <div className={styles.idle}>RUN IT TO SEE WHICH RULES FIRE</div>
            )}
            {steps.length > 0 && (
              <ol className={styles.steps} aria-live="polite">
                {steps.map((step, index) => (
                  <li key={`${step.iso}-${index}`} className={styles.step}>
                    <span className={styles.stepDot} data-kind={step.kind} aria-hidden="true" />
                    <span className={styles.stepText}>{step.text}</span>
                    <time className={styles.stepAt} dateTime={step.iso}>
                      {step.meta}
                    </time>
                  </li>
                ))}
              </ol>
            )}
            {open && draft.checking && (
              <div className={styles.thinking} role="status">
                <span className={styles.thinkingDot} aria-hidden="true" />
                THINKING
              </div>
            )}
            {card && (
              <div className={styles.outcome} data-tone={card.tone} id="draft-console-outcome">
                <div className={styles.outcomeHead}>
                  <span className={styles.outcomeEyebrow}>{card.eyebrow}</span>
                  <span className={styles.outcomeTag}>{card.tag}</span>
                </div>
                <p className={styles.outcomeTitle}>{card.title}</p>
                {card.meta && <p className={styles.outcomeMeta}>{card.meta}</p>}
                {card.lines.length > 0 && (
                  <ul className={styles.outcomeLines}>
                    {card.lines.map((line, index) => (
                      <li key={`${line.kind}-${index}`} className={styles.outcomeLine}>
                        <span
                          className={styles.outcomeDot}
                          data-kind={line.kind}
                          aria-hidden="true"
                        />
                        <span className={styles.outcomeText}>
                          {line.text}
                          {line.why && <span className={styles.outcomeWhy}>{line.why}</span>}
                        </span>
                        <span className={styles.outcomeLineTag} data-kind={line.kind}>
                          {line.tag}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {card.rationale && <p className={styles.outcomeWhyText}>{card.rationale}</p>}
              </div>
            )}
            <div className={styles.chips}>
              <button type="button" className={styles.link} onClick={() => onSection("brief")}>
                Tune the brief
              </button>
              <button type="button" className={styles.link} onClick={() => onSection("skills")}>
                Change sources
              </button>
              <button type="button" className={styles.link} onClick={() => onSection("limits")}>
                Adjust caps
              </button>
            </div>
          </div>
        </div>

        <TalkSoon
          idPrefix="draft"
          section="console"
          note="It explains its calls, and it changes its own setup when you ask: sources, sites, caps, schedule."
          starters={STARTERS}
          placeholder="Read coindesk.com too · run every 12h · why not ETH?"
        />
      </div>
    </DraftSection>
  );
}
