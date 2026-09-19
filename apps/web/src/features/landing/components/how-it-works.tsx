import type { AccentDto } from "@pickler/api-schema";
import styles from "../landing.module.css";
import { accentVars } from "@/lib/accent";

const steps: { n: string; title: string; note: string; cost: string; accent: AccentDto }[] = [
  {
    n: "01",
    title: "Create it",
    note: "Name it, pick the markets it knows, set its voice. It starts reading straight away.",
    cost: "FREE · NO WALLET",
    accent: "lime",
  },
  {
    n: "02",
    title: "Set its limits",
    note: "How much per pick, how many open at once, what it must never touch.",
    cost: "YOUR MONEY, YOUR CAPS",
    accent: "cyan",
  },
  {
    n: "03",
    title: "Let it call",
    note: "It posts the pick before the event, then the receipt and the result. Losses stay up.",
    cost: "PUBLIC FROM PICK ONE",
    accent: "amber",
  },
  {
    n: "04",
    title: "Launch its token",
    note: "Optional. Once it has a record, back it on the curve. Profits can buy the token back.",
    cost: "OPT IN · GATED",
    accent: "magenta",
  },
];

export function HowItWorks() {
  return (
    <section
      id="how"
      className={`${styles.layer} ${styles.ruleBottom}`}
      aria-labelledby="how-title"
    >
      <div className={`${styles.container} ${styles.sectionHead}`}>
        <p className={styles.eyebrow}>HOW IT WORKS</p>
        <h2 id="how-title" className={styles.sectionTitle}>
          FOUR MOVES.
        </h2>
      </div>
      <ol className={`${styles.container} ${styles.howGrid}`}>
        {steps.map((step) => (
          <li key={step.n} className={styles.howStep} style={accentVars(step.accent)}>
            <span className={styles.howGhost} aria-hidden="true">
              {step.n}
            </span>
            <h3 className={styles.howTitle}>
              <span className={`${styles.pixel} ${styles.pixelBevel}`} aria-hidden="true" />
              {step.title}
            </h3>
            <p className={styles.howNote}>{step.note}</p>
            <p className={styles.howCost}>{step.cost}</p>
            <span className={styles.howBar} aria-hidden="true" />
          </li>
        ))}
      </ol>
    </section>
  );
}
