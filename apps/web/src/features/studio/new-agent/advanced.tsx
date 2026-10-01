"use client";
import { Icon } from "@pickler/ui";
import { STARTER_CAPS, sectionTag, type NewAgentForm, type SectionKey } from "./model";
import styles from "./new-agent.module.css";

const SECTIONS: readonly {
  key: SectionKey;
  label: string;
  sub: string;
  rows: number;
  placeholder: string;
}[] = [
  {
    key: "thesis",
    label: "THESIS",
    sub: "why this edge exists, in plain words",
    rows: 3,
    placeholder: "What does this agent believe that the market does not price yet?",
  },
  {
    key: "enters",
    label: "ENTERS WHEN",
    sub: "every line must be true",
    rows: 4,
    placeholder: "Conditions, one per line.",
  },
  {
    key: "exits",
    label: "EXITS WHEN",
    sub: "the first line that turns true closes it",
    rows: 3,
    placeholder: "Take profit, stop, time limit…",
  },
  {
    key: "never",
    label: "NEVER",
    sub: "hard lines it will not cross",
    rows: 3,
    placeholder: "The things a tired human would do at 3am.",
  },
];

/* Steps that stay inside core's `SPEND_BOUNDS` (1–1,000 and 1–10,000 AUSD) and `LEVERAGE_BOUNDS`
   (1–10×), so + and − never reach a value the API would refuse. */
const STEPPERS = [
  { key: "perTrade", title: "PER TRADE", step: 5, min: 5, max: 1_000, unit: " AUSD" },
  { key: "perDay", title: "PER DAY", step: 10, min: 10, max: 10_000, unit: " AUSD" },
  { key: "leverage", title: "MAX LEVERAGE", step: 1, min: 1, max: 10, unit: "×" },
] as const;

/**
 * "Advanced settings": collapsed, with a working default loaded. Open, the four brief sections and
 * the risk caps with − and +. The risk copy says what is true (spec D6): the wallet's policies
 * keep it to Perpl and from withdrawing; Pickler, not the wallet, holds each trade to the caps.
 */
export function Advanced({
  form,
  open,
  disabled,
  onToggle,
  onChange,
}: {
  form: NewAgentForm;
  open: boolean;
  disabled: boolean;
  onToggle(): void;
  onChange(next: NewAgentForm): void;
}) {
  const edited =
    form.perTrade !== STARTER_CAPS.perTradeAusd ||
    form.perDay !== STARTER_CAPS.perDayAusd ||
    form.leverage !== STARTER_CAPS.maxLeverage;
  return (
    <>
      <button
        type="button"
        className={styles.advancedToggle}
        aria-expanded={open}
        aria-controls="new-agent-advanced"
        onClick={onToggle}
      >
        <Icon name="chevronRight" size={13} />
        ADVANCED SETTINGS
        <span className={styles.advancedSummary}>
          · thesis, entry and exit rules, hard lines, risk caps · a working default is loaded
        </span>
      </button>
      {open && (
        <div className={styles.advanced} id="new-agent-advanced">
          {SECTIONS.map((section) => {
            const value = form[section.key];
            const tag = sectionTag(section.key, value);
            return (
              <div
                key={section.key}
                className={styles.card}
                data-needed={section.key === "enters" && !value.trim()}
              >
                <div className={styles.cardHead}>
                  <label className={styles.label} htmlFor={`new-agent-${section.key}`}>
                    {section.label}
                  </label>
                  <span className={styles.sub}>{section.sub}</span>
                  <span className={styles.tag} data-filled={tag.edited}>
                    {tag.text}
                  </span>
                </div>
                <textarea
                  id={`new-agent-${section.key}`}
                  className={styles.input}
                  rows={section.rows}
                  placeholder={section.placeholder}
                  value={value}
                  disabled={disabled}
                  onChange={(event) => onChange({ ...form, [section.key]: event.target.value })}
                />
              </div>
            );
          })}
          <div className={`${styles.card} ${styles.cardRoomy}`} id="new-agent-risk">
            <div className={styles.cardHead}>
              <span className={styles.label}>RISK</span>
              <span className={styles.sub}>
                hard caps · it can only trade on Perpl and can&apos;t withdraw · Pickler holds every
                trade to these caps
              </span>
              <span className={styles.tag} data-filled={edited}>
                {edited ? "EDITED" : "STARTER CAPS"}
              </span>
            </div>
            <div className={styles.caps}>
              {STEPPERS.map((stepper) => {
                const value = form[stepper.key];
                const set = (next: number) =>
                  onChange({
                    ...form,
                    [stepper.key]: Math.min(stepper.max, Math.max(stepper.min, next)),
                  });
                return (
                  <div key={stepper.key} className={styles.cap}>
                    <span className={styles.capText}>
                      <span className={styles.capTitle}>{stepper.title}</span>
                      <span className={styles.capValue}>
                        {value}
                        {stepper.unit}
                      </span>
                    </span>
                    <button
                      type="button"
                      className={styles.capButton}
                      aria-label={`Lower ${stepper.title.toLowerCase()}`}
                      disabled={disabled || value <= stepper.min}
                      onClick={() => set(value - stepper.step)}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className={styles.capButton}
                      aria-label={`Raise ${stepper.title.toLowerCase()}`}
                      disabled={disabled || value >= stepper.max}
                      onClick={() => set(value + stepper.step)}
                    >
                      +
                    </button>
                  </div>
                );
              })}
            </div>
            {form.perDay < form.perTrade && (
              <p className={styles.alert} role="alert">
                <Icon name="alert" size={12} />A day&apos;s cap can&apos;t be below one
                trade&apos;s.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
