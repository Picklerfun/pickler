"use client";
import { useState } from "react";
import { Button, Chip, Field, Textarea } from "@pickler/ui";
import type { Agent, Catalog, Config } from "../api";
import styles from "../studio.module.css";

type Sport = Catalog["categories"][number]["subcategories"][number]["id"];

/**
 * The standing brief behind every run: what the agent hunts, and where it is allowed to hunt it.
 *
 * Both are read at the start of each run, so a change here shows up in the next decision and never
 * in the last one. Scope lives beside the profile rather than under limits because it is the same
 * question asked twice — what this agent is for — and it was editable before the studio existed.
 */
export function Brief({
  agent,
  catalog,
  busy,
  canManage,
  onSave,
}: {
  agent: Agent;
  catalog: Catalog | null;
  busy: boolean;
  canManage: boolean;
  onSave(config: Config): void;
}) {
  /* The parent remounts this on a new config version, so the draft starts from what was saved. */
  const [profile, setProfile] = useState(agent.config.profile);
  const [sports, setSports] = useState<Sport[]>(() =>
    agent.config.marketScope?.subcategories === "all"
      ? (catalog?.categories[0]?.subcategories.map((sport) => sport.id) ?? [])
      : ((agent.config.marketScope?.subcategories as Sport[] | undefined) ?? []),
  );

  const available = catalog?.categories[0]?.subcategories ?? [];
  /* An agent created before market scope existed carries legacy category ids instead, and those are
     not editable here; showing an empty picker would invite a save that drops them. */
  const legacy = !agent.config.marketScope;
  const saved =
    agent.config.marketScope?.subcategories === "all"
      ? available.map((sport) => sport.id)
      : ((agent.config.marketScope?.subcategories as Sport[] | undefined) ?? []);
  const scopeChanged = [...sports].sort().join() !== [...saved].sort().join();
  const dirty = profile.trim() !== agent.config.profile || (!legacy && scopeChanged);
  const empty = !profile.trim();
  const noSport = !legacy && sports.length === 0;

  function save() {
    onSave({
      ...agent.config,
      profile: profile.trim(),
      ...(legacy ? {} : { marketScope: { version: 1, category: "sports", subcategories: sports } }),
    });
  }

  return (
    <div className={styles.section} data-narrow="true">
      <p className={styles.eyebrow} data-tint="lime">
        HOW IT THINKS
        <span className={styles.stubState}>BUILT</span>
      </p>
      <div className={styles.sectionHead}>
        <h1>Brief</h1>
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

        <div className={styles.block}>
          <p className={styles.eyebrow}>WHERE IT LOOKS</p>
          {legacy ? (
            <p className={styles.note}>
              This agent was created against the older category selection, which the studio does not
              edit. Its scope is unchanged by anything saved here.
            </p>
          ) : (
            <>
              <div className={styles.row}>
                {available.map((sport) => (
                  <Chip
                    key={sport.id}
                    selected={sports.includes(sport.id)}
                    disabled={!canManage}
                    onClick={() =>
                      setSports(
                        sports.includes(sport.id)
                          ? sports.filter((id) => id !== sport.id)
                          : [...sports, sport.id],
                      )
                    }
                  >
                    {sport.label}
                  </Chip>
                ))}
              </div>
              <p className={styles.note} data-warn={noSport}>
                {noSport
                  ? "Pick at least one sport — with none selected the agent has nowhere to look."
                  : "The markets it may discover. Narrowing this does not touch decisions it has already made."}
              </p>
            </>
          )}
        </div>

        <div className={styles.row}>
          <Button disabled={!canManage || busy || !dirty || empty || noSport} onClick={save}>
            {busy ? "Saving…" : "Save brief"}
          </Button>
          <Button
            variant="secondary"
            disabled={!dirty}
            onClick={() => {
              setProfile(agent.config.profile);
              setSports(saved);
            }}
          >
            Discard
          </Button>
        </div>
      </div>
    </div>
  );
}
