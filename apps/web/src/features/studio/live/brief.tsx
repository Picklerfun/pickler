"use client";
import { useCallback, useMemo } from "react";
import type { SetupUpdateDto } from "@pickler/api-schema";
import { Icon } from "@pickler/ui";
import {
  briefLists,
  briefText,
  briefView,
  type BriefKey,
  type BriefText,
} from "../shell/build-model";
import { SaveOutcome, saveLabel, useSavedForm, useSetupSave } from "../shell/setup-save";
import { liveBriefTags } from "./build-model";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { briefBar, versionRows } from "./model";
import type { UseLive } from "./use-live";
import styles from "./build.module.css";

export interface BriefProps extends LiveSectionProps {
  /** The textareas with edits not applied (`?stage=perpl-brief-dirty`), or null. */
  stagedDraft: BriefText | null;
}

/**
 * The live studio's data with a `saveSetup` that reads VERSIONS again once a save landed: every
 * saved setup is a version row (spec L10), whichever BUILD section saved it.
 */
export function useVersionedStudio(live: UseLive): UseLive {
  const { saveSetup, readVersions } = live;
  const save = useCallback(
    async (patch: Omit<SetupUpdateDto, "expectedVersion">) => {
      const saved = await saveSetup(patch);
      void readVersions();
      return saved;
    },
    [saveSetup, readVersions],
  );
  return useMemo(() => ({ ...live, saveSetup: save }), [live, save]);
}

/* The canvas's `SECTIONS`: each list's line under its label and its height. */
const SECTIONS: readonly { key: BriefKey; label: string; sub: string; rows: number }[] = [
  { key: "thesis", label: "THESIS", sub: "why this edge exists, in plain words", rows: 3 },
  { key: "enters", label: "ENTERS WHEN", sub: "every line must be true", rows: 4 },
  { key: "exits", label: "EXITS WHEN", sub: "the first line that turns true closes it", rows: 3 },
  { key: "never", label: "NEVER", sub: "hard lines it will not cross", rows: 3 },
];

/**
 * Brief (canvas 368–391, spec L9, L10): the note bar ("BRIEF V{n} · LIVE", or the edits not
 * applied with Discard and "Apply as v{n+1}", one `PUT /setup` with `brief`), the four sections
 * with their tags against the version it runs on, and VERSIONS, read again after a save. A brief
 * with no entry rule is refused by core, so Apply waits for one.
 */
export function Brief({ agent, live, canManage, now, stagedDraft }: BriefProps) {
  const savedText = briefText(agent.config.brief);
  const [form, setForm] = useSavedForm<BriefText>(agent.version, stagedDraft ?? savedText);
  const studio = useVersionedStudio(live);
  const { state, save, touch, saving } = useSetupSave(studio);

  const view = briefView(form, savedText);
  const tags = liveBriefTags(view.tags, agent.version);
  const bar = briefBar(agent.version, view.dirty);
  const canApply = canManage && view.dirty && !view.needsEntry && !saving;

  function edit(key: BriefKey, value: string) {
    setForm({ ...form, [key]: value });
    touch();
  }

  return (
    <LiveSection section="brief">
      <div className={styles.column}>
        <div className={styles.bar} data-dirty={bar.dirty} id="live-brief-bar">
          <span className={styles.barDot} aria-hidden="true" />
          <span className={styles.barText} role="status">
            {bar.text}
          </span>
          {(bar.dirty || saving) && (
            <>
              <button
                type="button"
                className={styles.barDiscard}
                disabled={!canManage || saving}
                onClick={() => {
                  setForm(savedText);
                  touch();
                }}
              >
                Discard
              </button>
              <button
                type="button"
                className={styles.barApply}
                disabled={!canManage}
                aria-disabled={!canApply || undefined}
                onClick={() => {
                  if (canApply) {
                    void save({ brief: briefLists(form) });
                  }
                }}
              >
                {saveLabel(state, view.dirty, bar.apply)}
              </button>
            </>
          )}
        </div>
        <SaveOutcome state={state} />
        {SECTIONS.map((section) => {
          const tag = tags[section.key];
          const id = `live-brief-${section.key}`;
          return (
            <div
              key={section.key}
              className={styles.field}
              data-edited={tag.edited}
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
                value={form[section.key]}
                disabled={!canManage}
                readOnly={saving}
                onChange={(event) => edit(section.key, event.target.value)}
              />
            </div>
          );
        })}
        {view.needsEntry && (
          <p className={styles.alert} role="alert">
            <Icon name="alert" size={12} />
            Write an entry rule to apply it · it needs at least one.
          </p>
        )}
        <Versions live={live} version={agent.version} now={now} />
      </div>
    </LiveSection>
  );
}

/** VERSIONS (spec L10): the recorded saves, the current one lit; a failed read says so. */
function Versions({ live, version, now }: { live: UseLive; version: number; now: number }) {
  const read = Array.isArray(live.versions) ? live.versions : [];
  const rows = versionRows(read, version, new Date(now));
  return (
    <div className={styles.versions} id="live-brief-versions">
      <span className={styles.versionsTitle}>VERSIONS</span>
      <ol className={styles.versionList}>
        {rows.map((row) => (
          <li key={row.key} className={styles.version}>
            <span className={styles.versionLabel} data-current={row.current}>
              {row.label}
            </span>
            <span className={styles.versionText}>{row.text}</span>
            <span className={styles.versionAt} suppressHydrationWarning>
              {row.at}
            </span>
          </li>
        ))}
      </ol>
      {live.versions === "failed" && (
        <span className={styles.versionsFailed}>
          <span className={styles.hint} data-bad="true">
            COULDN&apos;T READ THE VERSIONS
          </span>
          <button
            type="button"
            className={styles.retry}
            onClick={() => {
              void live.readVersions();
            }}
          >
            Retry
          </button>
        </span>
      )}
    </div>
  );
}
