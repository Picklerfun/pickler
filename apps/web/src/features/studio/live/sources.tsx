"use client";
import { useState } from "react";
import { Icon, Segmented } from "@pickler/ui";
import type { WebMode } from "../new-agent/model";
import { addSite, sourcesView, webForm, type WebForm } from "../shell/build-model";
import { SaveOutcome, saveLabel, useSavedForm, useSetupSave } from "../shell/setup-save";
import { useVersionedStudio } from "./brief";
import { pluginCount, pluginRows } from "./build-model";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { SOURCES_BAR, abilities } from "./model";
import styles from "./build.module.css";

const MODES: { value: WebMode; label: string }[] = [
  { value: "anywhere", label: "Anywhere" },
  { value: "prefer", label: "Prefer these" },
  { value: "only", label: "Only these" },
];

/**
 * Sources & rules (canvas 393–454, spec L15). IT READS: Perpl fixed, the web a switch with the
 * draft's site editing (`sourcesView`, `addSite`), X feeds and Open interest shut, Soon. Saving is
 * "Apply as v{n+1}" in the bar, one `PUT /setup` with `sources.web` (null when off). IT MAY is
 * read-only: opening follows Pause entries, the rest are fixed or Soon.
 */
export function Sources({ agent, live, canManage }: LiveSectionProps) {
  const saved = webForm(agent.config.sources?.web);
  const [form, setForm] = useSavedForm<WebForm>(agent.version, saved);
  const [typed, setTyped] = useState("");
  const [siteError, setSiteError] = useState<string | null>(null);
  const studio = useVersionedStudio(live);
  const { state, save, touch, saving } = useSetupSave(studio);

  const view = sourcesView(form, saved, siteError);
  /* A rejected site still in the box: applying now would quietly leave it out. */
  const refusedSite = Boolean(typed.trim() && siteError);
  const canApply = canManage && view.dirty && !view.needsSite && !refusedSite && !saving;
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
    <LiveSection section="skills">
      <div className={styles.column}>
        <div className={styles.bar} id="live-sources-bar">
          <span className={styles.barDot} aria-hidden="true" />
          <span className={styles.barText}>{SOURCES_BAR}</span>
          {(view.dirty || saving) && (
            <>
              <button
                type="button"
                className={styles.barDiscard}
                disabled={shut}
                onClick={() => {
                  setForm(saved);
                  setTyped("");
                  setSiteError(null);
                  touch();
                }}
              >
                Discard
              </button>
              <button
                type="button"
                className={styles.barApply}
                disabled={!canManage}
                aria-disabled={!canApply || undefined}
                onClick={() => {
                  if (canApply) {
                    void save({ sources: view.sources });
                  }
                }}
              >
                {saveLabel(state, view.dirty, `Apply as v${agent.version + 1}`)}
              </button>
            </>
          )}
        </div>
        <SaveOutcome state={state} />
        <div className={styles.field} data-roomy="true" id="live-sources-reads">
          <div className={styles.fieldHead}>
            <span className={styles.fieldLabel}>IT READS</span>
            <span className={styles.fieldSub}>
              Perpl is always its market · the rest is optional
            </span>
            <span className={styles.tag}>{pluginCount(form.on)}</span>
          </div>
          <div className={styles.plugins}>
            {pluginRows(form.on).map((plugin) => {
              const text = (
                <span className={styles.pluginText}>
                  <span className={styles.pluginName}>{plugin.name}</span>
                  <span className={styles.pluginNote}>{plugin.note}</span>
                  <span className={styles.pluginLine}>{plugin.line}</span>
                </span>
              );
              if (plugin.kind === "switch") {
                return (
                  <button
                    key={plugin.key}
                    type="button"
                    className={styles.plugin}
                    data-on={plugin.on}
                    role="switch"
                    aria-checked={plugin.on}
                    disabled={shut}
                    title={plugin.tools}
                    onClick={() => edit({ on: !form.on })}
                  >
                    {text}
                    <span className={styles.toggle} data-on={plugin.on} aria-hidden="true">
                      <i />
                    </span>
                  </button>
                );
              }
              return (
                <div
                  key={plugin.key}
                  className={styles.plugin}
                  data-on={plugin.on}
                  data-kind={plugin.kind}
                  title={plugin.tools}
                >
                  {text}
                  {plugin.kind === "fixed" ? (
                    <span className={styles.fixed} role="img" aria-label="Always on">
                      <Icon name="lock" size={11} />
                    </span>
                  ) : (
                    <span className={styles.soonTag}>SOON</span>
                  )}
                </div>
              );
            })}
          </div>
          {form.on && (
            <div className={styles.web} id="live-sources-web">
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
                      placeholder="add a site…"
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
        <div className={styles.field} data-roomy="true" id="live-sources-may">
          <div className={styles.fieldHead}>
            <span className={styles.fieldLabel}>IT MAY</span>
            <span className={styles.fieldSub}>what it is allowed to do on its own</span>
          </div>
          <ul className={styles.plugins}>
            {abilities(agent.paused).map((ability) => (
              <li key={ability.key} className={styles.plugin} data-on={ability.on}>
                <span className={styles.pluginText}>
                  <span className={styles.pluginName}>{ability.name}</span>
                  <span className={styles.pluginNote}>{ability.note}</span>
                </span>
                <span className={styles.abilityTag} data-tag={ability.tag}>
                  {ability.tag}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </LiveSection>
  );
}
