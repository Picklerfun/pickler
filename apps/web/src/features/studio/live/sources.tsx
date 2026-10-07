"use client";
import { TradingMarkets, useTradingMarkets } from "../shell/trading-markets";
import { Icon } from "@pickler/ui";
import { sourcesView, webForm, type WebForm } from "../shell/build-model";
import { SaveOutcome, saveLabel, useSavedForm, useSetupSave } from "../shell/setup-save";
import { WebSites, useSiteBox } from "../shell/web-sites";
import { VIEW_ONLY_REASON, pluginCount, pluginRows } from "./build-model";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { SOURCES_BAR, abilities } from "./model";
import { Reason } from "./reason";
import styles from "./build.module.css";

/**
 * Sources & rules (canvas 393–454, spec L15). IT READS: Perpl fixed, the web a switch with the
 * draft's site editing (`sourcesView`, `addSite`), X feeds and Open interest shut, Soon. Saving is
 * "Apply as v{n+1}" in the bar, one `PUT /setup` with `sources.web` (null when off). IT MAY is
 * read-only: opening follows Pause entries, the rest are fixed or Soon. The site editing is the
 * draft's own (`../shell/web-sites.tsx`).
 */
export function Sources({ agent, live, canManage }: LiveSectionProps) {
  const saved = webForm(agent.config.sources?.web);
  const [form, setForm] = useSavedForm<WebForm>(agent.version, saved);
  const { state, save, touch, saving } = useSetupSave(live);
  const [markets, setMarkets] = useSavedForm<string[]>(
    agent.version,
    agent.config.perpl?.markets ?? [],
  );
  const network = agent.config.perpl?.network ?? null;
  const catalogue = useTradingMarkets(network, live.preview);
  const marketsDirty =
    JSON.stringify(markets) !== JSON.stringify(agent.config.perpl?.markets ?? []);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved) || marketsDirty;

  function edit(next: Partial<WebForm>) {
    setForm({ ...form, ...next });
    touch();
  }

  const box = useSiteBox(form.sites, (sites) => edit({ sites }));
  const view = sourcesView(form, saved, box.error);
  /* A rejected site still in the box (`box.refused`): applying now would quietly leave it out. */
  const canApply =
    canManage &&
    dirty &&
    !view.needsSite &&
    !box.refused &&
    !saving &&
    (!marketsDirty || catalogue.allows(markets));
  const shut = !canManage || saving;

  return (
    <LiveSection section="skills">
      <div className={styles.column}>
        <div className={styles.bar} id="live-sources-bar">
          <span className={styles.barDot} aria-hidden="true" />
          <span className={styles.barText}>{SOURCES_BAR}</span>
          {(dirty || state.kind !== "idle") && (
            <>
              {dirty && (
                <button
                  type="button"
                  className={styles.barDiscard}
                  aria-disabled={shut || undefined}
                  onClick={() => {
                    if (!shut) {
                      setForm(saved);
                      setMarkets(agent.config.perpl?.markets ?? []);
                      box.clear();
                      touch();
                    }
                  }}
                >
                  Discard
                </button>
              )}
              <button
                type="button"
                className={styles.barApply}
                aria-disabled={!canApply || undefined}
                aria-describedby={canManage ? undefined : "live-sources-reason"}
                title={canManage ? undefined : VIEW_ONLY_REASON}
                onClick={() => {
                  if (canApply) {
                    void save({ sources: view.sources, ...(marketsDirty ? { markets } : {}) });
                  }
                }}
              >
                {saveLabel(state, dirty, `Apply as v${agent.version + 1}`)}
              </button>
              <Reason id="live-sources-reason" text={canManage ? null : VIEW_ONLY_REASON} />
            </>
          )}
        </div>
        <SaveOutcome state={state} />
        <TradingMarkets
          read={catalogue}
          network={network}
          value={markets}
          disabled={shut}
          onChange={(next) => {
            setMarkets(next);
            touch();
          }}
        />
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
              const noteId = `live-sources-note-${plugin.key}`;
              /* A switch's ON / OFF line is its state, which `aria-checked` already says: its name
                 is "Web", and the note describes it. */
              const text = (
                <span className={styles.pluginText}>
                  <span className={styles.pluginName}>{plugin.name}</span>
                  <span className={styles.pluginNote} id={noteId}>
                    {plugin.note}
                  </span>
                  <span
                    className={styles.pluginLine}
                    aria-hidden={plugin.kind === "switch" || undefined}
                  >
                    {plugin.line}
                  </span>
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
                    aria-label={plugin.name}
                    aria-describedby={noteId}
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
            <WebSites
              idPrefix="live"
              form={form}
              box={box}
              note={view.note}
              disabled={shut}
              placeholder="add a site…"
              onEdit={edit}
            />
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
