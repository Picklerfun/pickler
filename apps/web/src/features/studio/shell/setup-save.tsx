"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
  | { kind: "conflict" }
  | { kind: "preview" }
  | { kind: "error"; text: string };

const IDLE: SaveState = { kind: "idle" };

/**
 * The form a Build section edits, starting from what the agent holds and starting over whenever
 * the agent's version moves: after its own save (the form then equals what was saved), and after
 * a stale save reloaded it ("Reloaded." means the screen shows the other change).
 */
export function useSavedForm<T>(version: number, saved: T): [T, (next: T) => void] {
  const [form, setForm] = useState(saved);
  const [base, setBase] = useState(version);
  if (version !== base) {
    setBase(version);
    setForm(saved);
  }
  return [form, setForm];
}

/**
 * One section's save: "Saving…", then "Saved"; a 409 CONFLICT reloads the agent and says so; on a
 * staged or preview studio it says nothing was saved. `touch` drops the last outcome once the
 * form is edited again.
 */
export function useSetupSave(studio: Pick<UseAgentStudio, "saveSetup" | "refreshAgent">) {
  const [state, setState] = useState<SaveState>(IDLE);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const { saveSetup, refreshAgent } = studio;

  const save = useCallback(
    async (patch: Omit<SetupUpdateDto, "expectedVersion">) => {
      setState({ kind: "saving" });
      try {
        await saveSetup(patch);
        if (alive.current) {
          setState({ kind: "saved" });
        }
      } catch (caught) {
        const problem = setupProblem(
          errorCode(caught),
          caught instanceof Error ? caught.message : "Could not save.",
        );
        if (problem.kind === "conflict") {
          await refreshAgent().catch(() => undefined);
        }
        if (alive.current) {
          setState(problem);
        }
      }
    },
    [saveSetup, refreshAgent],
  );

  const touch = useCallback(() => {
    setState((current) => (current.kind === "saving" ? current : IDLE));
  }, []);

  return { state, save, touch, saving: state.kind === "saving" };
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
