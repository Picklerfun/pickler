"use client";
import { Chip, Tag } from "@pickler/ui";
import { isNfl, toggleIn, type Draft } from "./draft";
import type { StepProps } from "./flow";
import { BEATS, DEFAULT_BOOKS, PERPS } from "./map";
import styles from "./create.module.css";

/** Turning NFL on for the first time brings the canvas's three books with it, as its odds do. */
function withSubs(draft: Draft, subs: string[]): Draft {
  const next = { ...draft, subs };
  if (!isNfl(draft) && isNfl(next) && draft.books.length === 0) {
    return { ...next, books: [...DEFAULT_BOOKS] };
  }
  return next;
}

/** What it calls: a beat on Polymarket, and perpetuals when Perpl is on (only a model draft can). */
export function LooksStep({ draft, patch, replace }: StepProps) {
  const beat = BEATS.find((candidate) => candidate.name === draft.beat);
  const polymarket = draft.venues.includes("polymarket");
  const perpl = draft.venues.includes("perpl");

  return (
    <section className={styles.step} id="create-looks">
      <h1 className={styles.headline} tabIndex={-1}>
        WHAT IT CALLS<span>.</span>
      </h1>
      {polymarket && (
        <>
          <p className={styles.label}>POLYMARKET · EVENTS</p>
          <div className={styles.beats}>
            {BEATS.map((option) => {
              const on = option.name === draft.beat;
              return (
                <button
                  key={option.name}
                  type="button"
                  className={styles.beat}
                  aria-pressed={on}
                  disabled={option.soon}
                  title={option.soon ? `${option.name} is coming soon` : undefined}
                  onClick={() => patch({ beat: option.name, subs: on ? draft.subs : [] })}
                >
                  <span className={styles.beatDot} data-tint={option.tint} aria-hidden="true" />
                  <span>{option.name}</span>
                  {option.soon && <Tag className={styles.soon}>SOON</Tag>}
                </button>
              );
            })}
          </div>
          {beat && (
            <div className={styles.panel}>
              <div className={styles.chips}>
                {beat.subs.map((sub) => (
                  <Chip
                    key={sub}
                    selected={draft.subs.includes(sub)}
                    disabled={beat.soon}
                    onClick={() => replace(withSubs(draft, toggleIn(draft.subs, sub)))}
                  >
                    {sub}
                  </Chip>
                ))}
              </div>
              {beat.soon && (
                <p className={styles.note} data-tone="bad">
                  {beat.name} is coming soon. Pick Sports to create it now.
                </p>
              )}
            </div>
          )}
        </>
      )}
      {perpl && (
        <>
          <p className={styles.label}>PERPL · PERPETUALS</p>
          <div className={styles.panel}>
            <div className={styles.chips}>
              {PERPS.map((symbol) => (
                <Chip
                  key={symbol}
                  selected={draft.perps.includes(symbol)}
                  onClick={() => patch({ perps: toggleIn(draft.perps, symbol) })}
                >
                  {symbol}-PERP
                </Chip>
              ))}
            </div>
            <p className={styles.note} data-tone="bad">
              Perpl is coming soon. Turn it off on the trades step to create it now.
            </p>
          </div>
        </>
      )}
      {!polymarket && !perpl && <p className={styles.note}>Pick where it trades first.</p>}
    </section>
  );
}
