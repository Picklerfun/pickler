"use client";
import type { Caps, CapsView } from "./build-model";
import styles from "./build.module.css";

/**
 * The note bar over Brief and Sources & rules (canvas 679, 715). Nothing has run yet on a draft,
 * so it is the canvas's first state; "Run it" opens the Console.
 */
export function RunNote({ onRun }: { onRun(): void }) {
  return (
    <div className={styles.runNote}>
      <span className={styles.runDot} aria-hidden="true" />
      <span className={styles.runText}>EDIT FREELY · THEN RUN IT ON PAPER</span>
      <button type="button" className={styles.runButton} onClick={onRun}>
        Run it
      </button>
    </div>
  );
}

/**
 * The three caps with − and + (`capsStepper`): a row each on Limits (canvas 507–514), tiles in a
 * grid on Brief's RISK (canvas 694–704). A step past a bound is shut, never clamped silently.
 */
export function CapSteppers({
  view,
  layout,
  disabled,
  onChange,
}: {
  view: CapsView;
  layout: "rows" | "grid";
  disabled: boolean;
  onChange(next: Caps): void;
}) {
  const current = Object.fromEntries(view.rows.map((row) => [row.key, row.value])) as Record<
    keyof Caps,
    number
  >;
  return (
    <div className={styles.caps} data-layout={layout}>
      {view.rows.map((row) => {
        const name = row.title.toLowerCase();
        const step = (value: number | null) => {
          if (value !== null) {
            onChange({ ...current, [row.key]: value });
          }
        };
        return (
          <div key={row.key} className={styles.cap}>
            <span className={styles.capText}>
              <span className={styles.capTitle}>{row.title}</span>
              {layout === "grid" && (
                <span className={styles.capValue} aria-live="polite">
                  {row.display}
                </span>
              )}
            </span>
            <button
              type="button"
              className={styles.capButton}
              aria-label={`Lower ${name}`}
              disabled={disabled || row.prev === null}
              onClick={() => step(row.prev)}
            >
              −
            </button>
            {layout === "rows" && (
              <span className={styles.capValue} aria-live="polite">
                {row.display}
              </span>
            )}
            <button
              type="button"
              className={styles.capButton}
              aria-label={`Raise ${name}`}
              disabled={disabled || row.next === null}
              onClick={() => step(row.next)}
            >
              +
            </button>
          </div>
        );
      })}
    </div>
  );
}
