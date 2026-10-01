import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./status.module.css";

/**
 * Which state the screen is in, carried by the headline's full stop and, when it is not the plain
 * one, by the eyebrow: lime for "nothing here" and "no match", loss for our own failure, cool for
 * offline, caution for anything the person can fix (a wrong network).
 */
export type StatusTone = "lime" | "loss" | "cool" | "caution";

/**
 * One secondary state (canvas "Pickler Error States"). The screen draws the copy and leaves the
 * ground to whoever hosts it: the marketplace's shell, the studio, or `StatusFrame` for the route
 * fallbacks that have no shell.
 */
export function StatusScreen({
  id,
  tone = "lime",
  eyebrow,
  title,
  body,
  children,
  aside,
  mascot = false,
  inside = false,
  foot,
}: {
  /** The landmark's id, which the design checks and a smoke test find the state by. */
  id: string;
  tone?: StatusTone;
  eyebrow: string;
  /** The headline without its full stop; the stop is the tone. */
  title: string;
  body: ReactNode;
  /** Everything under the sentence: the details, then the ways out. */
  children?: ReactNode;
  /** A panel beside the copy, on screens that have one. */
  aside?: ReactNode;
  mascot?: boolean;
  /**
   * The state sits under a page's own heading (the directory, the portfolio), so its headline is an
   * `h2` and a size smaller. Alone on a page it is the page's `h1`.
   */
  inside?: boolean;
  /** The screen's small print, under the ways out. */
  foot?: string;
}) {
  const Heading = inside ? "h2" : "h1";
  return (
    <section id={id} className={styles.screen} data-tone={tone} aria-labelledby={`${id}-title`}>
      {mascot && (
        <Image
          src="/brand/mascot.webp"
          alt=""
          width={1000}
          height={834}
          className={styles.mascot}
          priority
          unoptimized
        />
      )}
      <div className={styles.copy}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <Heading id={`${id}-title`} className={styles.title} data-inside={inside || undefined}>
          {title}
          <span className={styles.stop}>.</span>
        </Heading>
        <p className={styles.body}>{body}</p>
        {children}
        {foot && <p className={styles.foot}>{foot}</p>}
      </div>
      {aside}
    </section>
  );
}

/** The ways out, under the sentence. */
export function StatusActions({ children }: { children: ReactNode }) {
  return <div className={`${styles.row} ${styles.actions}`}>{children}</div>;
}

/**
 * A whole page for a state that has no shell around it: the root 404 and the error boundaries.
 * Dark, as the canvas draws them, on both products; the bar carries only the mark, because a
 * fallback cannot know which product's navigation would still work.
 */
export function StatusFrame({ children, foot }: { children: ReactNode; foot: string }) {
  return (
    <div className={styles.frame} data-surface="dark">
      <header className={styles.bar}>
        <Link href="/" className={styles.brand}>
          <Image src="/brand/logo.png" alt="" width={22} height={23} priority />
          PICKLER
        </Link>
        <span className={styles.spacer} />
        <span className={styles.pill}>TESTNET</span>
      </header>
      {children}
      <p className={styles.frameFoot}>{foot}</p>
    </div>
  );
}
