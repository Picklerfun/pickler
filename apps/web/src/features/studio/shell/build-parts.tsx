"use client";
import type { CapRow } from "./build-model";
import styles from "./build.module.css";

/**
 * Caps with − and +, whatever their keys (the draft's three from `capsStepper`, the live studio's
 * five, each with its line under the title): a row each on Limits (canvas 507–514), tiles in a
 * grid on Brief's RISK (canvas 694–704).
 * A step past a bound is shut, never clamped silently. `onChange` gets every cap, with the stepped
 * one moved.
 */
export function CapSteppers<K extends string>({
  view,
  layout,
  disabled,
  onChange,
}: {
  /**
   * The rows, each with its value and the values one step down and up (null at a bound), and an
   * optional line under the title (the live studio's five caps, canvas 486).
   */
  view: { rows: readonly (CapRow<K> & { sub?: string })[] };
  layout: "rows" | "grid";
  disabled: boolean;
  onChange(next: Record<K, number>): void;
}) {
  const current = Object.fromEntries(view.rows.map((row) => [row.key, row.value])) as Record<
    K,
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
              {row.sub && <span className={styles.capSub}>{row.sub}</span>}
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
