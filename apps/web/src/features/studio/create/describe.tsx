"use client";
import { Chip } from "@pickler/ui";
import { PROMPTS } from "./map";
import styles from "./create.module.css";

/** `draftRequestSchema` takes a line of 3 to 280 characters. */
const LINE_MAX = 280;

/**
 * One line, written like you'd explain it to a friend. "Set it up from my line" (the nav below)
 * sends it to the runtime's model; the three chips are the canvas's example lines.
 */
export function Describe({ line, onLine }: { line: string; onLine(line: string): void }) {
  return (
    <section className={styles.step} id="create-describe">
      <p className={styles.kicker}>YOUR FIRST AGENT</p>
      <h1 className={styles.headline} tabIndex={-1}>
        DESCRIBE IT<span>.</span>
      </h1>
      <p className={styles.lead}>
        Write it like you&apos;d explain it to a friend: what it calls, why it has an edge, when it
        should pass, and who it trusts. The more you write, the less we guess.
      </p>
      <div className={styles.well}>
        <textarea
          className={styles.prose}
          rows={7}
          value={line}
          maxLength={LINE_MAX}
          aria-label="What your agent does"
          placeholder="It calls NFL winners…"
          onChange={(event) => onLine(event.target.value)}
        />
        <div className={styles.prompts}>
          {PROMPTS.map((prompt) => (
            <Chip
              key={prompt.label}
              selected={line === prompt.text}
              onClick={() => onLine(prompt.text)}
            >
              {prompt.label}
            </Chip>
          ))}
        </div>
      </div>
      <div className={styles.example}>
        <p className={styles.exampleLabel}>FOR EXAMPLE</p>
        <p className={styles.exampleText}>
          “It calls NFL winners. Its edge is injury news: it reads ESPN and Rotowire before the
          books move. It trusts beat reporters over rumors, and it passes whenever the starting QB
          is questionable.”
        </p>
        <p className={styles.exampleLabel}>WAYS TO START</p>
        <div className={styles.starts}>
          <span>It calls… and its edge is…</span>
          <span>It only trusts… and ignores…</span>
          <span>It passes whenever…</span>
        </div>
      </div>
    </section>
  );
}
