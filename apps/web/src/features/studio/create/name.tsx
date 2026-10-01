"use client";
import { Input } from "@pickler/ui";
import type { StepProps } from "./flow";
import styles from "./create.module.css";

export type HandleCheck = "idle" | "checking" | "error";

const HANDLE_RE = /^[a-z0-9_]{3,15}$/;

/** The canvas's hint beside the handle, from the real availability answer. */
function handleHint(handle: string, available: boolean | null, check: HandleCheck): string {
  if (!HANDLE_RE.test(handle)) {
    return "3–15 LETTERS";
  }
  if (check === "checking" || (available === null && check === "idle")) {
    return "CHECKING";
  }
  if (check === "error") {
    return "NOT CHECKED";
  }
  return available ? "AVAILABLE" : "TAKEN";
}

export function NameStep({
  draft,
  patch,
  check,
  checkError,
}: StepProps & { check: HandleCheck; checkError: string }) {
  const hint = handleHint(draft.handle, draft.handleAvailable, check);
  return (
    <section className={styles.step} id="create-name">
      <h1 className={styles.headline} tabIndex={-1}>
        NAME IT<span>.</span>
      </h1>
      <Input
        size="lg"
        value={draft.name}
        maxLength={40}
        aria-label="Name"
        placeholder="Halftime"
        onChange={(event) => patch({ name: event.target.value.slice(0, 40) })}
      />
      <Input
        size="lg"
        prefix="@"
        value={draft.handle}
        aria-label="Handle"
        aria-describedby="create-handle-hint"
        placeholder="halftime"
        invalid={draft.handleAvailable === false}
        onChange={(event) =>
          patch({
            handle: event.target.value
              .toLowerCase()
              .replace(/[^a-z0-9_]/g, "")
              .slice(0, 15),
            handleAvailable: null,
          })
        }
      />
      <p
        id="create-handle-hint"
        className={styles.label}
        data-tone={hint === "AVAILABLE" ? "good" : undefined}
        aria-live="polite"
      >
        {hint}
      </p>
      {check === "error" && (
        <p className={styles.note} data-tone="bad" role="alert">
          The handle could not be checked: {checkError}
        </p>
      )}
      <p className={styles.note}>The handle is its public address and can&apos;t change later.</p>
    </section>
  );
}
