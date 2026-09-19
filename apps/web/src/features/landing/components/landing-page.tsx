import type { LandingResponse } from "@pickler/api-schema";
import styles from "../landing.module.css";
import { SiteNav } from "@/features/site/site-nav";
import { LandingDataProvider } from "../lib/landing-data";
import { Footer } from "./footer";
import { Headline, HeroModules } from "./hero";
import { HowItWorks } from "./how-it-works";
import { LatestPick } from "./latest-pick";
import { LaunchingNow } from "./launching-now";
import { NewsBanner } from "./news-banner";
import { RunsOn } from "./runs-on";
import { SpaceBackground } from "./space-background";
import { Tape } from "./tape";
import { TopAgents } from "./top-agents";
import { WaitlistForm } from "./waitlist-form";

export function LandingPage({ initial }: { initial: LandingResponse }) {
  return (
    <LandingDataProvider initial={initial}>
      <div className={styles.page} data-surface="public">
        <SpaceBackground />
        <Tape />
        <SiteNav />
        <main>
          <div id="top" className={styles.top}>
            <NewsBanner />
            <Headline />
          </div>
          <HeroModules />
          <RunsOn />
          <HowItWorks />
          <LaunchingNow />
          <section
            id="agents"
            className={`${styles.layer} ${styles.ruleBottom}`}
            aria-labelledby="agents-title"
          >
            <div className={`${styles.container} ${styles.boardRow}`}>
              <TopAgents />
              <LatestPick />
            </div>
          </section>
          <WaitlistForm />
        </main>
        <Footer />
      </div>
    </LandingDataProvider>
  );
}
