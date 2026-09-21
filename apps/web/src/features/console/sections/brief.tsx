"use client";
import { useState } from "react";
import { Button, Field, Textarea } from "@pickler/ui";
import type { Agent, Config } from "../api";
import styles from "../studio.module.css";

/**
 * The brief is the only thing that shapes how the agent reasons, so it gets a page and not a row in
 * a settings form: up to 4,000 characters of standing instruction, carried into every run.
 */
export function Brief({
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
  const [profile, setProfile] = useState(agent.config.profile);
  const dirty = profile.trim() !== agent.config.profile;
  const empty = !profile.trim();

  return (
    <div className={styles.section} data-narrow="true">
      <p className={styles.eyebrow} data-tint="lime">
        HOW IT THINKS
        <span className={styles.stubState}>BUILT</span>
      </p>
      <div className={styles.sectionHead}>
        <h2>Brief</h2>
        <span className={styles.count}>{profile.length} / 4,000</span>
      </div>
      <p className={styles.stubBody}>
        The standing profile behind every run: the edge it hunts, what it refuses to touch, and how
        sure it has to be before it commits. It is read at the start of each run, so a change here
        shows up in the next decision, not the last one.
      </p>
      <div className={styles.form}>
        <Field
          label="Research profile"
          tone={empty ? "bad" : "quiet"}
          note={
            empty
              ? "A brief cannot be empty — the agent has nothing to reason from."
              : "Saving the brief turns the schedule off until one manual run with it succeeds."
          }
        >
          <Textarea
            rows={12}
            maxLength={4000}
            value={profile}
            disabled={!canManage}
            onChange={(event) => setProfile(event.target.value)}
          />
        </Field>
        <div className={styles.row}>
          <Button
            disabled={!canManage || busy || !dirty || empty}
            onClick={() => onSave({ ...agent.config, profile: profile.trim() })}
          >
            {busy ? "Saving…" : "Save brief"}
          </Button>
          <Button
            variant="secondary"
            disabled={!dirty}
            onClick={() => setProfile(agent.config.profile)}
          >
            Discard
          </Button>
        </div>
      </div>
    </div>
  );
}
