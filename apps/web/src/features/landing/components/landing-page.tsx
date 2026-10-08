import type { LandingResponse } from "@pickler/api-schema";
import { SiteNav } from "@/features/site/site-nav";
import styles from "../landing.module.css";
import { LandingDataProvider } from "../lib/landing-data";
import { Bento } from "./bento";
import { Download } from "./download";
import { Faq } from "./faq";
import { Footer } from "./footer";
import { Headline } from "./headline";
import { HeroPhone } from "./hero-phone";
import { NewsPill } from "./news-pill";
import { Steps } from "./steps";
import { Ways } from "./ways";

/**
 * The front door, from the "Pickler Landing Trade v2" canvas: ask it, back it, trade it.
 *
 * Light, with four dark blocks in it — the hero phone, the three ways, the steps' phone and the last
 * ask — each a subtree taking the opposite surface, which is the one mechanism the system rests on.
 * The one live figure on the page is the announcement; everything else is the canvas's worked
 * examples, inside the cards that explain them (docs/specs/landing-trade-v1.md L2).
 */
export function LandingPage({
  initial,
  appStoreUrl,
}: {
  initial: LandingResponse;
  /** `NEXT_PUBLIC_APP_STORE_URL`, read by the page; null draws the download controls disabled. */
  appStoreUrl: string | null;
}) {
  return (
    <LandingDataProvider initial={initial}>
      <div className={styles.page} data-surface="light">
        <SiteNav connect />
        <main>
          <div id="top" className={`${styles.shell} ${styles.top}`}>
            <NewsPill />
            <Headline />
          </div>
          <HeroPhone />
          <Ways />
          <Steps appStoreUrl={appStoreUrl} />
          <Bento />
          <Faq />
          <Download appStoreUrl={appStoreUrl} />
        </main>
        <Footer />
      </div>
    </LandingDataProvider>
  );
}
