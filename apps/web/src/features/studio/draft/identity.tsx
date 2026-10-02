"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@pickler/ui";
import { accentVars } from "@/lib/accent";
import { errorCode } from "../api";
import { AvatarPicker, type AvatarChoice } from "../new-agent/avatar-picker";
import { AvatarGrid } from "../new-agent/identity";
import { VOICES, radioStep, type VoiceKey } from "../new-agent/model";
import { disconnectProblem, nameChange, voiceOf, xAccountTag, NAME_MAX } from "./model";
import { DraftSection, type DraftSectionProps } from "./section";
import { SaveOutcome, useSetupSave } from "./setup-save";
import { PREVIEW_NOTE } from "./use-draft";
import { XConnect } from "./x-connect";
import styles from "./identity.module.css";

/** Where a name, avatar or disconnect write stands, in words under its control. */
type WriteState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "preview" }
  | { kind: "error"; text: string };

const IDLE: WriteState = { kind: "idle" };

const failed = (caught: unknown, fallback: string): WriteState =>
  errorCode(caught) === "PREVIEW"
    ? { kind: "preview" }
    : { kind: "error", text: caught instanceof Error ? caught.message : fallback };

/**
 * Identity & voice (spec D14, §3.2; canvas 443–477). The avatar opens the create screen's picker
 * and saves accent and pattern once it closes; NAME saves on blur or Enter (1–40 once trimmed, an
 * unchanged name sends nothing); the handle is fixed. VOICE is a radio group that saves the pick
 * at once through `PUT /setup`, with its sample under it. X ACCOUNT connects by a post
 * (`x-connect.tsx`) or shows the verified handle with DISCONNECT, which a public agent is refused.
 * A view-only member sees every control shut; a staged or preview studio says nothing is saved.
 */
export function Identity({ agent, draft, canManage }: DraftSectionProps) {
  const nameId = useId();
  const voiceLabel = useId();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /* The NAME box, starting over whenever the saved name moves (its own save, or a reload). */
  const savedName = agent.name ?? "";
  const [name, setName] = useState(savedName);
  const [seenName, setSeenName] = useState(savedName);
  if (savedName !== seenName) {
    setSeenName(savedName);
    setName(savedName);
  }
  const [nameState, setNameState] = useState<WriteState>(IDLE);

  async function commitName() {
    const change = nameChange(agent.name, name);
    if (change.kind === "same") {
      setName(savedName);
      return;
    }
    if (change.kind === "bad") {
      setNameState({ kind: "error", text: change.text });
      return;
    }
    setNameState({ kind: "saving" });
    try {
      await draft.saveIdentity({ name: change.name });
      if (alive.current) {
        setNameState({ kind: "saved" });
      }
    } catch (caught) {
      if (alive.current) {
        setNameState(failed(caught, "Could not save the name."));
      }
    }
  }

  /* The avatar: the picker edits a copy, saved once when it closes if it changed. */
  const savedAvatar: AvatarChoice = { accent: agent.accent, pattern: agent.avatarPattern };
  const [picking, setPicking] = useState<AvatarChoice | null>(null);
  const [savingAvatar, setSavingAvatar] = useState<AvatarChoice | null>(null);
  const [avatarState, setAvatarState] = useState<WriteState>(IDLE);
  const avatar = picking ?? savingAvatar ?? savedAvatar;

  async function closeAvatar() {
    const choice = picking;
    setPicking(null);
    if (
      !choice ||
      (choice.accent === savedAvatar.accent && choice.pattern === savedAvatar.pattern)
    ) {
      return;
    }
    setSavingAvatar(choice);
    setAvatarState({ kind: "saving" });
    try {
      await draft.saveIdentity({ avatar: { accent: choice.accent, pattern: choice.pattern } });
      if (alive.current) {
        setAvatarState({ kind: "saved" });
      }
    } catch (caught) {
      if (alive.current) {
        setAvatarState(failed(caught, "Could not save the avatar."));
      }
    } finally {
      if (alive.current) {
        setSavingAvatar(null);
      }
    }
  }

  /* VOICE: the pick is drawn at once and saved; a stale save reloads and says so. */
  const voiceSave = useSetupSave(draft);
  const [pendingVoice, setPendingVoice] = useState<VoiceKey | null>(null);
  const savedVoice = voiceOf(agent.config.voice);
  const voice = voiceSave.saving && pendingVoice ? pendingVoice : savedVoice;
  const voiceIndex = Math.max(
    0,
    VOICES.findIndex((option) => option.key === voice),
  );
  const sample = VOICES[voiceIndex]?.sample ?? "";

  function pickVoice(key: VoiceKey) {
    if (!canManage || voiceSave.saving || key === savedVoice) {
      return;
    }
    setPendingVoice(key);
    void voiceSave.save({ voice: key });
  }

  /* A radio group: the chosen chip is the tab stop; the arrows move the choice and the focus. */
  function voiceArrows(event: KeyboardEvent<HTMLDivElement>) {
    const next = radioStep(event.key, voiceIndex, VOICES.length);
    if (next === null || voiceSave.saving) {
      return;
    }
    event.preventDefault();
    const radios = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    radios[next]?.focus();
    const key = VOICES[next]?.key;
    if (key) {
      pickVoice(key);
    }
  }

  /* X ACCOUNT: the verified handle as the X read has it, else as the agent carries it. */
  const xHandle = draft.x ? (draft.x.account?.handle ?? null) : (agent.xHandle ?? null);
  const [xState, setXState] = useState<WriteState>(IDLE);

  /* A verified post unmounts Connect X and its Verify button, which held the focus: the
     connected handle takes it, so the focus never drops to the page. */
  const xHandleRef = useRef<HTMLSpanElement>(null);
  const wasConnected = useRef(xHandle !== null);
  useEffect(() => {
    if (xHandle !== null && !wasConnected.current) {
      const active = document.activeElement;
      if (!active || active === document.body) {
        xHandleRef.current?.focus();
      }
    }
    wasConnected.current = xHandle !== null;
  }, [xHandle]);

  async function disconnect() {
    if (!canManage || xState.kind === "saving") {
      return;
    }
    setXState({ kind: "saving" });
    try {
      await draft.disconnectX();
      if (alive.current) {
        setXState(IDLE);
      }
    } catch (caught) {
      if (!alive.current) {
        return;
      }
      if (errorCode(caught) === "PREVIEW") {
        setXState({ kind: "preview" });
        return;
      }
      setXState({
        kind: "error",
        text: disconnectProblem(
          errorCode(caught),
          caught instanceof Error ? caught.message : "Could not disconnect X.",
        ),
      });
    }
  }

  return (
    <DraftSection section="identity">
      <div className={styles.column}>
        <div className={styles.identity} id="draft-identity-card">
          <button
            type="button"
            className={styles.avatarButton}
            style={accentVars(avatar.accent)}
            aria-label="Pick its avatar"
            title="Pick its avatar"
            aria-haspopup="dialog"
            disabled={!canManage || avatarState.kind === "saving"}
            onClick={() => {
              setAvatarState(IDLE);
              setPicking(avatar);
            }}
          >
            <AvatarGrid pattern={avatar.pattern} />
          </button>
          <div className={styles.identityText}>
            <label className={styles.nameLabel} htmlFor={nameId}>
              NAME
            </label>
            <input
              id={nameId}
              className={styles.nameInput}
              type="text"
              value={name}
              maxLength={NAME_MAX}
              autoComplete="off"
              spellCheck={false}
              disabled={!canManage}
              aria-invalid={nameState.kind === "error" || undefined}
              aria-describedby={`${nameId}-state`}
              onChange={(event) => {
                setName(event.target.value);
                if (nameState.kind !== "saving") {
                  setNameState(IDLE);
                }
              }}
              onBlur={() => void commitName()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitName();
                }
              }}
            />
            <span className={styles.handleRow}>
              {agent.handle ? `@${agent.handle}` : "NO HANDLE"}
              <span className={styles.fixed}>HANDLE IS FIXED</span>
            </span>
            <span id={`${nameId}-state`}>
              <WriteLine state={nameState} />
              <WriteLine state={avatarState} />
            </span>
          </div>
        </div>

        <div className={styles.card} id="draft-identity-voice">
          <div className={styles.cardHead}>
            <span className={styles.label} id={voiceLabel}>
              VOICE
            </span>
            <span className={styles.sub}>how every post reads</span>
          </div>
          <div
            className={styles.voices}
            role="radiogroup"
            aria-labelledby={voiceLabel}
            aria-busy={voiceSave.saving || undefined}
            onKeyDown={voiceArrows}
          >
            {VOICES.map((option) => (
              <button
                key={option.key}
                type="button"
                role="radio"
                className={styles.voice}
                aria-checked={voice === option.key}
                tabIndex={voice === option.key ? 0 : -1}
                disabled={!canManage}
                style={accentVars(option.tint)}
                onClick={() => pickVoice(option.key)}
              >
                <span className={styles.swatch} aria-hidden="true" />
                {option.name}
              </button>
            ))}
          </div>
          <p className={styles.sample} aria-live="polite">
            {sample}
          </p>
          {voiceSave.saving && <p className={styles.notice}>Saving…</p>}
          <SaveOutcome state={voiceSave.state} />
        </div>

        <div className={styles.card} id="draft-identity-x">
          <div className={styles.cardHead}>
            <span className={styles.label}>X ACCOUNT</span>
            <span className={styles.sub}>where it posts · optional</span>
            <span className={styles.xTag} data-on={xHandle !== null}>
              {xAccountTag(xHandle)}
            </span>
          </div>
          {xHandle ? (
            <div className={styles.xAccount}>
              <span className={styles.xDot} aria-hidden="true" />
              <span className={styles.xHandle} ref={xHandleRef} tabIndex={-1}>
                @{xHandle}
              </span>
              <button
                type="button"
                className={styles.disconnect}
                disabled={!canManage || xState.kind === "saving"}
                aria-label={`Disconnect @${xHandle}`}
                onClick={() => void disconnect()}
              >
                {xState.kind === "saving" ? "DISCONNECTING…" : "DISCONNECT"}
              </button>
            </div>
          ) : (
            <XConnect
              x={draft.x}
              canManage={canManage}
              onChallenge={draft.challengeX}
              onVerify={draft.verifyX}
              idPrefix="draft-identity"
              well
            />
          )}
          {/* The button says DISCONNECTING… while it is out. */}
          <WriteLine state={xState.kind === "saving" ? IDLE : xState} />
        </div>
      </div>

      {/* Always mounted, so closing hands the focus back to the avatar button. */}
      <AvatarPicker
        open={picking !== null}
        form={picking ?? avatar}
        onChange={setPicking}
        onClose={() => void closeAvatar()}
      />
    </DraftSection>
  );
}

/** A write's words under its control: SAVING…, SAVED, the preview note or the reason. */
function WriteLine({ state }: { state: WriteState }) {
  switch (state.kind) {
    case "saving":
      return <span className={styles.nameState}>SAVING…</span>;
    case "saved":
      return (
        <span className={styles.nameState} data-tone="good" role="status">
          SAVED
        </span>
      );
    case "preview":
      return (
        <span className={styles.notice} role="status">
          {PREVIEW_NOTE}
        </span>
      );
    case "error":
      return (
        <span className={styles.alert} role="alert">
          <Icon name="alert" size={12} />
          {state.text}
        </span>
      );
    default:
      return null;
  }
}
