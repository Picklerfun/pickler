"use client";
import { useState } from "react";
import { Button, Icon, Input, Textarea } from "@pickler/ui";
import { SUGGESTED_SKILLS, addCustomSkill, toggleIn } from "./draft";
import type { StepProps } from "./flow";
import styles from "./create.module.css";

/** Small routines it follows on every run: the beat's suggestions, and any the person writes. */
export function SkillsStep({ draft, patch, replace }: StepProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [refused, setRefused] = useState(false);
  const suggested = SUGGESTED_SKILLS[draft.beat] ?? SUGGESTED_SKILLS.other ?? [];
  const canSave = name.trim().length > 0 && prompt.trim().length > 0;

  function close() {
    setOpen(false);
    setName("");
    setPrompt("");
    setRefused(false);
  }

  function save() {
    const next = addCustomSkill(draft, name, prompt);
    if (next === draft) {
      setRefused(true);
      return;
    }
    replace(next);
    close();
  }

  return (
    <section className={styles.step} id="create-skills">
      <h1 className={styles.headline} tabIndex={-1}>
        ITS SKILLS<span>.</span>
      </h1>
      <p className={styles.lead}>
        Small routines it follows on every run. Add one, or write your own.
      </p>

      {suggested.map((skill) => {
        const on = draft.skills.includes(skill.name);
        return (
          <div key={skill.name} className={styles.card} data-on={on}>
            <span className={styles.cardBody}>
              <span className={styles.cardHead}>{skill.name}</span>
              <span className={styles.cardNote}>{skill.prompt}</span>
            </span>
            <Button
              variant={on ? "secondary" : "primary"}
              size="sm"
              aria-pressed={on}
              onClick={() => patch({ skills: toggleIn(draft.skills, skill.name) })}
            >
              {on ? "Added" : "Add"}
              {on && <Icon name="check" size={13} />}
            </Button>
          </div>
        );
      })}

      {draft.custom.map((skill) => (
        <div key={skill.name} className={styles.card} data-tone="mine">
          <span className={styles.cardBody}>
            <span className={styles.cardHead}>
              {skill.name}
              <span className={styles.cardKind} data-tone="mine">
                YOURS
              </span>
            </span>
            <span className={styles.cardNote}>{skill.prompt}</span>
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => patch({ custom: draft.custom.filter((x) => x !== skill) })}
          >
            Remove
          </Button>
        </div>
      ))}

      {open ? (
        <div className={styles.builder}>
          <p className={styles.label}>NEW SKILL</p>
          <Input
            value={name}
            maxLength={40}
            aria-label="Skill name"
            placeholder="Name it · e.g. Short week check"
            onChange={(event) => setName(event.target.value.slice(0, 40))}
          />
          <Textarea
            rows={3}
            value={prompt}
            maxLength={600}
            aria-label="What the skill does"
            placeholder="Tell it what to do, in plain words. e.g. If a team plays on Thursday after a Sunday game, lower its chances."
            onChange={(event) => setPrompt(event.target.value.slice(0, 600))}
          />
          <p className={styles.note}>It uses the sources you turned on. Nothing else.</p>
          {refused && (
            <p className={styles.note} data-tone="bad" role="alert">
              It can follow at most eight skills. Remove one to add this.
            </p>
          )}
          <div className={styles.builderActions}>
            <Button disabled={!canSave} onClick={save}>
              Add skill
            </Button>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" className={styles.write} onClick={() => setOpen(true)}>
          + Write a skill
        </button>
      )}
    </section>
  );
}
