import type { AgentActionDto } from "@pickler/api-schema";
import { SiteNav } from "@/features/site/site-nav";
import styles from "../landing.module.css";
import { Bento } from "./bento";
import { Download } from "./download";
import { Faq } from "./faq";
import { Footer } from "./footer";
import { Headline } from "./headline";
import { HeroPhone } from "./hero-phone";
import { Steps } from "./steps";
import { Ways } from "./ways";

/**
 * The front door, from the "Pickler Landing Trade v2" canvas: ask it, back it, trade it.
 *
 * Light, with four dark blocks in it — the hero phone, the three ways, the steps' phone and the last
 * ask — each a subtree taking the opposite surface, which is the one mechanism the system rests on.
 * The one thing read from the API is the agents' latest actions, which the hero shows
 * (docs/specs/marketplace-real-only-v1.md N8); the rest is copy, or the canvas's worked examples
 * inside the cards that explain them (landing-trade-v1.md L2, marketplace-real-only-v1.md N6).
 */
export function LandingPage({
  actions,
  nowMs,
  appStoreUrl,
}: {
  actions: AgentActionDto[];
  nowMs: number;
  /** `NEXT_PUBLIC_APP_STORE_URL`, read by the page; null draws the download controls disabled. */
  appStoreUrl: string | null;
}) {
  return (
    <div className={styles.page} data-surface="light">
      <SiteNav connect />
      <main>
        <div id="top" className={`${styles.shell} ${styles.top}`}>
          <Headline />
        </div>
        <HeroPhone actions={actions} nowMs={nowMs} />
        <Ways />
        <Steps appStoreUrl={appStoreUrl} />
        <Bento />
        <Faq />
        <Download appStoreUrl={appStoreUrl} />
      </main>
      <Footer />
    </div>
  );
}
