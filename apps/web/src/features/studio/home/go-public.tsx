"use client";
import { Button, Icon, Tag } from "@pickler/ui";
import type { GoPublicStep } from "./go-public-model";
import styles from "./home.module.css";

/**
 * GO PUBLIC on a draft's home (studio-brief-v1 §6), its steps from `go-public-model.ts`: done ones
 * ticked, Connect X still Soon. Going public itself is a later section, so its button stays shut.
 */
export function GoPublic({ steps, onFund }: { steps: GoPublicStep[]; onFund(): void }) {
  const left = steps.filter((step) => !step.done).length;
  return (
    <section className={styles.column} id="home-go-public" aria-labelledby="home-go-public-title">
      <div className={styles.colBar}>
        <h2 className={styles.colHead} id="home-go-public-title">
          Go public
        </h2>
        <span className={styles.colCount}>
          {steps.length - left} / {steps.length}
        </span>
      </div>
      <p className={styles.empty}>It stays private and runs on paper until it goes public.</p>
      <ol className={styles.goSteps}>
        {steps.map((step, index) => (
          <li key={step.key} className={styles.nextItem} data-done={step.done}>
            <span className={styles.check} data-done={step.done} aria-hidden="true">
              {step.done ? <Icon name="check" size={13} /> : index + 1}
            </span>
            <span className={styles.grow}>
              <span className={styles.nextTitle}>{step.title}</span>
              <span className={styles.nextNote}>{step.note}</span>
              {step.done && <span className={styles.srOnly}> · done</span>}
            </span>
            {step.action === "soon" && <Tag className={styles.soon}>SOON</Tag>}
            {step.action === "fund" && (
              <Button variant="secondary" size="sm" onClick={onFund}>
                Fund
              </Button>
            )}
          </li>
        ))}
      </ol>
      <Button variant="secondary" size="sm" disabled>
        {left} to go
      </Button>
    </section>
  );
}
