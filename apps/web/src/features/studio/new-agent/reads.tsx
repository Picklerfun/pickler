"use client";
import { useState } from "react";
import { Icon, Segmented } from "@pickler/ui";
import { MAX_SITES, siteHost, siteNote, type NewAgentForm, type WebMode } from "./model";
import styles from "./new-agent.module.css";

const MODES: { value: WebMode; label: string }[] = [
  { value: "anywhere", label: "Anywhere" },
  { value: "prefer", label: "Prefer these" },
  { value: "only", label: "Only these" },
];

/** "It reads": Perpl, always on, and the web through Exa, off until switched on, with its sites. */
export function Reads({
  form,
  disabled,
  onChange,
}: {
  form: NewAgentForm;
  disabled: boolean;
  onChange(next: NewAgentForm): void;
}) {
  const [draft, setDraft] = useState("");
  function add() {
    const host = siteHost(draft);
    if (!host || form.sites.includes(host) || form.sites.length >= MAX_SITES) {
      return;
    }
    onChange({ ...form, sites: [...form.sites, host] });
    setDraft("");
  }
  const note = siteNote(form, draft);
  return (
    <div className={`${styles.card} ${styles.cardRoomy}`} id="new-agent-reads">
      <div className={styles.cardHead}>
        <span className={styles.label}>IT READS</span>
        <span className={styles.sub}>Perpl is always its market · the web is optional</span>
        <span className={styles.tag}>{form.webOn ? "PERPL + WEB" : "PERPL ONLY"}</span>
      </div>
      <div className={styles.plugins}>
        <div
          className={styles.plugin}
          data-on="true"
          data-fixed="true"
          title="listPerpMarkets · getPerpSnapshot · getPerpOrderBook · getPerpCandles · getPerpFundingHistory"
        >
          <span className={styles.pluginText}>
            <span className={styles.pluginName}>Perpl</span>
            <span className={styles.pluginNote}>Perp markets, books, funding, candles · Monad</span>
          </span>
          <span className={styles.fixed} role="img" aria-label="Always on">
            <Icon name="lock" size={11} />
          </span>
        </div>
        <button
          type="button"
          className={styles.plugin}
          data-on={form.webOn}
          role="switch"
          aria-checked={form.webOn}
          disabled={disabled}
          title="searchWeb · readPage"
          onClick={() => onChange({ ...form, webOn: !form.webOn })}
        >
          <span className={styles.pluginText}>
            <span className={styles.pluginName}>Web</span>
            <span className={styles.pluginNote}>Search and page reads via Exa</span>
          </span>
          <span className={styles.toggle} data-on={form.webOn} aria-hidden="true">
            <i />
          </span>
        </button>
      </div>
      {form.webOn && (
        <div className={styles.web} id="new-agent-web">
          <div className={styles.webHead}>
            <span className={styles.webTitle}>WEB · WHERE EXA MAY LOOK</span>
            <Segmented
              label="Where the web may look"
              options={MODES}
              value={form.webMode}
              onChange={(webMode) => {
                if (!disabled) {
                  onChange({ ...form, webMode });
                }
              }}
            />
          </div>
          {form.webMode === "anywhere" ? (
            <span className={styles.note}>
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
                      onClick={() =>
                        onChange({ ...form, sites: form.sites.filter((site) => site !== host) })
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  className={styles.siteInput}
                  aria-label="Add a site"
                  value={draft}
                  disabled={disabled}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={form.sites.length ? "Add a site" : "coindesk.com, x.com…"}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={add}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      add();
                    } else if (event.key === "Backspace" && !draft && form.sites.length) {
                      onChange({ ...form, sites: form.sites.slice(0, -1) });
                    }
                  }}
                />
              </div>
              <span className={styles.note} data-bad={note.bad} role="status" aria-live="polite">
                {note.text}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
