"use client";
import { useStudioForm } from "../routing/memory";
import { Segmented } from "@pickler/ui";
import type { WebMode } from "../new-agent/model";
import { addSite, type WebForm } from "./build-model";
import type { StudioIdPrefix } from "./model";
import styles from "./build.module.css";

const MODES: { value: WebMode; label: string }[] = [
  { value: "anywhere", label: "Anywhere" },
  { value: "prefer", label: "Prefer these" },
  { value: "only", label: "Only these" },
];

/** The site box's state: what is typed, the reason it was refused, and the moves on it. */
export interface SiteBox {
  typed: string;
  /** Why the typed site was refused (`addSite`), or null. */
  error: string | null;
  /** A refused site is still in the box: saving now would quietly leave it out. */
  refused: boolean;
  type(value: string): void;
  /** Add what is typed (Enter, or leaving the box). */
  add(): void;
  /** Empty the box (Discard). */
  clear(): void;
}

/**
 * The site box both studios' Sources & rules edit (studio-live-v1 L2, L15): adding a typed site
 * goes through `addSite`, and a site that changed the list is handed to `onSites`.
 */
export function useSiteBox(
  sites: readonly string[],
  onSites: (next: string[]) => void,
  scope: string,
  version: number,
): SiteBox {
  const [typed, setTyped] = useStudioForm(`${scope}:typedSite`, version, "");
  const [error, setError] = useStudioForm<string | null>(`${scope}:siteError`, version, null);
  return {
    typed,
    error,
    refused: Boolean(typed.trim() && error),
    type(value) {
      setTyped(value);
      setError(null);
    },
    add() {
      const result = addSite(sites, typed);
      setTyped(result.draft);
      setError(result.error);
      if (result.sites.length !== sites.length) {
        onSites(result.sites);
      }
    },
    clear() {
      setTyped("");
      setError(null);
    },
  };
}

/**
 * WEB · WHERE EXA MAY LOOK, one implementation for both studios: where the web may look, then (for
 * "Prefer these" and "Only these") the sites with Remove, the box, and its note. The section draws
 * it only while the web is on. `#<idPrefix>-sources-web`.
 */
export function WebSites({
  idPrefix,
  form,
  box,
  note,
  disabled,
  placeholder,
  onEdit,
}: {
  idPrefix: StudioIdPrefix;
  form: WebForm;
  box: SiteBox;
  /** The line under the box (`sourcesView`'s `note`). */
  note: { text: string; bad: boolean };
  disabled: boolean;
  placeholder: string;
  onEdit(next: Partial<WebForm>): void;
}) {
  return (
    <div className={styles.web} id={`${idPrefix}-sources-web`}>
      <div className={styles.webHead}>
        <span className={styles.webTitle}>WEB · WHERE EXA MAY LOOK</span>
        <Segmented
          label="Where the web may look"
          options={MODES}
          optionClassName={styles.webMode}
          value={form.mode}
          disabled={disabled}
          onChange={(mode) => onEdit({ mode })}
        />
      </div>
      {form.mode === "anywhere" ? (
        <span className={styles.hint}>
          SEARCHES THE OPEN WEB · PICK “PREFER” OR “ONLY” TO NAME SITES
        </span>
      ) : (
        <>
          <div className={styles.sites}>
            {form.sites.map((host) => (
              <span key={host} className={styles.site}>
                {host}
                <button
                  type="button"
                  className={styles.siteRemove}
                  aria-label={`Remove ${host}`}
                  disabled={disabled}
                  onClick={() => onEdit({ sites: form.sites.filter((site) => site !== host) })}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              className={styles.siteInput}
              aria-label="Add a site"
              value={box.typed}
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
              placeholder={placeholder}
              onChange={(event) => box.type(event.target.value)}
              onBlur={box.add}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  box.add();
                }
              }}
            />
          </div>
          <span className={styles.hint} data-bad={note.bad} role="status" aria-live="polite">
            {note.text}
          </span>
        </>
      )}
    </div>
  );
}
