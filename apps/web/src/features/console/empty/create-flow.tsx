"use client";
import { Icon } from "@pickler/ui";
import {
  BEATS,
  EDGE_MAX,
  STEPS,
  UNBACKED,
  handleOk,
  stepReachable,
  stepReady,
  suggestHandle,
  suggestTicker,
  tickerOf,
  type Draft,
  type Sport,
  type Step,
} from "./draft";
import type { RunEvent } from "../api";
import styles from "./empty.module.css";

const PROMPTS = [
  { label: "+ INJURY NEWS", text: "Bets on NBA injury news before the lines move." },
  { label: "+ LINE MOVES", text: "Fades late line moves the public chases." },
  { label: "+ SHORT WEEKS", text: "Backs rested teams against opponents on a short week." },
];
const EDGE_IDEAS = [
  { label: "+ INJURY NEWS", text: "It reads injury reports before the books move." },
  { label: "+ LINE MOVES", text: "It fades late line moves the public chases." },
];
/** The steps the progress rail shows. `start` is before the rail exists, as in the canvas. */
const RAIL: { step: Step; label: string }[] = [
  { step: "name", label: "NAME" },
  { step: "beat", label: "CALLS" },
  { step: "edge", label: "EDGE" },
  { step: "run", label: "FIRST RUN" },
];

export function CreateFlow({
  step,
  draft,
  sports,
  busy,
  filled,
  error,
  events,
  running,
  ran,
  onStep,
  onDraft,
  onFill,
  onNext,
}: {
  step: Step;
  draft: Draft;
  sports: { id: Sport; label: string }[];
  busy: boolean;
  filled: boolean;
  error: string;
  /** The real trace of the real first run. Empty until one has been started. */
  events: RunEvent[];
  running: boolean;
  ran: boolean;
  onStep(step: Step): void;
  onDraft(patch: Partial<Draft>): void;
  onFill(): void;
  onNext(): void;
}) {
  const index = STEPS.indexOf(step);
  const ticker = tickerOf(draft);
  const handle = suggestHandle(draft.name);
  const ready = stepReady(step, draft);
  const nextLabel =
    step === "run"
      ? ran
        ? "Open the studio"
        : running
          ? "Running…"
          : "Create it and run it"
      : "Continue";

  return (
    <div className={styles.flow}>
      {step !== "start" && (
        <ol className={styles.rail} aria-label="Steps">
          {RAIL.map((item, position) => {
            const at = RAIL.findIndex((entry) => entry.step === step);
            const state = position === at ? "here" : position < at ? "done" : "ahead";
            return (
              <li key={item.step}>
                <button
                  type="button"
                  className={styles.railStep}
                  data-state={state}
                  aria-current={position === at}
                  disabled={!stepReachable(item.step, draft)}
                  onClick={() => onStep(item.step)}
                >
                  <span className={styles.railBar} />
                  {item.label}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {step === "start" && (
        <section className={styles.step}>
          <p className={styles.kicker}>YOUR FIRST AGENT</p>
          <h1 className={styles.headline}>
            DESCRIBE IT<span>.</span>
          </h1>
          <div className={styles.well}>
            <textarea
              className={styles.prose}
              rows={3}
              value={draft.prompt}
              aria-label="What your agent does"
              placeholder="Bets on NBA injury news before the lines move."
              onChange={(event) => onDraft({ prompt: event.target.value })}
            />
            <div className={styles.ideas}>
              {PROMPTS.map((idea) => (
                <button
                  key={idea.label}
                  type="button"
                  className={styles.idea}
                  onClick={() => onDraft({ prompt: idea.text })}
                >
                  {idea.label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className={styles.primary}
            disabled={!ready}
            onClick={onFill}
            title={
              ready
                ? "Suggests a name and a beat by matching words in your line"
                : "Say what it does first"
            }
          >
            Fill it in
          </button>
          <p className={styles.note}>
            Matched against a word list, here in the browser. There is no model reading this line —
            everything it suggests is yours to overwrite on the next step.
          </p>
          <button type="button" className={styles.quiet} onClick={() => onStep("name")}>
            OR BUILD IT STEP BY STEP
          </button>
        </section>
      )}

      {filled && step !== "start" && step !== "run" && (
        <p className={styles.filled}>
          <Icon name="check" size={13} />
          FILLED FROM YOUR LINE · CHECK IT
        </p>
      )}

      {step === "name" && (
        <section className={styles.step}>
          <p className={styles.kicker}>YOUR FIRST AGENT</p>
          <h1 className={styles.headline}>
            NAME IT<span>.</span>
          </h1>
          <div className={styles.namePair}>
            <input
              className={styles.nameField}
              value={draft.name}
              maxLength={40}
              aria-label="Name"
              placeholder="Halftime"
              onChange={(event) => onDraft({ name: event.target.value })}
            />
            <input
              className={styles.tickerField}
              value={draft.ticker || (draft.tickerTouched ? "" : suggestTicker(draft.name))}
              aria-label="Ticker"
              placeholder="$HALF"
              onChange={(event) =>
                onDraft({
                  ticker: `$${event.target.value
                    .replace(/[^a-zA-Z0-9]/g, "")
                    .toUpperCase()
                    .slice(0, 6)}`.replace(/^\$$/, ""),
                  tickerTouched: true,
                })
              }
            />
          </div>
          <p className={styles.hint} data-ok={handleOk(handle)}>
            {draft.name.trim()
              ? handleOk(handle)
                ? `@${handle} IS THE HANDLE IT WILL CARRY`
                : "A HANDLE NEEDS 3–15 LETTERS, NUMBERS OR UNDERSCORES"
              : "TYPE A NAME · THE HANDLE COMES FROM IT"}
          </p>
          <p className={styles.note}>
            <span className={styles.mark} data-tint="amber">
              {ticker || "$TICKER"} NOT STORED
            </span>
            {UNBACKED.ticker}
          </p>
        </section>
      )}

      {step === "beat" && (
        <section className={styles.step}>
          <h1 className={styles.headline}>
            WHAT IT CALLS<span>.</span>
          </h1>
          <div className={styles.beats}>
            {BEATS.map((beat) => (
              <button
                key={beat.name}
                type="button"
                className={styles.beat}
                data-swatch={beat.swatch}
                aria-pressed={draft.beat === beat.name}
                disabled={!beat.category}
                title={
                  beat.category ? beat.name : "No market catalog behind this beat yet — sports only"
                }
                onClick={() => onDraft({ beat: beat.name })}
              >
                <span className={styles.beatDot} />
                {beat.name}
                {!beat.category && <em>SOON</em>}
              </button>
            ))}
          </div>
          <p className={styles.note}>
            Seven of these have no market catalog behind them. The API takes one category — sports —
            and four markets inside it, so those are what an agent can be pointed at today.
          </p>
          {draft.beat === "Sports" && (
            <div className={styles.sports}>
              <p className={styles.kicker}>WHICH MARKETS</p>
              <div className={styles.chips}>
                {sports.map((sport) => {
                  const on = draft.sports.includes(sport.id);
                  return (
                    <button
                      key={sport.id}
                      type="button"
                      className={styles.chip}
                      aria-pressed={on}
                      onClick={() =>
                        onDraft({
                          sports: on
                            ? draft.sports.filter((id) => id !== sport.id)
                            : [...draft.sports, sport.id],
                        })
                      }
                    >
                      {sport.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {step === "edge" && (
        <section className={styles.step}>
          <h1 className={styles.headline}>
            ITS EDGE<span>.</span>
          </h1>
          <div className={styles.well}>
            <textarea
              className={styles.prose}
              rows={4}
              value={draft.why}
              aria-label="Its edge"
              placeholder="It reads injury reports before the books move."
              onChange={(event) => onDraft({ why: event.target.value })}
            />
            <div className={styles.ideas}>
              {EDGE_IDEAS.map((idea) => (
                <button
                  key={idea.label}
                  type="button"
                  className={styles.idea}
                  onClick={() => onDraft({ why: idea.text })}
                >
                  {idea.label}
                </button>
              ))}
              <span className={styles.count} data-over={draft.why.length > EDGE_MAX}>
                {draft.why.length} / {EDGE_MAX}
              </span>
            </div>
          </div>
          <p className={styles.note}>
            This becomes the brief the agent carries into every run. It can grow to 4,000 characters
            later; the first one is short on purpose.
          </p>
        </section>
      )}

      {step === "run" && (
        <section className={styles.step}>
          <h1 className={styles.headline}>
            WATCH IT THINK<span>.</span>
          </h1>
          <p className={styles.kicker}>PAPER MONEY · NOTHING POSTS</p>
          <div className={styles.well}>
            {!running && !events.length ? (
              <p className={styles.runIdle}>{ran ? "NO TRACE CAME BACK" : "NOT RUN YET"}</p>
            ) : (
              <ol className={styles.runLines}>
                {events.map((event) => (
                  <li key={event.id} className={styles.runLine}>
                    <span className={styles.runDot} />
                    <span className={styles.runText}>{event.type}</span>
                  </li>
                ))}
              </ol>
            )}
            {running && (
              <p className={styles.thinking}>
                <span className={styles.pulse} />
                THINKING
              </p>
            )}
          </div>
          <p className={styles.note}>
            The canvas runs this before the agent exists. Nothing can: a run belongs to an agent, so
            this creates it first and then starts its first run for real. Both count against the
            same research allowance every later run does.
          </p>
        </section>
      )}

      {error && (
        <p className={styles.error} role="alert">
          <Icon name="alert" size={13} />
          {error}
        </p>
      )}

      {step !== "start" && (
        <div className={styles.nav}>
          {index > 0 && (
            <button
              type="button"
              className={styles.back}
              disabled={busy}
              onClick={() => onStep(STEPS[index - 1]!)}
            >
              Back
            </button>
          )}
          <button
            type="button"
            className={styles.primary}
            disabled={!ready || busy || running}
            onClick={onNext}
          >
            {nextLabel}
          </button>
        </div>
      )}
    </div>
  );
}
