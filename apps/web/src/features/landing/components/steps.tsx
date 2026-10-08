"use client";

import { Icon } from "@pickler/ui";
import { useState } from "react";
import styles from "../landing.module.css";
import { stepLabel, STEPS, type Screen } from "../lib/demo";
import { AppStoreLink } from "./app-store-link";
import { AgentsScreen, MarketScreen, SignInScreen, WalletScreen } from "./phone";

const SCREENS: Record<Screen, () => React.JSX.Element> = {
  signin: SignInScreen,
  wallet: WalletScreen,
  agents: AgentsScreen,
  market: MarketScreen,
};

/**
 * FOUR STEPS: the steps on the left, the screen each one lands on in the phone on the right. The
 * chosen step is lifted, and choosing another swaps the screen.
 */
export function Steps({ appStoreUrl }: { appStoreUrl: string | null }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step] ?? STEPS[0]!;
  const ScreenOf = SCREENS[current.screen];

  return (
    <section id="app" className={`${styles.shell} ${styles.section}`} aria-labelledby="app-title">
      <div className={styles.sectionHead}>
        <p className={styles.eyebrow}>
          <span className={styles.liveDot} aria-hidden="true" />
          THE APP · iOS · TESTFLIGHT
        </p>
        <h2 id="app-title" className={styles.title}>
          FOUR STEPS
          <span className={styles.stop} data-hue="lime">
            .
          </span>
        </h2>
        <p className={styles.sectionLead}>
          A passkey and some AUSD. No seed phrase, no extension, no waiting.
        </p>
      </div>
      <div className={styles.steps}>
        <div className={styles.stepsList} role="tablist" aria-label="Steps">
          {STEPS.map((item, index) => (
            <button
              key={item.screen}
              type="button"
              role="tab"
              aria-selected={index === step}
              className={`${styles.step} ${index === step ? styles.stepOn : ""}`}
              onClick={() => setStep(index)}
            >
              <span className={styles.stepNum} aria-hidden="true">
                0{index + 1}
              </span>
              <span className={styles.stepBody}>
                <span className={styles.stepTitle}>{item.title}</span>
                <span className={styles.stepNote}>{item.note}</span>
              </span>
            </button>
          ))}
          <AppStoreLink
            url={appStoreUrl}
            surface="dark"
            className={`${styles.pill} ${styles.pillInk}`}
          >
            Download on the App Store
            <span className={`${styles.pillBadge} ${styles.pillBadgeLime}`} aria-hidden="true">
              <Icon name="arrow" size={13} />
            </span>
          </AppStoreLink>
        </div>
        <div id="steps-phone" className={styles.stepsPhone} data-surface="dark" role="tabpanel">
          <span className={`${styles.cornerTag} ${styles.cornerLeft}`}>{stepLabel(step)}</span>
          <div className={`${styles.glow} ${styles.glowHigh}`} aria-hidden="true" />
          <div className={styles.stepsPhoneInner} aria-hidden="true">
            <ScreenOf />
          </div>
          <div className={`${styles.fade} ${styles.fadeShort}`} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
