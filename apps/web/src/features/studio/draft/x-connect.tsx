"use client";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@pickler/ui";
import { errorCode, type XChallenge, type XState, type XVerify } from "../api";
import { xHandleInput, xProblem, xView, type XCardState } from "./model";
import { PREVIEW_NOTE } from "./use-draft";
import styles from "./draft.module.css";

const COPIED_MS = 1400;

const idle: XCardState = { challenge: null, checking: false, unavailable: false, taken: null };

/** The card as the X state read from the API leaves it: its live challenge, and D5 when shut. */
const cardFrom = (x: XState | null): XCardState => ({
  ...idle,
  challenge: x?.challenge ? { handle: x.challenge.handle, text: x.challenge.text } : null,
  unavailable: x?.available === false,
});

export interface XConnectProps {
  /** `useDraft().x`: the live challenge and whether X is open; null while it is read. */
  x: XState | null;
  /** The person may change this agent; a view-only member sees the card shut. */
  canManage: boolean;
  /** A `?stage=draft-x-*` card: the typed handle and the card's state, in place of the read. */
  staged?: { handle: string; card: XCardState } | null;
  /** `useDraft().challengeX`: `POST /x/challenge`, the line to post. */
  onChallenge(handle: string): Promise<XChallenge>;
  /** `useDraft().verifyX`: `POST /x/verify` ("Check again"); found reloads the agent's `xHandle`. */
  onVerify(): Promise<XVerify>;
  /** Prefix for the ids the card's controls carry, unique per screen. */
  idPrefix: string;
  /** Drawn on a card (Identity & voice): the row is a well, not a card of its own. */
  well?: boolean;
}

/**
 * Connect X by a post (spec D4, §3.1), shared by Go Public and Identity & voice: the handle with
 * the X mark and Verify; Verify issues the line to post and the miss block shows it with a Copy
 * chip; "Check again" looks for it. The server decides every answer; the handle rule is mirrored
 * only so a typo is said before anything is sent. A found post reloads the agent, whose `xHandle`
 * then closes this card in the parent.
 */
export function XConnect({
  x,
  canManage,
  staged,
  onChallenge,
  onVerify,
  idPrefix,
  well = false,
}: XConnectProps) {
  const [handle, setHandle] = useState(staged?.handle ?? x?.challenge?.handle ?? "");
  const [card, setCard] = useState<XCardState>(staged?.card ?? cardFrom(x));
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (copiedTimer.current) {
        clearTimeout(copiedTimer.current);
      }
    };
  }, []);

  /* The X state lands after the first paint: a live challenge it carries fills the card once,
     unless the person already started one here. */
  const [seen, setSeen] = useState(x);
  if (x !== seen) {
    setSeen(x);
    if (!staged && !card.challenge && !card.checking) {
      setCard(cardFrom(x));
      if (x?.challenge && !handle) {
        setHandle(x.challenge.handle);
      }
    }
  }

  const view = xView(card);
  const typed = xHandleInput(handle);
  const shut = !canManage || card.unavailable;

  function fail(caught: unknown, forHandle: string) {
    const problem = xProblem(
      errorCode(caught),
      forHandle,
      caught instanceof Error ? caught.message : "Could not reach X. Try again.",
    );
    switch (problem.kind) {
      case "unavailable":
        setCard((current) => ({ ...current, checking: false, unavailable: true }));
        return;
      case "taken":
        setCard((current) => ({ ...current, checking: false, taken: problem.handle }));
        return;
      case "expired":
        setCard((current) => ({ ...current, checking: false, challenge: null }));
        setError(problem.text);
        return;
      case "preview":
        setCard((current) => ({ ...current, checking: false }));
        setNote(PREVIEW_NOTE);
        return;
      default:
        setCard((current) => ({ ...current, checking: false }));
        setError(problem.text);
    }
  }

  async function submit() {
    if (shut || card.checking || !handle.trim()) {
      return;
    }
    setError("");
    setNote("");
    if (!typed) {
      setError("That isn't an X handle.");
      return;
    }
    setCard((current) => ({ ...current, checking: true, taken: null }));
    /* The same handle with a line out: look for the post. A new handle: a new line for it. */
    const sameHandle = card.challenge?.handle.toLowerCase() === typed.toLowerCase();
    try {
      if (sameHandle) {
        const result = await onVerify();
        if (mounted.current) {
          setCard((current) => ({
            ...current,
            checking: false,
            challenge: result.verified ? null : current.challenge,
          }));
        }
      } else {
        const issued = await onChallenge(typed);
        if (mounted.current) {
          setCard((current) => ({
            ...current,
            checking: false,
            challenge: { handle: issued.handle, text: issued.text },
          }));
        }
      }
    } catch (caught) {
      if (mounted.current) {
        fail(caught, typed);
      }
    }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(
      () => {
        if (!mounted.current) {
          return;
        }
        setCopied(true);
        if (copiedTimer.current) {
          clearTimeout(copiedTimer.current);
        }
        copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
      },
      () => undefined,
    );
  }

  const inputId = `${idPrefix}-x-handle`;
  return (
    <div className={styles.xConnect} id={`${idPrefix}-x`} data-well={well || undefined}>
      <form
        className={styles.xRow}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <BrandMark name="x" size={13} />
        <label htmlFor={inputId} className={styles.srOnly}>
          X handle
        </label>
        <input
          id={inputId}
          className={styles.xInput}
          type="text"
          value={handle}
          placeholder="@halftimebot"
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          disabled={!canManage}
          onChange={(event) => {
            setHandle(event.target.value);
            setError("");
          }}
        />
        <button
          type="submit"
          className={styles.xVerify}
          disabled={shut || view.disabled || !handle.trim()}
        >
          {view.button}
        </button>
      </form>
      {view.miss && (
        <div className={styles.xMiss} role="status">
          <span className={styles.xMissTitle}>{view.miss.title}</span>
          <span className={styles.xPost}>
            <span className={styles.xPostText}>{view.miss.line}</span>
            <button
              type="button"
              className={styles.copyChip}
              onClick={() => copy(view.miss?.line ?? "")}
            >
              {copied ? "COPIED" : "COPY"}
            </button>
          </span>
          <span className={styles.xMissHint}>{view.miss.hint}</span>
        </div>
      )}
      {view.unavailable && (
        <p className={styles.xLine} role="alert">
          {view.unavailable}
        </p>
      )}
      {view.taken && (
        <p className={styles.xLine} role="alert">
          {view.taken}
        </p>
      )}
      {error && (
        <p className={styles.xLine} role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className={styles.xNoteLine} role="status">
          {note}
        </p>
      )}
    </div>
  );
}
