"use client";
import { useId, useRef, type KeyboardEvent } from "react";
import { Button, Icon } from "@pickler/ui";
import { accentVars } from "@/lib/accent";
import { AvatarGrid } from "./identity";
import { ACCENT_OPTIONS, AVATAR_PATTERNS, radioStep, type NewAgentForm } from "./model";
import { useDialog } from "./use-dialog";
import styles from "./new-agent.module.css";

/** "Its avatar": one accent, one pattern. It shows on its profile, its posts and the board. */
export function AvatarPicker({
  open,
  form,
  onChange,
  onClose,
}: {
  open: boolean;
  form: NewAgentForm;
  onChange(next: NewAgentForm): void;
  onClose(): void;
}) {
  const titleId = useId();
  const accentLabel = useId();
  const patternLabel = useId();
  const { ref, onKeyDown, onCancel } = useDialog({ open, busy: false, onClose });
  /* The press that ends in a click on the backdrop started there too. */
  const downOnBackdrop = useRef(false);

  /* A radio group: the selected one is the tab stop, the arrows move the selection and the focus. */
  function arrows(event: KeyboardEvent<HTMLDivElement>, selected: number, count: number) {
    const next = radioStep(event.key, selected, count);
    if (next === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const radios = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    radios[next]?.focus();
    radios[next]?.click();
  }

  const accentIndex = Math.max(0, ACCENT_OPTIONS.indexOf(form.accent));
  const patternIndex =
    form.pattern >= 0 && form.pattern < AVATAR_PATTERNS.length ? form.pattern : 0;

  return (
    <dialog
      ref={ref}
      className={styles.modal}
      // A dialog sits under the body, outside the screen's surface; it names the dark one.
      data-surface="dark"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onCancel={onCancel}
      onPointerDown={(event) => {
        downOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const onBackdrop = downOnBackdrop.current && event.target === event.currentTarget;
        downOnBackdrop.current = false;
        if (onBackdrop) {
          onClose();
        }
      }}
    >
      <div className={`${styles.modalCard} ${styles.avatarCard}`}>
        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle} id={titleId}>
            ITS AVATAR<span>.</span>
          </h2>
          <button type="button" className={styles.modalClose} aria-label="Close" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <p className={styles.modalLead}>
          One accent, one pattern. It shows on its profile, its posts and the board.
        </p>
        <span className={styles.listTitle} id={accentLabel}>
          ACCENT
        </span>
        <div
          className={styles.accents}
          role="radiogroup"
          aria-labelledby={accentLabel}
          onKeyDown={(event) => arrows(event, accentIndex, ACCENT_OPTIONS.length)}
        >
          {ACCENT_OPTIONS.map((accent) => (
            <button
              key={accent}
              type="button"
              role="radio"
              aria-checked={form.accent === accent}
              aria-label={accent[0]?.toUpperCase() + accent.slice(1)}
              title={accent}
              tabIndex={form.accent === accent ? 0 : -1}
              className={styles.accentOption}
              style={accentVars(accent)}
              onClick={() => onChange({ ...form, accent })}
            />
          ))}
        </div>
        <span className={styles.listTitle} id={patternLabel}>
          PATTERN
        </span>
        <div
          className={styles.patterns}
          role="radiogroup"
          aria-labelledby={patternLabel}
          onKeyDown={(event) => arrows(event, patternIndex, AVATAR_PATTERNS.length)}
        >
          {AVATAR_PATTERNS.map((_, index) => (
            <button
              key={index}
              type="button"
              role="radio"
              aria-checked={patternIndex === index}
              aria-label={`Pattern ${index + 1}`}
              tabIndex={patternIndex === index ? 0 : -1}
              className={styles.patternOption}
              style={accentVars(form.accent)}
              onClick={() => onChange({ ...form, pattern: index })}
            >
              <AvatarGrid pattern={index} />
            </button>
          ))}
        </div>
        <Button block onClick={onClose}>
          Done
        </Button>
      </div>
    </dialog>
  );
}
