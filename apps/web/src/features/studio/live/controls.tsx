"use client";
import { Icon, Meter, Segmented } from "@pickler/ui";
import { SaveOutcome, saveLabel, useSavedForm, useSetupSave } from "../shell/setup-save";
import { VIEW_ONLY_REASON, entryDirty, entryPatch, stopRows } from "./build-model";
import { LiveSection, type LiveSectionProps } from "./live-section";
import {
  entryView,
  healthIssues,
  healthLabel,
  healthRows,
  liveCaps,
  liveEntry,
  liveStatus,
  liveWalletRead,
  liveWarnings,
  marketHealth,
  marketsView,
  meters,
  type LiveEntry,
} from "./model";
import { Reason } from "./reason";
import { StopAll } from "./runtime-parts";
import {
  runtimeEntryView,
  runtimeHealthRows,
  runtimeMeters,
  runtimeOn,
  runtimeStatus,
  runtimeStopRows,
} from "./runtime-model";
import styles from "./build.module.css";

const MODES: { value: LiveEntry["mode"]; label: string }[] = [
  { value: "auto", label: "On its own" },
  { value: "approve", label: "With my approval" },
];

const MEANWHILE: { value: LiveEntry["meanwhile"]; label: string }[] = [
  { value: "wait", label: "Wait" },
  { value: "small", label: "Go in small" },
];

/**
 * Controls (canvas 500–571, spec L13). STOPS: "Pause entries" real (`PUT /pause`, pending and an
 * inline failure), "Stop · close all" shut with Soon, Auto-pause tagged WITH THE RUNTIME. HOW IT
 * RUNS: `config.entry` with the canvas's control and its notes, said of the setting, saved with
 * "Save" (one `PUT /setup` with `entry`). The meters are real zeros against the caps, and HEALTH
 * reads the markets, its sources, gas, credits and the brief's version.
 *
 * With the Perpl runtime on (perpl-paper-runtime-v1 R11, R12, R16): "Stop · close all" is real on
 * paper with an inline confirm, Auto-pause is ON for the day-loss stop, HOW IT RUNS says it checks
 * hourly on paper, the meters are today's figures, and HEALTH adds the runtime and the model's cost
 * today.
 */
export function Controls({ agent, live, canManage, pause }: LiveSectionProps) {
  const record = runtimeOn(live.record) ? live.record : null;
  const { caps } = liveCaps(agent);
  const read = liveWalletRead(agent.wallet, live.wallets);
  const warnings = liveWarnings(read, caps.perTradeAusd);
  const market = marketHealth(
    marketsView(live.markets, live.details, agent.config.perpl?.markets ?? []),
  );
  const health = runtimeHealthRows(
    healthRows({
      market,
      sourcesOn: agent.config.sources?.web ? 2 : 1,
      monWei: read?.monWei ?? null,
      version: agent.version,
    }),
    live.record,
  );
  /* HEALTH's brief row is always APPLIED: Brief's edits are dropped when Brief closes, so none can
     be unapplied while Controls shows (`healthRows`). */
  const issues = healthIssues(warnings.length, health);

  return (
    <LiveSection section="controls">
      <div className={styles.grid}>
        <Stops agent={agent} live={live} canManage={canManage} pause={pause} runtime={!!record} />
        <div className={styles.card} id="live-controls-runs">
          <HowItRuns agent={agent} live={live} canManage={canManage} runtime={!!record} />
          <div className={styles.meters}>
            {(record ? runtimeMeters(caps, record.today) : meters(caps)).map((meter) => (
              <div key={meter.key} className={styles.meter}>
                <div className={styles.meterHead}>
                  <span className={styles.meterTitle}>{meter.title}</span>
                  <span className={styles.meterValue}>{meter.value}</span>
                </div>
                <Meter className={styles.meterTrack} value={meter.fill * 100} tone="lime" />
              </div>
            ))}
          </div>
        </div>
        <div className={styles.card} id="live-controls-health">
          <div className={styles.cardHead}>
            <h3 className={styles.cardLabel}>HEALTH</h3>
            <span className={styles.healthTag} data-bad={issues > 0}>
              {healthLabel(issues)}
            </span>
          </div>
          <ul className={styles.healthList}>
            {health.map((row) => (
              <li key={row.key} className={styles.healthRow}>
                <span className={styles.healthDot} data-tone={row.tone} aria-hidden="true" />
                <span className={styles.healthLabel}>{row.label}</span>
                <span className={styles.healthValue} data-tone={row.tone}>
                  {row.value}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </LiveSection>
  );
}

/**
 * STOPS · YOURS IN EVERY MODE: Pause entries is the header's own control here a second time, with
 * the same pending state (`usePauseToggle`); a failure pressed here is said here. With the runtime
 * on, "Stop · close all" is the header's too, asked here inline.
 */
function Stops({
  agent,
  live,
  canManage,
  pause,
  runtime,
}: Pick<LiveSectionProps, "agent" | "live" | "canManage" | "pause"> & { runtime: boolean }) {
  const shut = !canManage || pause.pending;

  return (
    <div className={styles.card} data-tone="stops" id="live-controls-stops">
      <div className={styles.cardHead}>
        <h3 className={styles.cardLabel}>STOPS · YOURS IN EVERY MODE</h3>
      </div>
      <ul className={styles.stops}>
        {(runtime ? runtimeStopRows(agent.paused) : stopRows(agent.paused)).map((row) => (
          <li key={row.key} className={styles.stop}>
            <span className={styles.stopText}>
              <span className={styles.stopName} data-danger={row.key === "stop"}>
                {row.name}
              </span>
              <span className={styles.stopNote}>{row.note}</span>
            </span>
            {runtime && row.key === "stop" ? (
              <StopAll
                live={live}
                canManage={canManage}
                id="live-stops-stop"
                className={styles.stopButton}
              />
            ) : row.action.kind === "button" ? (
              <button
                type="button"
                className={styles.stopButton}
                data-paused={agent.paused}
                aria-disabled={shut || undefined}
                aria-busy={pause.pending || undefined}
                aria-describedby={canManage ? undefined : "live-stops-reason"}
                title={canManage ? undefined : VIEW_ONLY_REASON}
                onClick={() => {
                  if (!shut) {
                    void pause.toggle("stops");
                  }
                }}
              >
                {pause.pendingLabel ?? row.action.label}
              </button>
            ) : (
              <span className={styles.stopTag}>{row.action.label}</span>
            )}
          </li>
        ))}
      </ul>
      <Reason id="live-stops-reason" text={canManage ? null : VIEW_ONLY_REASON} />
      {pause.error?.from === "stops" && (
        <p className={styles.alert} role="alert">
          <Icon name="alert" size={12} />
          {pause.error.text}
        </p>
      )}
    </div>
  );
}

/** HOW IT RUNS: the status, its note, BEFORE IT ENTERS and WHILE YOU DECIDE, and Save. */
function HowItRuns({
  agent,
  live,
  canManage,
  runtime,
}: Pick<LiveSectionProps, "agent" | "live" | "canManage"> & { runtime: boolean }) {
  const { caps } = liveCaps(agent);
  const saved = liveEntry({ entry: agent.config.entry, spend: { perCallAusd: caps.perTradeAusd } });
  const [form, setForm] = useSavedForm<LiveEntry>(agent.version, saved);
  const { state, save, touch, saving } = useSetupSave(live);
  const status = runtime ? runtimeStatus(agent.paused) : liveStatus(agent);
  const plain = entryView(form, caps.perTradeAusd);
  const view = runtime ? runtimeEntryView(plain) : plain;
  const dirty = entryDirty(form, saved, caps.perTradeAusd);
  const canSave = canManage && dirty && !saving;
  const shut = !canManage || saving;

  function edit(next: Partial<LiveEntry>) {
    setForm({ ...form, ...next });
    touch();
  }

  return (
    <>
      <div className={styles.cardHead}>
        <h3 className={styles.cardLabel}>HOW IT RUNS</h3>
        <span className={styles.headTag} data-tone={status.tone}>
          {status.label}
        </span>
      </div>
      <p className={styles.cardNote}>{view.statusNote}</p>
      <div className={styles.well}>
        <span className={styles.wellLabel}>BEFORE IT ENTERS</span>
        <Segmented
          label="Before it enters"
          options={MODES}
          className={styles.segments}
          optionClassName={styles.webMode}
          value={form.mode}
          disabled={shut}
          onChange={(mode) => edit({ mode })}
        />
        {view.asks && (
          <div className={styles.meanwhile}>
            <span className={styles.wellLabel} data-tone="muted">
              WHILE YOU DECIDE
            </span>
            <Segmented
              label="While you decide"
              options={MEANWHILE}
              optionClassName={styles.webMode}
              value={form.meanwhile}
              disabled={shut}
              onChange={(meanwhile) => edit({ meanwhile })}
            />
            {view.small && (
              <span className={styles.small}>
                <span className={styles.wellLabel} data-tone="muted">
                  AT
                </span>
                <button
                  type="button"
                  className={styles.smallButton}
                  aria-label="Lower the small entry"
                  disabled={shut || view.amount.prev === null}
                  onClick={() => {
                    if (view.amount.prev !== null) {
                      edit({ smallAusd: view.amount.prev });
                    }
                  }}
                >
                  −
                </button>
                <span className={styles.smallValue} aria-live="polite">
                  {view.amount.display}
                </span>
                <button
                  type="button"
                  className={styles.smallButton}
                  aria-label="Raise the small entry"
                  disabled={shut || view.amount.next === null}
                  onClick={() => {
                    if (view.amount.next !== null) {
                      edit({ smallAusd: view.amount.next });
                    }
                  }}
                >
                  +
                </button>
              </span>
            )}
          </div>
        )}
        <span className={styles.hint}>{view.modeNote}</span>
      </div>
      {(dirty || state.kind !== "idle") && (
        <div className={styles.saveRow}>
          <button
            type="button"
            className={styles.saveButton}
            aria-disabled={!canSave || undefined}
            aria-describedby={canManage ? undefined : "live-entry-reason"}
            title={canManage ? undefined : VIEW_ONLY_REASON}
            onClick={() => {
              if (canSave) {
                void save({ entry: entryPatch(form, caps.perTradeAusd) });
              }
            }}
          >
            {saveLabel(state, dirty, "Save")}
          </button>
          {dirty && (
            <button
              type="button"
              className={styles.discardButton}
              aria-disabled={shut || undefined}
              onClick={() => {
                if (!shut) {
                  setForm(saved);
                  touch();
                }
              }}
            >
              Discard
            </button>
          )}
          <Reason id="live-entry-reason" text={canManage ? null : VIEW_ONLY_REASON} />
        </div>
      )}
      <SaveOutcome state={state} />
    </>
  );
}
