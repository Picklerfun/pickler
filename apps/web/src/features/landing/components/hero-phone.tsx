"use client";

import { useState } from "react";
import styles from "../landing.module.css";
import { BUBBLE_TICK_MS, bubblesAt, type Bubble } from "../lib/demo";
import { useTicker } from "../lib/use-ticker";
import { Mark } from "./mark";
import { MarketScreen } from "./phone";

/**
 * The app, floating in a dark panel, with one exchange going on around it: what you ask or do on the
 * left, what the agents answer on the right. Six pairs cycle (`bubblesAt`); a new pair remounts the
 * cards, which is what restarts their entrance.
 *
 * The phone and the bubbles are an illustration and are hidden from assistive technology; the line
 * under them says in words what the picture shows.
 */
export function HeroPhone() {
  const [tick, setTick] = useState(0);
  useTicker(BUBBLE_TICK_MS, () => setTick((t) => t + 1));
  const { pairIndex, pair, answerOn } = bubblesAt(tick);

  return (
    <section className={`${styles.shell} ${styles.heroPhoneShell}`} aria-label="The app">
      <div id="hero-phone" className={styles.heroPhone} data-surface="dark">
        <span className={`${styles.cornerTag} ${styles.cornerLeft}`}>
          <span className={styles.liveDot} aria-hidden="true" />
          THE APP · MONAD TESTNET
        </span>
        <span className={`${styles.cornerPill} ${styles.cornerRight}`}>iOS · TESTFLIGHT</span>
        <div className={styles.glow} aria-hidden="true" />
        <div className={styles.heroPhoneInner} aria-hidden="true">
          <div className={styles.float}>
            <MarketScreen />
          </div>
        </div>
        <div className={`${styles.bubbles} ${styles.bubblesLeft}`} aria-hidden="true">
          <span className={styles.bubbleKicker}>
            <Mark hue="lime" className={styles.kickerDot} />
            YOU · HIRE, BACK, TRADE
          </span>
          <BubbleCard key={`q-${pairIndex}`} bubble={pair.q} side="left" />
        </div>
        <div className={`${styles.bubbles} ${styles.bubblesRight}`} aria-hidden="true">
          <span className={styles.bubbleKicker}>
            <Mark hue="violet" className={styles.kickerDot} />
            THE AGENTS ANSWER
          </span>
          {answerOn && <BubbleCard key={`a-${pairIndex}`} bubble={pair.a} side="right" />}
        </div>
        <div className={styles.fade} aria-hidden="true" />
        <p className={styles.heroPhoneLine}>
          Hire. Back. Trade. The agents show their work; you decide what to do with it.
        </p>
      </div>
    </section>
  );
}

function BubbleCard({ bubble, side }: { bubble: Bubble; side: "left" | "right" }) {
  return (
    <div className={styles.bubble} data-side={side}>
      <div className={styles.bubbleHead}>
        <Mark hue={bubble.hue} className={styles.bubbleDot} />
        <span className={styles.bubbleWho}>{bubble.who}</span>
      </div>
      <p className={styles.bubbleText}>{bubble.text}</p>
      <span className={`${styles.bubbleTag} ${styles.hue}`} data-hue={bubble.hue}>
        {bubble.tag}
      </span>
    </div>
  );
}
