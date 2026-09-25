"use client";
import { Button, Icon, Tag } from "@pickler/ui";
import { ORDER, ready, reviewRows, soonRows, type Draft, type OrderStep } from "./draft";
import styles from "./create.module.css";

/** The manual step each review row's Edit opens. */
const EDIT: Record<ReturnType<typeof reviewRows>[number]["key"], OrderStep> = {
  name: "name",
  tradesOn: "trades",
  calls: "looks",
  reads: "reads",
  skills: "skills",
  decides: "decides",
};

const STEP_NAMES: Record<OrderStep, string> = {
  name: "its name and handle",
  trades: "where it trades",
  looks: "what it calls",
  reads: "what it reads",
  skills: "its skills",
  decides: "how it decides",
  review: "the review",
};

/** Why "Create and run it once" is off, in the person's terms, or null when it is on. */
export function blockedBy(draft: Draft): string | null {
  const soon = soonRows(draft);
  if (soon.length > 0) {
    return soon.map((row) => row.reason).join(" ") + " Change it to create the agent now.";
  }
  const missing = ORDER.filter((step) => step !== "review" && !ready(step, draft));
  if (missing.length === 0) {
    return null;
  }
  if (missing[0] === "name" && draft.handleAvailable === false) {
    return `@${draft.handle} is taken. Pick another handle.`;
  }
  if (missing[0] === "name" && draft.handleAvailable === null && draft.handle) {
    return `Checking whether @${draft.handle} is free.`;
  }
  return `Finish ${missing.map((step) => STEP_NAMES[step]).join(", ")} first.`;
}

export function Review({
  draft,
  mode,
  onEdit,
}: {
  draft: Draft;
  mode: "auto" | "manual";
  onEdit(step: OrderStep): void;
}) {
  const soon = soonRows(draft);
  const name = draft.name.trim() || "Your agent";
  const blocked = blockedBy(draft);

  return (
    <section className={styles.step} id="create-review">
      <h1 className={styles.headline}>
        MEET {name.toUpperCase()}
        <span>.</span>
      </h1>
      <p className={styles.lead}>
        {mode === "auto"
          ? "Set up from your line. Change anything, or run it as is."
          : "Check it, then run it once."}
      </p>
      <ul className={styles.rows}>
        {reviewRows(draft).map((row) => {
          const flag = soon.find((candidate) => candidate.label === row.label);
          return (
            <li key={row.key} className={styles.row} data-soon={Boolean(flag)}>
              <span className={styles.rowLabel}>{row.label}</span>
              <span className={styles.rowValue}>
                {row.value || "—"}
                {flag && (
                  <span className={styles.rowReason}>
                    <Tag className={styles.soon}>SOON</Tag>
                    {flag.reason}
                  </span>
                )}
              </span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Edit ${row.label.toLowerCase()}`}
                onClick={() => onEdit(EDIT[row.key])}
              >
                Edit
              </Button>
            </li>
          );
        })}
      </ul>
      {blocked && (
        <p className={styles.note} data-tone="bad" role="status">
          <Icon name="lock" size={12} /> {blocked}
        </p>
      )}
      <p className={styles.note}>
        Creating it also creates its own wallet, confirmed with your passkey. Its first call is on
        paper; fund it afterwards to let it run on its own.
      </p>
    </section>
  );
}
