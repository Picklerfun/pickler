"use client";
import { useCallback } from "react";
import { useStudioForm, useStudioMemory } from "../routing/memory";
import type { SetupUpdateDto } from "@pickler/api-schema";
import { Icon } from "@pickler/ui";
import { errorCode } from "../api";
import { CONFLICT_LINE, setupProblem } from "./build-model";
import { PREVIEW_NOTE, type UseAgentStudio } from "./use-agent-studio";
import styles from "./build.module.css";

/** Where a section's one `PUT /setup` stands. */
export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "conflict"; discard?: () => void }
  | { kind: "preview" }
  | { kind: "error"; text: string };

const IDLE: SaveState = { kind: "idle" };

/**
 * A section draft survives route unmounts in workspace memory. Clean drafts follow server
 * versions; dirty drafts keep their original version until saved or explicitly discarded.
 */
export function useSavedForm<T>(version: number, saved: T, key: string): [T, (next: T) => void] {
  return useStudioForm(key, version, saved);
}

/**
 * One section's save: "Saving…", then "Saved"; a 409 CONFLICT reloads the agent and says so; on a
 * staged or preview studio it says nothing was saved. `touch` drops the last outcome once the
 * form is edited again.
 */
export function useSetupSave(
  studio: Pick<UseAgentStudio, "saveSetup" | "refreshAgent">,
  scope: string,
  version: number,
) {
  const memory = useStudioMemory();
  const state = memory.outcome<SaveState>(scope, IDLE);
  const { saveSetup, refreshAgent } = studio;
  const setState = useCallback(
    (next: SaveState) => memory.setOutcome(scope, next),
    [memory, scope],
  );
  const conflict = useCallback(
    () =>
      setState({
        kind: "conflict",
        discard: () => {
          memory.discard(scope);
          setState(IDLE);
        },
      }),
    [memory, scope, setState],
  );
  const save = useCallback(
    async (patch: Omit<SetupUpdateDto, "expectedVersion">) => {
      if (memory.busy(scope)) {
        return;
      }
      if (memory.stale(scope, version)) {
        conflict();
        return;
      }
      const generation = memory.generation();
      memory.begin(scope);
      setState({ kind: "saving" });
      try {
        await saveSetup(patch);
        if (memory.generation() !== generation) {
          return;
        }
        memory.committed(scope);
        setState({ kind: "saved" });
      } catch (caught) {
        if (memory.generation() !== generation) {
          return;
        }
        const problem = setupProblem(
          errorCode(caught),
          caught instanceof Error ? caught.message : "Could not save.",
        );
        if (problem.kind === "conflict") {
          await refreshAgent().catch(() => undefined);
          if (memory.generation() === generation) {
            conflict();
          }
        } else {
          setState(problem);
        }
      } finally {
        if (memory.generation() === generation) {
          memory.end(scope);
        }
      }
    },
    [memory, scope, version, saveSetup, refreshAgent, conflict, setState],
  );
  const touch = useCallback(() => {
    if (!memory.busy(scope)) {
      setState(IDLE);
    }
  }, [memory, scope, setState]);
  return { state, save, touch, saving: memory.busy(scope) };
}

/** The save button's words: "Saving…", "Saved" until the next edit, else its own. */
export const saveLabel = (state: SaveState, dirty: boolean, label: string): string => {
  if (state.kind === "saving") {
    return "Saving…";
  }
  if (state.kind === "saved" && !dirty) {
    return "Saved";
  }
  return label;
};

/** The outcome under a save button: the reload, the preview, or the error, in its place. */
export function SaveOutcome({ state }: { state: SaveState }) {
  if (state.kind === "conflict") {
    return (
      <p className={styles.notice} role="status">
        {CONFLICT_LINE}
        {state.discard && (
          <button type="button" className={styles.saveButton} onClick={state.discard}>
            Discard edits and reload
          </button>
        )}
      </p>
    );
  }
  if (state.kind === "preview") {
    return (
      <p className={styles.notice} role="status">
        {PREVIEW_NOTE}
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <p className={styles.alert} role="alert">
        <Icon name="alert" size={12} />
        {state.text}
      </p>
    );
  }
  return null;
}
