"use client";
import { useState } from "react";
import { Icon } from "@pickler/ui";
import { StudioError, errorCode } from "../api";
import type { DraftGoPublicStage } from "./fixture";
import { goPublicView, publishProblem, type PublishProblem } from "./model";
import type { DraftSectionProps } from "./section";
import { PREVIEW_NOTE } from "./use-draft";
import { XConnect } from "./x-connect";
import styles from "./draft.module.css";

export interface GoPublicProps extends Pick<
  DraftSectionProps,
  "agent" | "draft" | "canManage" | "onWallets"
> {
  /** The `?stage=draft-x-*` state: the X row open, the skip, the card; null starts it closed. */
  stage: DraftGoPublicStage | null;
}

/**
 * Go Public (spec D3, §3.1; canvas 343–382): one task, Connect X, which can be skipped for this
 * screen only, then `POST /publish`. The server re-checks everything (D8) and the 409 names what
 * stands in the way; FUNDS has its fix right there, "Fund from master". Once public the title says
 * so and `useDraft` reloads the agent, which swaps this studio for the live one.
 */
export function GoPublic({ agent, draft, canManage, onWallets, stage }: GoPublicProps) {
  const [xOpen, setXOpen] = useState(stage?.xOpen ?? false);
  const [skipped, setSkipped] = useState(stage?.skipped ?? false);
  const [publishing, setPublishing] = useState(false);
  const [live, setLive] = useState(false);
  const [problem, setProblem] = useState<PublishProblem | null>(null);

  const xHandle = agent.xHandle ?? draft.x?.account?.handle ?? null;
  const view = goPublicView({ xHandle, skipped, publishing, error: null });
  const name = (agent.name ?? "Your agent").toUpperCase();
  const task = view.task;

  async function goPublic() {
    if (!view.canPublish || !canManage || live) {
      return;
    }
    setPublishing(true);
    setProblem(null);
    try {
      await draft.publish();
      setLive(true);
    } catch (caught) {
      setProblem(
        publishProblem(
          errorCode(caught),
          caught instanceof StudioError ? caught.details : undefined,
          caught instanceof Error ? caught.message : "Could not make it public. Try again.",
        ),
      );
    } finally {
      setPublishing(false);
    }
  }

  let label = view.label;
  if (live) {
    label = "Live · first trade on its rules";
  }

  return (
    <div className={styles.goCard} id="draft-go-public">
      <div className={styles.cardHead}>
        <h3 className={styles.goTitle} aria-live="polite">
          {live ? `${name} IS LIVE` : view.title}
          <span className={styles.lime}>.</span>
        </h3>
        <span className={styles.cardCount}>
          {view.done} / {view.of}
        </span>
      </div>
      <span
        className={styles.progress}
        role="progressbar"
        aria-label="Go public steps done"
        aria-valuemin={0}
        aria-valuemax={view.of}
        aria-valuenow={view.done}
      >
        <span className={styles.progressFill} data-done={view.done === view.of} />
      </span>
      <p className={styles.cardNote}>
        Private until you flip it. Once public its calls post on Pickler{view.xNote}, and it starts
        trading on its rules.
      </p>

      <div className={styles.task}>
        <div className={styles.taskRow}>
          <span className={styles.taskMark} data-done={task.done}>
            {task.done ? <Icon name="check" size={13} /> : "1"}
          </span>
          <span className={styles.taskText}>
            <span className={styles.taskTitle}>{task.title}</span>
            <span className={styles.taskMeta} data-done={task.done}>
              {task.meta}
            </span>
          </span>
          {!task.done && (
            <button
              type="button"
              className={styles.whiteButton}
              aria-expanded={xOpen}
              aria-controls="draft-go-public-x"
              onClick={() => setXOpen(!xOpen)}
            >
              Connect
            </button>
          )}
        </div>
        {xOpen && !task.done && (
          <XConnect
            x={draft.x}
            canManage={canManage}
            staged={stage ? { handle: stage.handle, card: stage.card } : null}
            onChallenge={draft.challengeX}
            onVerify={draft.verifyX}
            idPrefix="draft-go-public"
          />
        )}
      </div>

      <button
        type="button"
        className={styles.goButton}
        id="draft-go-public-button"
        data-state={live ? "live" : view.canPublish ? "ready" : "blocked"}
        disabled={!view.canPublish || !canManage || live}
        onClick={() => void goPublic()}
      >
        {label}
      </button>
      {view.skipLabel && !live && (
        <button
          type="button"
          className={styles.skipButton}
          aria-pressed={skipped}
          disabled={!canManage}
          onClick={() => setSkipped(!skipped)}
        >
          {view.skipLabel}
        </button>
      )}

      {problem?.kind === "blocked" &&
        problem.lines.map((line) => (
          <div key={line.blocker} className={styles.blocked} role="alert">
            <span>{line.text}</span>
            {line.fund && (
              <button
                type="button"
                className={styles.whiteButton}
                disabled={!canManage}
                onClick={() => onWallets(true)}
              >
                Fund from master
              </button>
            )}
          </div>
        ))}
      {problem?.kind === "error" && (
        <p className={styles.alert} role="alert">
          <Icon name="alert" size={13} />
          {problem.text}
        </p>
      )}
      {problem?.kind === "preview" && (
        <p className={styles.note} role="status">
          <Icon name="alert" size={13} />
          {PREVIEW_NOTE}
        </p>
      )}
    </div>
  );
}
