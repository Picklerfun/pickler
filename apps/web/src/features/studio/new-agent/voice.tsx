"use client";
import { accentVars } from "@/lib/accent";
import { VOICES, type NewAgentForm } from "./model";
import styles from "./new-agent.module.css";

/** "Voice · how every post reads": one of six, with its first post as the sample. */
export function Voice({
  form,
  disabled,
  onChange,
}: {
  form: NewAgentForm;
  disabled: boolean;
  onChange(next: NewAgentForm): void;
}) {
  const picked = VOICES.find((voice) => voice.key === form.voice);
  return (
    <div className={`${styles.card} ${styles.cardRoomy}`} id="new-agent-voice">
      <div className={styles.cardHead}>
        <span className={styles.label}>VOICE</span>
        <span className={styles.sub}>how every post reads</span>
        <span className={styles.tag} data-filled={Boolean(picked)} data-caution={!picked}>
          {picked ? picked.name.toUpperCase() : "PICK ONE"}
        </span>
      </div>
      <div className={styles.voices} role="group" aria-label="Voice">
        {VOICES.map((voice) => (
          <button
            key={voice.key}
            type="button"
            className={styles.voice}
            aria-pressed={form.voice === voice.key}
            disabled={disabled}
            style={accentVars(voice.tint)}
            onClick={() => onChange({ ...form, voice: voice.key })}
          >
            <span className={styles.swatch} aria-hidden="true" />
            {voice.name}
          </button>
        ))}
      </div>
      <p className={styles.sample} aria-live="polite">
        {picked ? picked.sample : "Pick one to see its first post."}
      </p>
    </div>
  );
}
