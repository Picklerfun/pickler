"use client";
import { useState } from "react";
import { Icon, Segmented } from "@pickler/ui";
import type { WebMode } from "../new-agent/model";
import { RunNote } from "./build-parts";
import { addSite, sourcesView, webForm, type WebForm } from "./build-model";
import { DraftSection, type DraftSectionProps } from "./section";
import { SaveOutcome, saveLabel, useSavedForm, useSetupSave } from "./setup-save";
import styles from "./build.module.css";

const MODES: { value: WebMode; label: string }[] = [
  { value: "anywhere", label: "Anywhere" },
  { value: "prefer", label: "Prefer these" },
  { value: "only", label: "Only these" },
];

/**
 * Sources & rules (canvas 712–766, spec §3.5): IT READS, Perpl always and the web through Exa
 * when switched on, where the web may look and its sites; "Save sources" is one
 * `draft.saveSetup` with `sources.web` (null when the web is off). A site the box refused stays
 * in it with the reason, and Save waits until it is fixed or cleared.
 */
export function Sources({ agent, draft, canManage, onSection }: DraftSectionProps) {
  const saved = webForm(agent.config.sources?.web);
  const [form, setForm] = useSavedForm<WebForm>(agent.version, saved);
  const [typed, setTyped] = useState("");
  const [siteError, setSiteError] = useState<string | null>(null);
  const { state, save, touch, saving } = useSetupSave(draft);

  const view = sourcesView(form, saved, siteError);
  /* A rejected site still in the box: saving now would quietly leave it out. */
  const refusedSite = Boolean(typed.trim() && siteError);
  const canSave = canManage && view.dirty && !view.needsSite && !refusedSite && !saving;
  const shut = !canManage || saving;

  function edit(next: Partial<WebForm>) {
    setForm({ ...form, ...next });
    touch();
  }

  function add() {
    const result = addSite(form.sites, typed);
    setTyped(result.draft);
    setSiteError(result.error);
    if (result.sites.length !== form.sites.length) {
      edit({ sites: result.sites });
    }
  }

  return (
    <DraftSection section="skills">
      <div className={styles.column}>
        <RunNote onRun={() => onSection("console")} />
        <div className={styles.field} data-roomy="true">
          <div className={styles.fieldHead}>
            <span className={styles.fieldLabel}>IT READS</span>
            <span className={styles.fieldSub}>
              Perpl is always its market · the web is optional
            </span>
            <span className={styles.tag}>{view.tag}</span>
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
                <span className={styles.pluginNote}>
                  Perp markets, books, funding, candles · Monad
                </span>
              </span>
              <span className={styles.fixed} role="img" aria-label="Always on">
                <Icon name="check" size={11} />
              </span>
            </div>
            <button
              type="button"
              className={styles.plugin}
              data-on={form.on}
              role="switch"
              aria-checked={form.on}
              disabled={shut}
              title="searchWeb · readPage"
              onClick={() => edit({ on: !form.on })}
            >
              <span className={styles.pluginText}>
                <span className={styles.pluginName}>Web</span>
                <span className={styles.pluginNote}>Search and page reads via Exa</span>
              </span>
              <span className={styles.toggle} data-on={form.on} aria-hidden="true">
                <i />
              </span>
            </button>
          </div>
          {form.on && (
            <div className={styles.web} id="draft-sources-web">
              <div className={styles.webHead}>
                <span className={styles.webTitle}>WEB · WHERE EXA MAY LOOK</span>
                <Segmented
                  label="Where the web may look"
                  options={MODES}
                  optionClassName={styles.webMode}
                  value={form.mode}
                  disabled={shut}
                  onChange={(mode) => edit({ mode })}
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
                          disabled={shut}
                          onClick={() =>
                            edit({ sites: form.sites.filter((site) => site !== host) })
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      className={styles.siteInput}
                      aria-label="Add a site"
                      value={typed}
                      disabled={shut}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={form.sites.length ? "Add a site" : "coindesk.com, x.com…"}
                      onChange={(event) => {
                        setTyped(event.target.value);
                        setSiteError(null);
                      }}
                      onBlur={add}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          add();
                        }
                      }}
                    />
                  </div>
                  <span
                    className={styles.hint}
                    data-bad={view.note.bad}
                    role="status"
                    aria-live="polite"
                  >
                    {view.note.text}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className={styles.saveButton}
          disabled={!canManage}
          aria-disabled={!canSave || undefined}
          onClick={() => {
            if (canSave) {
              void save({ sources: view.sources });
            }
          }}
        >
          {saveLabel(state, view.dirty, "Save sources")}
        </button>
        <SaveOutcome state={state} />
      </div>
    </DraftSection>
  );
}
