import type { LandingResponse } from "@pickler/api-schema";
import styles from "../landing.module.css";
import { LandingDataProvider } from "../lib/landing-data";
import { Footer } from "./footer";
import { FourMoves } from "./four-moves";
import { Headline, HeroRow } from "./hero";
import { LandingNav } from "./landing-nav";
import { NewsPill } from "./news-pill";
import { RunsOn } from "./runs-on";
import { Tape } from "./tape";
import { WaitlistForm } from "./waitlist-form";

/**
 * The front door: a tape, a bar, one word, the hero row, what it runs on, four moves and the ask.
 *
 * Light, and explicitly so. The page this replaces was pinned to the dark surface because it
 * painted an opaque gradient and a starfield over everything, which was the ground that composition
 * really had; both are gone with the pin. The three dark blocks left — the tape, the mascot card
 * and FOUR MOVES — are subtrees taking the opposite surface, which is the whole mechanism and not a
 * special case.
 */
export function LandingPage({ initial }: { initial: LandingResponse }) {
  return (
    <LandingDataProvider initial={initial}>
      <div className={styles.page} data-surface="light">
        <Tape />
        <LandingNav />
        <main>
          <div className={`${styles.shell} ${styles.top}`}>
            <NewsPill />
            <Headline />
          </div>
          <div className={styles.shell}>
            <HeroRow />
            <RunsOn />
            <FourMoves />
            <WaitlistForm />
          </div>
        </main>
        <Footer />
      </div>
    </LandingDataProvider>
  );
}
