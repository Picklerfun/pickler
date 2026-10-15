"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@pickler/ui";
import { StudioError, errorCode } from "../api";
import type { DraftGoPublicStage } from "./fixture";
import { goPublicView, publishProblem, type PublishProblem } from "./model";
import type { DraftSectionProps } from "./draft-section";
import { PREVIEW_NOTE } from "../shell/use-agent-studio";
import { XConnect } from "../shell/x-connect";
import styles from "./draft.module.css";

export interface GoPublicProps extends Pick<
  DraftSectionProps,
  "agent" | "draft" | "canManage" | "onWallets"
> {
  /** The `?stage=draft-x-*` state: the consent, reconnect or disabled card; null starts it closed. */
  stage: DraftGoPublicStage | null;
}

/**
 * Go Public (spec D3, §3.1; canvas 343–382): one task, Connect X, required before `POST /publish`. The server re-checks everything (D8) and the 409 names what
 * stands in the way; FUNDS has its fix right there, "Fund from master", and the line goes once the
 * wallets are read again. Once public the title says so, the button says where it shows (D19),
 * and `useDraft` reloads the agent, which swaps this studio for the live one.
 *
 * Focus never drops to the page: the button stays focusable while it publishes, the title takes
 * the focus once it is live, and the button can take it when OAuth enables publication.
 */
export function GoPublic({ agent, draft, canManage, onWallets, stage }: GoPublicProps) {
  const [xOpen, setXOpen] = useState(stage?.xOpen ?? false);

  const [publishing, setPublishing] = useState(false);
  const [live, setLive] = useState(false);
  const [problem, setProblem] = useState<PublishProblem | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const xHandle = draft.x?.status === "connected" ? (draft.x.account?.handle ?? null) : null;
  const view = goPublicView({ xHandle, publishing });
  const name = (agent.name ?? "Your agent").toUpperCase();
  const task = view.task;

  /* "Fund from master" moved money (or anything re-read the wallets): the blocked lines were the
     answer to the last try, so they go, and the next try asks the server again. */
  const [seenWallets, setSeenWallets] = useState(draft.wallets);
  if (draft.wallets !== seenWallets) {
    setSeenWallets(draft.wallets);
    if (problem?.kind === "blocked") {
      setProblem(null);
    }
  }

  /* A successful OAuth connection enables publication without replacing the consent panel. */
  const wasDone = useRef(task.done);
  useEffect(() => {
    if (task.done && !wasDone.current) {
      const active = document.activeElement;
      if (!active || active === document.body) {
        buttonRef.current?.focus();
      }
    }
    wasDone.current = task.done;
  }, [task.done]);

  async function goPublic() {
    if (!view.canPublish || !canManage || live) {
      return;
    }
    setPublishing(true);
    setProblem(null);
    try {
      await draft.publish();
      setLive(true);
      /* The button is shut once live: the title, which says so, takes the focus. */
      requestAnimationFrame(() => titleRef.current?.focus());
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
    label = `Public · on Pickler${view.xNote}`;
  }
  /* Blocked by X: shut. Publishing or live: shut but focusable, so the focus stays on it. */
  const blocked = !view.canPublish && !publishing && !live;
  let state = "ready";
  if (live) {
    state = "live";
  } else if (blocked) {
    state = "blocked";
  }

  return (
    <div className={styles.goCard} id="draft-go-public">
      <div className={styles.goHead}>
        <h3 className={styles.goTitle} aria-live="polite" ref={titleRef} tabIndex={-1}>
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
        Connect X to verify ownership, then publish on Pickler. This does not post to X.
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
              aria-controls="draft-go-public-x-connect"
              onClick={() => setXOpen(!xOpen)}
            >
              Connect
            </button>
          )}
        </div>
        {(xOpen || task.done) && (
          <XConnect
            x={draft.x}
            canManage={canManage}
            onConnect={() => draft.connectX("overview")}
            onDisconnect={draft.disconnectX}
            onPosts={draft.readPosts}
            idPrefix="draft-go-public"
          />
        )}
      </div>

      <button
        type="button"
        className={styles.goButton}
        id="draft-go-public-button"
        ref={buttonRef}
        data-state={state}
        disabled={!canManage || blocked}
        aria-disabled={publishing || live || undefined}
        onClick={() => void goPublic()}
      >
        {label}
      </button>

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
