"use client";
import { useState } from "react";
import { Button, Icon, Meter, Segmented } from "@pickler/ui";
import { setSchedule } from "../api";
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
  paperShown,
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
 * today. With it off and a paper account (R3), the stops, meters and HEALTH are the same, saying
 * checks are paused; HOW IT RUNS keeps describing the setting.
 */
export function Controls({ agent, live, canManage, pause }: LiveSectionProps) {
  const record = paperShown(live.record) ? live.record : null;
  const running = record?.runtimeEnabled ?? false;
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
        <Stops
          agent={agent}
          live={live}
          canManage={canManage}
          pause={pause}
          runtime={!!record}
          running={running}
        />
        <div className={styles.card} id="live-controls-runs">
          <HowItRuns agent={agent} live={live} canManage={canManage} paper={!!record} />
          <HourlySchedule agent={agent} live={live} canManage={canManage} />
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

/** Explicit scheduling remains separate from publication and entry approval mode. */
function HourlySchedule({
  agent,
  live,
  canManage,
}: Pick<LiveSectionProps, "agent" | "live" | "canManage">) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const on = agent.scheduleEnabled;
  const ready =
    paperShown(live.record) && live.record.runtimeEnabled && agent.canSchedule.ok && !agent.paused;
  const disabled = busy || live.preview || !canManage || (!on && !ready);
  let note =
    "Hourly checks are off. Complete a successful manual check for this configuration first.";
  if (on) {
    note = "Hourly checks are on. Turning them off preserves positions and their exits.";
  } else if (ready) {
    note = "Prepared for this configuration. Enable hourly paper checks when ready.";
  } else if (!agent.canSchedule.ok && agent.canSchedule.reason === "unfunded") {
    note = "Fund its wallet with at least 10 AUSD before enabling hourly checks.";
  }
  async function toggle() {
    if (disabled) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await setSchedule(agent.productId ?? agent.id, !on);
      await live.refreshAgent();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not change hourly checks.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.well} id="live-hourly-schedule">
      <span className={styles.wellLabel}>HOURLY PAPER CHECKS</span>
      <p className={styles.cardNote}>{note}</p>
      <Button
        role="switch"
        aria-label="Hourly paper checks"
        aria-checked={on}
        disabled={disabled}
        onClick={() => void toggle()}
      >
        {busy ? "Saving…" : on ? "Disable hourly checks" : "Enable hourly checks"}
      </Button>
      {error && (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * STOPS · YOURS IN EVERY MODE: Pause entries is the header's own control here a second time, with
 * the same pending state (`usePauseToggle`); a failure pressed here is said here. With paper held
 * (`runtime`: the runtime on, or a paper account), "Stop · close all" is the header's too, asked
 * here inline; `running` says whether the runtime is on.
 */
function Stops({
  agent,
  live,
  canManage,
  pause,
  runtime,
  running,
}: Pick<LiveSectionProps, "agent" | "live" | "canManage" | "pause"> & {
  runtime: boolean;
  running: boolean;
}) {
  const shut = !canManage || pause.pending;

  return (
    <div className={styles.card} data-tone="stops" id="live-controls-stops">
      <div className={styles.cardHead}>
        <h3 className={styles.cardLabel}>STOPS · YOURS IN EVERY MODE</h3>
      </div>
      <ul className={styles.stops}>
        {(runtime ? runtimeStopRows(agent.paused, running) : stopRows(agent.paused)).map((row) => (
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

/**
 * HOW IT RUNS: the status, its note, BEFORE IT ENTERS and WHILE YOU DECIDE, and Save. The notes say
 * it checks hourly on paper only with the runtime on; the status is the header's (`paper`: held).
 */
function HowItRuns({
  agent,
  live,
  canManage,
  paper,
}: Pick<LiveSectionProps, "agent" | "live" | "canManage"> & { paper: boolean }) {
  const runtime = runtimeOn(live.record);
  const { caps } = liveCaps(agent);
  const saved = liveEntry({ entry: agent.config.entry, spend: { perCallAusd: caps.perTradeAusd } });
  const [form, setForm] = useSavedForm<LiveEntry>(agent.version, saved);
  const { state, save, touch, saving } = useSetupSave(live);
  const status = paper ? runtimeStatus(agent.paused, runtime) : liveStatus(agent);
  const plain = entryView(form, caps.perTradeAusd);
  const view = runtime ? runtimeEntryView(plain, agent.scheduleEnabled && !agent.paused) : plain;
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
