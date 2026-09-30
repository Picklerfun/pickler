"use client";
import { useState } from "react";
import { Button, Field, Input } from "@pickler/ui";
import type { Agent, Config } from "../api";
import styles from "../studio.module.css";

type LimitKey = keyof Config["limits"];

/** Every limit the backend enforces, with the range it accepts and what spending it caps. */
const LIMITS: { key: LimitKey; label: string; min: number; max: number; note: string }[] = [
  { key: "searches", label: "Searches", min: 2, max: 3, note: "Web searches in one run" },
  { key: "pageReads", label: "Page reads", min: 1, max: 5, note: "Pages opened in full" },
  { key: "steps", label: "Steps", min: 3, max: 12, note: "Tool calls before it must answer" },
  {
    key: "durationMs",
    label: "Duration (ms)",
    min: 1,
    max: 300000,
    note: "Wall clock before the run is cut",
  },
  {
    key: "outputTokens",
    label: "Output tokens",
    min: 1,
    max: 32768,
    note: "Length of the assessment",
  },
  {
    key: "dailyRuns",
    label: "Daily runs",
    min: 1,
    max: 6,
    note: "Rolling allowance, manual included",
  },
];

export function Limits({
  agent,
  busy,
  canManage,
  onSave,
}: {
  agent: Agent;
  busy: boolean;
  canManage: boolean;
  onSave(config: Config): void;
}) {
  /* The parent remounts this on a new config version, so the draft starts from what was saved. */
  const [draft, setDraft] = useState<Config>(agent.config);
  const dirty = JSON.stringify(draft) !== JSON.stringify(agent.config);
  const policy = draft.uncertaintyPolicy;

  return (
    <div className={styles.section} id="studio-section-limits" data-narrow="true">
      <p className={styles.eyebrow} data-tint="amber">
        LIMITS
        <span className={styles.stubState}>HALF BUILT</span>
      </p>
      <div className={styles.sectionHead}>
        <h1>Limits &amp; funding</h1>
      </div>
      <p className={styles.stubBody}>
        Six numbers cap what one run may spend. Funding per agent is the half that does not exist:
        there is no wallet behind an agent today, only a research quota and a budget ledger the
        operator holds.
      </p>

      <div className={styles.fields}>
        {LIMITS.map((limit) => (
          <Field
            key={limit.key}
            label={limit.label}
            note={`${limit.note} · ${limit.min}–${limit.max}`}
          >
            <Input
              type="number"
              min={limit.min}
              max={limit.max}
              mono
              disabled={!canManage}
              value={draft.limits[limit.key]}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  limits: { ...draft.limits, [limit.key]: Number(event.target.value) },
                })
              }
            />
          </Field>
        ))}
        <Field
          label="Interval in hours"
          note="How often the schedule fires, once it is unlocked · 1–168"
        >
          <Input
            type="number"
            min={1}
            max={168}
            mono
            disabled={!canManage}
            value={draft.intervalHours}
            onChange={(event) => setDraft({ ...draft, intervalHours: Number(event.target.value) })}
          />
        </Field>
      </div>
      <div className={styles.row}>
        <Button disabled={!canManage || busy || !dirty} onClick={() => onSave(draft)}>
          {busy ? "Saving…" : "Save limits"}
        </Button>
        <Button variant="secondary" disabled={!dirty} onClick={() => setDraft(agent.config)}>
          Discard
        </Button>
      </div>

      {policy && (
        <section className={styles.card}>
          <p className={styles.eyebrow}>POLICY IN FORCE</p>
          <div className={styles.limits}>
            <div className={styles.limit} data-on={policy.blockHighUncertainty}>
              <b>{String(policy.blockHighUncertainty)}</b>
              <span>blockHighUncertainty</span>
            </div>
            <div className={styles.limit} data-on={policy.requireCompleteInformation}>
              <b>{String(policy.requireCompleteInformation)}</b>
              <span>requireCompleteInformation</span>
            </div>
            <div className={styles.limit}>
              <b>{policy.minProbabilityMargin.toFixed(2)}</b>
              <span>minProbabilityMargin</span>
            </div>
            <div className={styles.limit}>
              <b>{policy.maxProbabilityRangeWidth.toFixed(2)}</b>
              <span>maxProbabilityRangeWidth</span>
            </div>
          </div>
          <p className={styles.note}>
            These four decide whether a trade the model proposed survives. They are set by the
            operator for now; every decision names the ones that fired.
          </p>
        </section>
      )}

      <section className={styles.card} data-planned="true">
        <p className={styles.eyebrow}>
          FUNDING
          <span className={styles.stubState} data-tint="amber">
            NOT WIRED YET
          </span>
        </p>
        <p className={styles.note}>
          No wallet is attached to an agent yet, so there is no top-up and no withdrawal. The
          signing path exists — Turnkey, with the activity stamped in the browser by a passkey,
          ported from Relayer — but nothing provisions a wallet when an agent is created here. What
          an agent can spend is the rolling run allowance above; what it costs is settled against
          the operator&rsquo;s budget ledger, not against you.
        </p>
      </section>
    </div>
  );
}
