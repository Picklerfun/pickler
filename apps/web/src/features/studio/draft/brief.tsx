"use client";
import { Icon } from "@pickler/ui";
import { briefLists, briefText, briefView, type BriefKey } from "../shell/build-model";
import { CapSteppers } from "../shell/build-parts";
import { SaveOutcome, saveLabel, useSavedForm, useSetupSave } from "../shell/setup-save";
import { capsOf, capsStepper, starterCaps, type Caps } from "./caps-model";
import { RunNote } from "./run-note";
import { DraftSection, type DraftSectionProps } from "./draft-section";
import styles from "./build.module.css";

/* The canvas's `SECTIONS`: each list's line under its label, its height, and its prompt. */
const SECTIONS: readonly {
  key: BriefKey;
  label: string;
  sub: string;
  rows: number;
  placeholder: string;
}[] = [
  {
    key: "thesis",
    label: "THESIS",
    sub: "why this edge exists, in plain words",
    rows: 3,
    placeholder: "What does this agent believe that the market does not price yet?",
  },
  {
    key: "enters",
    label: "ENTERS WHEN",
    sub: "every line must be true",
    rows: 4,
    placeholder: "Conditions, one per line. The run shows which ones fired.",
  },
  {
    key: "exits",
    label: "EXITS WHEN",
    sub: "the first line that turns true closes it",
    rows: 3,
    placeholder: "Take profit, stop, time limit…",
  },
  {
    key: "never",
    label: "NEVER",
    sub: "hard lines it will not cross",
    rows: 3,
    placeholder: "The things a tired human would do at 3am.",
  },
];

/**
 * Brief (canvas 676–710, spec §3.5): the four sections, one rule per line, with their tags, and
 * RISK with the caps steppers, saved together in one `draft.saveSetup` ("Save brief"). RISK's line
 * says who holds the caps (spec D11): Pickler, not its wallet.
 */
export function Brief({ agent, draft, canManage, onSection }: DraftSectionProps) {
  const savedText = briefText(agent.config.brief);
  const capsSource = {
    spend: agent.spend,
    configSpend: agent.config.spend,
    maxLeverage: agent.config.maxLeverage,
  };
  const savedCaps = capsOf(capsSource);
  const [form, setForm] = useSavedForm(agent.version, { text: savedText, caps: savedCaps });
  const { state, save, touch, saving } = useSetupSave(draft);

  const view = briefView(form.text, savedText);
  const caps = capsStepper(form.caps, savedCaps, starterCaps(capsSource));
  const dirty = view.dirty || caps.dirty;
  const canSave = canManage && dirty && !view.needsEntry && !caps.inverted && !saving;
  /* The steppers shut while saving; the textareas only go read-only, so a focused one keeps it. */
  const shut = !canManage || saving;

  function edit(next: { text?: Partial<typeof form.text>; caps?: Caps }) {
    setForm({ text: { ...form.text, ...next.text }, caps: next.caps ?? form.caps });
    touch();
  }

  return (
    <DraftSection section="brief">
      <div className={styles.column}>
        <RunNote onRun={() => onSection("console")} />
        {SECTIONS.map((section) => {
          const tag = view.tags[section.key];
          const id = `draft-brief-${section.key}`;
          return (
            <div
              key={section.key}
              className={styles.field}
              data-needed={section.key === "enters" && view.needsEntry}
            >
              <div className={styles.fieldHead}>
                <label className={styles.fieldLabel} htmlFor={id}>
                  {section.label}
                </label>
                <span className={styles.fieldSub}>{section.sub}</span>
                <span className={styles.tag} data-lit={tag.edited}>
                  {tag.text}
                </span>
              </div>
              <textarea
                id={id}
                className={styles.input}
                rows={section.rows}
                placeholder={section.placeholder}
                value={form.text[section.key]}
                disabled={!canManage}
                readOnly={saving}
                onChange={(event) => edit({ text: { [section.key]: event.target.value } })}
              />
            </div>
          );
        })}
        <div className={styles.field} data-roomy="true" id="draft-brief-risk">
          <div className={styles.fieldHead}>
            <span className={styles.fieldLabel}>RISK</span>
            <span className={styles.fieldSub}>
              hard caps · Pickler holds every trade to these · small on purpose for a first agent
            </span>
            <span className={styles.tag} data-lit={caps.dirty}>
              {caps.tag}
            </span>
          </div>
          <CapSteppers
            view={caps}
            layout="grid"
            disabled={shut}
            onChange={(next) => edit({ caps: next })}
          />
          {caps.inverted && (
            <p className={styles.alert} role="alert">
              <Icon name="alert" size={12} />A day&apos;s cap can&apos;t be below one trade&apos;s.
            </p>
          )}
        </div>
        {view.needsEntry && (
          <p className={styles.hint}>WRITE AN ENTRY RULE TO SAVE · IT NEEDS AT LEAST ONE</p>
        )}
        <button
          type="button"
          className={styles.saveButton}
          disabled={!canManage}
          aria-disabled={!canSave || undefined}
          onClick={() => {
            if (canSave) {
              void save({ brief: briefLists(form.text), caps: form.caps });
            }
          }}
        >
          {saveLabel(state, dirty, "Save brief")}
        </button>
        <SaveOutcome state={state} />
      </div>
    </DraftSection>
  );
}
