"use client";
import { useState } from "react";
import { StudioError } from "../api";
import { INTERVAL_OPTIONS, nextRuns, runInputs, runsPerDay } from "./model";
import { DraftSection, type DraftSectionProps } from "./section";
import { PREVIEW_NOTE, type IntervalHours } from "./use-draft";
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
 * Console (canvas 530–636, spec §3.4, D12, D13): the inputs a paper run would read, the run button
 * shut until the Perpl runtime, the schedule's interval (it saves) and its next runs, What it did
 * idle, and Talk to it drawn shut with a Soon tag. Nothing here pretends a run happened.
 */
export function Console({ agent, draft, canManage, now, onSection }: DraftSectionProps) {
  /* The interval being saved: drawn chosen while the call is out, so the click shows at once. */
  const [saving, setSaving] = useState<IntervalHours | null>(null);
  const [error, setError] = useState("");
  const current = saving ?? agent.config.intervalHours;
  const inputs = runInputs(agent.config.sources?.web);
  const runs = nextRuns(current, new Date(now));

  async function choose(hours: IntervalHours) {
    if (saving !== null || hours === agent.config.intervalHours) {
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

  return (
    <DraftSection section="console">
      <div className={styles.grid}>
        <div className={styles.column}>
          <div className={styles.card} id="draft-console-run">
            <div className={styles.cardHead}>
              <h3 className={styles.cardLabel}>RUN IT ON PAPER</h3>
              <span className={styles.meta}>IDLE</span>
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
            <button type="button" className={styles.runButton} disabled>
              Paper runs open with the Perpl runtime
              <span className={styles.soon}>SOON</span>
            </button>
          </div>

          <div className={styles.card} id="draft-console-schedule">
            <div className={styles.cardHead}>
              <h3 className={styles.cardLabel}>ON ITS OWN</h3>
              <span className={styles.caution}>STARTS WHEN PUBLIC</span>
            </div>
            <p className={styles.cardNote}>
              Once public it wakes up on this schedule, reads its sources, and decides alone. Every
              run lands in Trades.
            </p>
            <div className={styles.every}>
              <span className={styles.everyLabel} id="draft-console-every">
                Every
              </span>
              <span className={styles.intervals} role="group" aria-labelledby="draft-console-every">
                {INTERVAL_OPTIONS.map((hours) => (
                  <button
                    key={hours}
                    type="button"
                    className={styles.interval}
                    aria-pressed={current === hours}
                    disabled={!canManage || saving !== null}
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
          </div>

          <div className={styles.card} id="draft-console-did">
            <div className={styles.cardHead}>
              <h3 className={styles.cardLabel}>WHAT IT DID</h3>
              <span className={styles.meta}>NO RUNS YET</span>
            </div>
            <div className={styles.idle}>RUN IT TO SEE WHICH RULES FIRE</div>
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

        <div className={styles.talk} id="draft-console-talk">
          <div className={styles.cardHead}>
            <h3 className={styles.cardLabel}>TALK TO IT</h3>
            <span className={styles.meta}>ASK WHY · OR TELL IT WHAT TO CHANGE</span>
            <span className={styles.soon}>SOON</span>
          </div>
          <p className={styles.cardNote}>
            It explains its calls, and it changes its own setup when you ask: sources, sites, caps,
            schedule. Caps still need your passkey.
          </p>
          <div className={styles.thread}>
            <div className={styles.chips}>
              {STARTERS.map((starter) => (
                <button key={starter} type="button" className={styles.starter} disabled>
                  {starter}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.ask}>
            <input
              type="text"
              className={styles.askInput}
              placeholder="Read coindesk.com too · run every 12h · why not ETH?"
              aria-label="Talk to it, soon"
              disabled
            />
            <button type="button" className={styles.send} disabled>
              Send
            </button>
          </div>
        </div>
      </div>
    </DraftSection>
  );
}
