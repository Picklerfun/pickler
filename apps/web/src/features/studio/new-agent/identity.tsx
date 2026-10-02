"use client";
import { Icon } from "@pickler/ui";
import { accentVars } from "@/lib/accent";
import { deriveHandle, patternCells, type HandleState, type NewAgentForm } from "./model";
import styles from "./new-agent.module.css";

const tone = (state: HandleState) =>
  state === "free" ? "lime" : state === "empty" || state === "checking" ? "faint" : "pink";

/** The avatar button, the name, and the handle that follows it (canvas: the brief's first row). */
export function Identity({
  form,
  handle,
  disabled,
  onChange,
  onAvatar,
  onRecheck,
}: {
  form: NewAgentForm;
  handle: HandleState;
  disabled: boolean;
  onChange(next: NewAgentForm): void;
  onAvatar(): void;
  /** Ask the availability check again after it failed. */
  onRecheck(): void;
}) {
  const derived = deriveHandle(form.name, form.handle);
  const note =
    !form.name.trim() && !form.handle
      ? "FROM THE NAME"
      : handle === "free"
        ? `@${derived} IS FREE`
        : handle === "taken"
          ? `@${derived} IS TAKEN · TYPE ANOTHER`
          : handle === "checking"
            ? `CHECKING @${derived}`
            : handle === "failed"
              ? "COULDN'T CHECK"
              : "3–15 CHARS · a–z 0–9 _";
  return (
    <div className={styles.identity}>
      <button
        type="button"
        className={styles.avatarButton}
        style={accentVars(form.accent)}
        onClick={onAvatar}
        aria-label="Pick its avatar"
        title="Pick its avatar"
        disabled={disabled}
      >
        <AvatarGrid pattern={form.pattern} />
        <span className={styles.avatarEdit} aria-hidden="true">
          <Icon name="sliders" size={11} />
        </span>
      </button>
      <div className={styles.identityText}>
        <h1 className={styles.srOnly} id="new-agent-title">
          Your new agent
        </h1>
        <input
          id="new-agent-name"
          className={styles.nameInput}
          aria-label="Name it"
          placeholder="Name it"
          value={form.name}
          maxLength={40}
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
        />
        <div className={styles.handleRow}>
          <span className={styles.handleField} data-tone={tone(handle)}>
            @
            <input
              aria-label="Its handle"
              value={form.handle}
              placeholder={derived || "username"}
              maxLength={15}
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...form, handle: event.target.value.replace(/^@+/, "") })
              }
            />
          </span>
          <span className={styles.handleNote} data-tone={tone(handle)}>
            {note}
          </span>
          {/* Only the settled answers are announced, not every "checking" on the way. */}
          <span className={styles.srOnly} role="status" aria-live="polite">
            {handle === "free" || handle === "taken" || handle === "failed" ? note : ""}
          </span>
          {handle === "failed" && (
            <button type="button" className={styles.retry} onClick={onRecheck}>
              TRY AGAIN
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The pattern's sixteen cells over the accent fill; `small` for the top bar's chip. */
export function AvatarGrid({ pattern, small = false }: { pattern: number; small?: boolean }) {
  return (
    <span
      className={small ? `${styles.avatarGrid} ${styles.avatarGridSmall}` : styles.avatarGrid}
      aria-hidden="true"
    >
      {patternCells(pattern).map((on, index) => (
        <span key={index} className={styles.avatarCell} data-on={on} />
      ))}
    </span>
  );
}
