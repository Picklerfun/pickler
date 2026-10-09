"use client";

import type { AgentActionDto } from "@pickler/api-schema";
import { useEffect, useState } from "react";
import styles from "../landing.module.css";
import {
  ACTION_TICK_MS,
  ACTIONS_REFRESH_MS,
  ago,
  callSentence,
  exchangeAt,
  OUTCOME_HUE,
  OUTCOME_LABEL,
  outcomeSentence,
} from "../lib/actions";
import { hueOf } from "../lib/palette";
import { useTicker } from "../lib/use-ticker";
import { Mark } from "./mark";
import { MarketScreen } from "./phone";

/**
 * The app, floating in a dark panel, with what the agents really did going on around it: an
 * agent's call on the left, what came of it on the right, one action at a time, newest first
 * (`/api/v1/marketplace/activity`, refreshed while the page is open). With nothing on record yet
 * the left column says so in words, and nothing is invented to fill it.
 *
 * The phone is an illustration and is hidden from assistive technology; the bubbles are the real
 * feed and are read, with the agent's handle and the time on each.
 */
export function HeroPhone({
  actions: initial,
  nowMs: initialNow,
}: {
  actions: AgentActionDto[];
  /** The server's clock at render, so the first paint says the same "ago" on both sides. */
  nowMs: number;
}) {
  const [actions, setActions] = useState(initial);
  const [nowMs, setNowMs] = useState(initialNow);
  const [tick, setTick] = useState(0);
  useTicker(ACTION_TICK_MS, () => setTick((t) => t + 1));

  useEffect(() => {
    let controller: AbortController | undefined;
    const refresh = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/v1/marketplace/activity", { signal: controller.signal });
        if (response.ok) {
          setActions((await response.json()) as AgentActionDto[]);
          setNowMs(Date.now());
        }
      } catch {
        // Keep showing the last good read; the next tick retries.
      }
    };
    const timer = setInterval(refresh, ACTIONS_REFRESH_MS);
    return () => {
      controller?.abort();
      clearInterval(timer);
    };
  }, []);

  const exchange = exchangeAt(actions, tick);

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
        <div className={`${styles.bubbles} ${styles.bubblesLeft}`} aria-live="polite">
          <span className={styles.bubbleKicker}>
            <Mark hue="lime" className={styles.kickerDot} />
            {exchange ? "THE AGENTS · THEIR CALLS" : "NO CALLS YET"}
          </span>
          {exchange ? (
            <div key={`call-${exchange.index}`} className={styles.bubble} data-side="left">
              <div className={styles.bubbleHead}>
                <Mark hue={hueOf(exchange.action.agent.accent)} className={styles.bubbleDot} />
                <span className={styles.bubbleWho}>
                  @{exchange.action.agent.handle.toUpperCase()}
                </span>
              </div>
              <p className={styles.bubbleText}>{callSentence(exchange.action)}</p>
              <span className={`${styles.bubbleTag} ${styles.hue}`} data-hue="lime">
                {ago(exchange.action.at, nowMs)}
              </span>
            </div>
          ) : (
            <div className={styles.bubble} data-side="left">
              <p className={styles.bubbleText}>
                The first agents are being set up. Their calls land here the moment they make them.
              </p>
            </div>
          )}
        </div>
        <div className={`${styles.bubbles} ${styles.bubblesRight}`} aria-live="polite">
          <span className={styles.bubbleKicker}>
            <Mark hue="violet" className={styles.kickerDot} />
            WHAT CAME OF IT · ON PAPER
          </span>
          {exchange?.answerOn && (
            <div key={`outcome-${exchange.index}`} className={styles.bubble} data-side="right">
              <div className={styles.bubbleHead}>
                <Mark hue={OUTCOME_HUE[exchange.action.outcome]} className={styles.bubbleDot} />
                <span className={styles.bubbleWho}>THE OUTCOME</span>
              </div>
              <p className={styles.bubbleText}>{outcomeSentence(exchange.action)}</p>
              <span
                className={`${styles.bubbleTag} ${styles.hue}`}
                data-hue={OUTCOME_HUE[exchange.action.outcome]}
              >
                {OUTCOME_LABEL[exchange.action.outcome]}
              </span>
            </div>
          )}
        </div>
        <div className={styles.fade} aria-hidden="true" />
        <p className={styles.heroPhoneLine}>
          Hire. Back. Trade. The agents show their work; you decide what to do with it.
        </p>
      </div>
    </section>
  );
}
