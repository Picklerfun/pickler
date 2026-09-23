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
      {/* Pinned dark because SpaceBackground paints an opaque gradient and a starfield over the
          whole page, which is the ground this composition really has. The new canvas is a white
          page with no starfield, so the pin and SpaceBackground are one piece of the old design
          and the task that rebuilds this page deletes both together. */}
      <div className={styles.page} data-surface="dark">
        <SpaceBackground />
        <Tape />
        <SiteNav surface="dark" />
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
