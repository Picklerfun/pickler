"use client";
import { TradingMarkets, useTradingMarkets } from "../shell/trading-markets";
import { Icon } from "@pickler/ui";
import { sourcesView, webForm, type WebForm } from "../shell/build-model";
import { SaveOutcome, saveLabel, useSavedForm, useSetupSave } from "../shell/setup-save";
import { WebSites, useSiteBox } from "../shell/web-sites";
import { RunNote } from "./run-note";
import { DraftSection, type DraftSectionProps } from "./draft-section";
import styles from "./build.module.css";

/**
 * Sources & rules (canvas 712–766, spec §3.5): IT READS, Perpl always and the web through Exa
 * when switched on, where the web may look and its sites; "Save sources" is one
 * `draft.saveSetup` with `sources.web` (null when the web is off). A site the box refused stays
 * in it with the reason, and Save waits until it is fixed or cleared.
 */
export function Sources({ agent, draft, canManage, onSection }: DraftSectionProps) {
  const saved = webForm(agent.config.sources?.web);
  const [form, setForm] = useSavedForm<WebForm>(
    agent.version,
    saved,
    `${agent.productId ?? agent.id}:sources:form`,
  );
  const { state, save, touch, saving } = useSetupSave(
    draft,
    `${agent.productId ?? agent.id}:sources`,
    agent.version,
  );
  const [markets, setMarkets] = useSavedForm<string[]>(
    agent.version,
    agent.config.perpl?.markets ?? [],
    `${agent.productId ?? agent.id}:sources:markets`,
  );
  const network = agent.config.perpl?.network ?? null;
  const catalogue = useTradingMarkets(network, draft.preview);
  const marketsDirty =
    JSON.stringify(markets) !== JSON.stringify(agent.config.perpl?.markets ?? []);
  const dirty = viewDirty();
  function viewDirty() {
    return JSON.stringify(form) !== JSON.stringify(saved) || marketsDirty;
  }

  function edit(next: Partial<WebForm>) {
    setForm({ ...form, ...next });
    touch();
  }

  const box = useSiteBox(
    form.sites,
    (sites) => edit({ sites }),
    `${agent.productId ?? agent.id}:sources`,
    agent.version,
  );
  const view = sourcesView(form, saved, box.error);
  /* A rejected site still in the box (`box.refused`): saving now would quietly leave it out. */
  const canSave =
    canManage &&
    dirty &&
    !view.needsSite &&
    !box.refused &&
    !saving &&
    (!marketsDirty || catalogue.allows(markets));
  const shut = !canManage || saving;

  return (
    <DraftSection section="skills">
      <div className={styles.column}>
        <RunNote onRun={() => onSection("console")} />
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
            <WebSites
              idPrefix="draft"
              form={form}
              box={box}
              note={view.note}
              disabled={shut}
              placeholder={form.sites.length ? "Add a site" : "coindesk.com, x.com…"}
              onEdit={edit}
            />
          )}
        </div>
        <button
          type="button"
          className={styles.saveButton}
          disabled={!canManage}
          aria-disabled={!canSave || undefined}
          onClick={() => {
            if (canSave) {
              void save({ sources: view.sources, ...(marketsDirty ? { markets } : {}) });
            }
          }}
        >
          {saveLabel(state, dirty, "Save sources")}
        </button>
        <SaveOutcome state={state} />
      </div>
    </DraftSection>
  );
}
