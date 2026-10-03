"use client";
import { useState } from "react";
import { Icon, Meter, Segmented } from "@pickler/ui";
import { SaveOutcome, saveLabel, useSavedForm, useSetupSave } from "../shell/setup-save";
import { useVersionedStudio } from "./brief";
import { entryDirty, entryPatch, liveEntryView, stopRows } from "./build-model";
import { LiveSection, type LiveSectionProps } from "./live-section";
import {
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
 */
export function Controls({ agent, live, canManage }: LiveSectionProps) {
  const { caps } = liveCaps(agent);
  const read = liveWalletRead(agent.wallet, live.wallets);
  const warnings = liveWarnings(read, caps.perTradeAusd);
  const market = marketHealth(
    marketsView(live.markets, live.details, agent.config.perpl?.markets ?? []),
  );
  const health = healthRows({
    market,
    sourcesOn: agent.config.sources?.web ? 2 : 1,
    monWei: read?.monWei ?? null,
    version: agent.version,
    briefDirty: false,
  });

  return (
    <LiveSection section="controls">
      <div className={styles.grid}>
        <Stops agent={agent} live={live} canManage={canManage} />
        <div className={styles.card} id="live-controls-runs">
          <HowItRuns agent={agent} live={live} canManage={canManage} />
          <div className={styles.meters}>
            {meters(caps).map((meter) => (
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
            <span className={styles.healthTag} data-bad={warnings.length > 0}>
              {healthLabel(warnings.length)}
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

/** STOPS · YOURS IN EVERY MODE: Pause entries is the header's own call, here a second time. */
function Stops({ agent, live, canManage }: Pick<LiveSectionProps, "agent" | "live" | "canManage">) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");

  async function flip() {
    if (pending) {
      return;
    }
    setPending(true);
    setFailure("");
    try {
      await live.pause(!agent.paused);
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : "Could not change it.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.card} data-tone="stops" id="live-controls-stops">
      <div className={styles.cardHead}>
        <h3 className={styles.cardLabel}>STOPS · YOURS IN EVERY MODE</h3>
      </div>
      <ul className={styles.stops}>
        {stopRows(agent.paused).map((row) => (
          <li key={row.key} className={styles.stop}>
            <span className={styles.stopText}>
              <span className={styles.stopName} data-danger={row.key === "stop"}>
                {row.name}
              </span>
              <span className={styles.stopNote}>{row.note}</span>
            </span>
            {row.action.kind === "button" ? (
              <button
                type="button"
                className={styles.stopButton}
                data-paused={agent.paused}
                disabled={!canManage}
                aria-disabled={pending || undefined}
                aria-busy={pending}
                onClick={() => void flip()}
              >
                {pending ? (agent.paused ? "Resuming…" : "Pausing…") : row.action.label}
              </button>
            ) : (
              <span className={styles.stopTag}>{row.action.label}</span>
            )}
          </li>
        ))}
      </ul>
      {failure && (
        <p className={styles.alert} role="alert">
          <Icon name="alert" size={12} />
          {failure}
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
}: Pick<LiveSectionProps, "agent" | "live" | "canManage">) {
  const { caps } = liveCaps(agent);
  const saved = liveEntry({ entry: agent.config.entry, spend: { perCallAusd: caps.perTradeAusd } });
  const [form, setForm] = useSavedForm<LiveEntry>(agent.version, saved);
  const studio = useVersionedStudio(live);
  const { state, save, touch, saving } = useSetupSave(studio);
  const status = liveStatus(agent);
  const view = liveEntryView(form, caps.perTradeAusd);
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
            disabled={!canManage}
            aria-disabled={!canSave || undefined}
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
              disabled={shut}
              onClick={() => {
                setForm(saved);
                touch();
              }}
            >
              Discard
            </button>
          )}
        </div>
      )}
      <SaveOutcome state={state} />
    </>
  );
}
