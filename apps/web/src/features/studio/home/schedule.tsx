"use client";
import { useState } from "react";
import { Icon, Segmented } from "@pickler/ui";
import { setIntervalHours, setSchedule, type Agent } from "../api";
import {
  INTERVALS,
  intervalLabel,
  intervalOption,
  scheduleView,
  type IntervalHours,
} from "./status";
import shell from "../studio.module.css";
import styles from "./home.module.css";

/**
 * "Run on its own": how often (every 3h, 6h, 12h or daily) and the switch. The switch reads the
 * lock the API answered (`canSchedule`) and says why it is locked; one that is on can always be
 * turned off. The interval has its own route, so choosing it keeps the schedule and readiness.
 */
export function Schedule({
  agent,
  now,
  preview,
  canManage,
  onRefresh,
}: {
  agent: Agent;
  now: number;
  preview: boolean;
  canManage: boolean;
  onRefresh(): Promise<void>;
}) {
  const agentId = agent.productId ?? agent.id;
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const view = scheduleView(agent, now);
  const on = agent.scheduleEnabled;
  const hours = agent.config.intervalHours;
  const inert = preview || !canManage || busy;

  async function act(operation: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={styles.schedule}
      id="home-schedule"
      aria-label="Run on its own"
      data-on={on}
    >
      <span className={styles.grow}>
        <span className={styles.scheduleTitle} data-locked={view.locked}>
          Run on its own
          <button
            type="button"
            className={styles.intervalButton}
            title="Change how often"
            aria-expanded={picking}
            onClick={() => setPicking(!picking)}
          >
            {intervalLabel(hours)}
            <Icon name="chevronDown" size={12} />
          </button>
        </span>
        <span className={styles.scheduleNote}>{view.note}</span>
        {picking && (
          <Segmented<`${IntervalHours}`>
            label="How often it runs"
            className={styles.intervals}
            options={INTERVALS.map((value) => ({
              value: `${value}` as const,
              label: intervalOption(value),
            }))}
            value={`${hours}` as `${IntervalHours}`}
            onChange={(next) => {
              const chosen = Number(next) as IntervalHours;
              setPicking(false);
              if (chosen === hours || inert) {
                return;
              }
              void act(() => setIntervalHours(agentId, chosen));
            }}
          />
        )}
        {error && (
          <span className={styles.alert} role="alert">
            <Icon name="alert" size={13} />
            {error}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Run on its own"
        className={styles.switch}
        title={view.title}
        disabled={view.locked || inert || agent.paused}
        onClick={() => void act(() => setSchedule(agentId, !on))}
      >
        <span className={shell.track} data-on={on} data-size="lg">
          <span className={shell.knob} />
        </span>
      </button>
    </section>
  );
}
