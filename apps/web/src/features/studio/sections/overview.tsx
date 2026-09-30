"use client";
import { useState } from "react";
import { Button, Icon, Input } from "@pickler/ui";
import type { Agent, Run } from "../api";
import { clock, runMark, runSummary } from "../decision";
import type { SectionKey } from "./keys";
import styles from "../studio.module.css";

/** How long until the next scheduled run, said the way a person would say it. */
function untilNext(at: number | null, now: number): string {
  if (at === null) {
    return "—";
  }
  const minutes = Math.round((at - now) / 60000);
  if (minutes <= 0) {
    return "Due now";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function Overview({
  agent,
  runs,
  runsToday,
  now,
  busy,
  canManage,
  runsLocked,
  scheduleLocked,
  blocked,
  onRun,
  onSchedule,
  onOpen,
  go,
}: {
  agent: Agent;
  runs: Run[];
  runsToday: number;
  /** The wall clock, ticking from the shell, so the countdown stays honest without a re-fetch. */
  now: number;
  busy: boolean;
  canManage: boolean;
  runsLocked: boolean;
  scheduleLocked: boolean;
  blocked: string;
  onRun(marketId: string): void;
  onSchedule(): void;
  onOpen(run: Run): void;
  go(section: SectionKey): void;
}) {
  const [marketId, setMarketId] = useState("");
  const scheduleOn = agent.scheduleEnabled && !agent.paused && !scheduleLocked;
  const quotaMax = agent.config.limits.dailyRuns;
  const decisions = runs.filter((run) => run.decision);
  const marks = decisions.map((run) => runMark(run).mark);
  const tools = agent.config.tools.length;
  const plugins = agent.config.plugins?.enabled.length ?? 0;
  const headline = agent.paused
    ? "Paused"
    : scheduleLocked
      ? "Locked"
      : !agent.scheduleEnabled
        ? "Off"
        : untilNext(agent.nextDueAt, now);
  /* Two different locks read the same on the card but need different advice: NOT_READY is on the
     operator of this agent and clears with one manual run; access denial is on the operator of the
     workspace and no amount of running will clear it. */
  const denied = blocked === "RESEARCH_ACCESS_DENIED";
  const sub = agent.paused
    ? "RESUME TO SCHEDULE"
    : scheduleLocked
      ? `${blocked || "NOT_READY"} · ${denied ? "WAITING ON AN OPERATOR" : "RUN ONCE BY HAND"}`
      : !agent.scheduleEnabled
        ? "SCHEDULE DISABLED · MANUAL ONLY"
        : `NEXT DUE ${clock(agent.nextDueAt)} · LAST ${clock(runs[0]?.createdAt ?? null)}`;

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h1>Overview</h1>
        <p>what it is about to do, and what it just did</p>
      </div>
      <div className={styles.cards}>
        <section className={styles.card}>
          <div className={styles.split}>
            <div className={styles.grow}>
              <p className={styles.eyebrow}>NEXT RUN</p>
              <p className={styles.big} data-quiet={!scheduleOn}>
                {headline}
              </p>
              <p className={styles.mono}>{sub}</p>
            </div>
            <button
              type="button"
              className={styles.switch}
              disabled={scheduleLocked || !canManage || busy || agent.paused}
              aria-pressed={scheduleOn}
              title={
                scheduleLocked
                  ? "Locked until a connection check and one manual run succeed"
                  : agent.scheduleEnabled
                    ? "Turn the schedule off"
                    : "Turn the schedule on"
              }
              onClick={onSchedule}
            >
              <span className={styles.track} data-on={scheduleOn}>
                <span className={styles.knob} />
              </span>
              Every {agent.config.intervalHours}h
            </button>
          </div>
          <div className={styles.row}>
            <Input
              value={marketId}
              onChange={(event) => setMarketId(event.target.value.replace(/\D/g, ""))}
              placeholder="Market ID (optional)"
              inputMode="numeric"
              mono
              shape="pill"
              aria-label="Market ID"
              className={styles.fieldGrow}
            />
            {/* Not `glow`: that is the marketing call to action, and it paints a half-white edge
                no token holds. The canvas draws Run now as a flat lime fill with no shadow. */}
            <Button
              disabled={runsLocked || !canManage || busy || agent.paused}
              title={
                runsLocked
                  ? `Runs are blocked: ${blocked}`
                  : "Run once, optionally against a market ID"
              }
              onClick={() => onRun(marketId.trim())}
            >
              <Icon name="bolt" size={14} />
              {busy ? "Starting…" : "Run now"}
            </Button>
          </div>
          <p className={styles.note}>
            {denied
              ? "An operator must enable research before you can create agents, change settings or start runs. Existing results remain readable."
              : scheduleLocked
                ? "The schedule stays locked until one manual run with this exact config succeeds. Run it now to unlock."
                : `Runs on its own every ${agent.config.intervalHours} hours (1–168). A manual run counts against the same allowance of ${quotaMax} a day.`}
          </p>
        </section>

        <section className={styles.card} data-planned="true">
          <div>
            <p className={styles.eyebrow}>
              AGENT WALLET
              <span className={styles.stubState} data-tint="amber">
                NOT WIRED YET
              </span>
            </p>
            <p className={styles.big} data-quiet="true">
              0.00 <small>MON</small>
            </p>
            <p className={styles.mono}>TODAY: RESEARCH QUOTA + BUDGET LEDGER</p>
          </div>
          <div className={styles.row}>
            <Button variant="secondary" disabled title="Per-agent funds do not exist yet">
              Top up
            </Button>
            <Button variant="ghost" disabled title="Per-agent funds do not exist yet">
              Withdraw
            </Button>
          </div>
          <p className={styles.note}>
            Signing is ported from Relayer and tested — Turnkey, with the activity stamped in the
            browser by your passkey — but no wallet is attached to this agent yet. Until one is, the
            agent spends research quota, not money.
          </p>
        </section>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat} data-tint={runsToday >= quotaMax ? "amber" : "plain"}>
          <b>
            {runsToday} / {quotaMax}
          </b>
          <span>RUNS TODAY</span>
        </div>
        <div className={styles.stat} data-tint="plain">
          <b>
            {marks.filter((mark) => mark === "TRADE").length} ·{" "}
            {marks.filter((mark) => mark === "ABSTAIN").length} ·{" "}
            {marks.filter((mark) => mark === "OVERRIDDEN").length}
          </b>
          <span>TRADE · ABSTAIN · OVERRIDDEN</span>
        </div>
        <div
          className={styles.stat}
          data-tint={runs.some((run) => run.error) ? "magenta" : "plain"}
        >
          <b>{runs.filter((run) => run.status === "failed").length}</b>
          <span>FAILED RUNS</span>
        </div>
        <div className={styles.stat} data-tint="plain">
          <b>{tools}/6</b>
          <span>TOOLS · {plugins}/5 PLUGINS</span>
        </div>
      </div>

      <div className={styles.block}>
        <p className={styles.eyebrow}>QUICK ACTIONS</p>
        <div className={styles.actions}>
          {(
            [
              {
                icon: "target",
                label: "Read the last decision",
                note: "Range, counter-evidence, policy",
                to: "picks",
              },
              {
                icon: "activity",
                label: "Follow a run",
                note: "Every step, in order",
                to: "activity",
              },
              {
                icon: "file",
                label: "Edit the brief",
                note: `Profile · ${agent.config.profile.length} of 4,000 chars`,
                to: "brief",
              },
              {
                icon: "sliders",
                label: "Plugins & tools",
                note: `${plugins} plugins · ${tools} of 6 tools`,
                to: "skills",
              },
              {
                icon: "shield",
                label: "See the policy",
                note: "What it carries into every run",
                to: "context",
              },
              {
                icon: "wallet",
                label: "Limits & funding",
                note: "Six numbers, and one that is missing",
                to: "limits",
              },
            ] as const
          ).map((action) => (
            <button
              key={action.to}
              type="button"
              className={styles.action}
              onClick={() => go(action.to)}
            >
              <span className={styles.actionMark}>
                <Icon name={action.icon} size={16} />
              </span>
              <span className={styles.grow}>
                <b>{action.label}</b>
                <small>{action.note}</small>
              </span>
              <Icon name="arrow" size={15} />
            </button>
          ))}
        </div>
      </div>

      <div className={styles.list}>
        <div className={styles.listHead}>
          <span className={styles.dot} data-live={runs.some((run) => run.status === "running")} />
          LATEST RUNS
          <Button
            variant="secondary"
            size="sm"
            className={styles.pushEnd}
            onClick={() => go("activity")}
          >
            All activity
          </Button>
        </div>
        {!runs.length && (
          <p className={styles.emptyFlat}>
            No runs yet. Start one by hand above, or turn the schedule on once a manual run has
            succeeded.
          </p>
        )}
        {runs.slice(0, 5).map((run) => {
          const { mark, tint } = runMark(run);
          return (
            <button
              key={run.id}
              type="button"
              className={styles.listRow}
              data-tint={tint}
              onClick={() => onOpen(run)}
            >
              <span className={styles.rowDot} />
              <span className={styles.rowId}>
                #{run.id.slice(0, 8)} · {clock(run.createdAt)}
              </span>
              <span className={styles.rowText}>{runSummary(run)}</span>
              <span className={styles.mark} data-quiet="true">
                {run.trigger}
              </span>
              <span className={styles.mark}>{mark}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
