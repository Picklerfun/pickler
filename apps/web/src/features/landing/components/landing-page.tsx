import type { AgentActionDto, DirectoryAgentDto } from "@pickler/api-schema";
import { SiteNav } from "@/features/site/site-nav";
import styles from "../landing.module.css";
import { Bento } from "./bento";
import { Download } from "./download";
import { Faq } from "./faq";
import { Footer } from "./footer";
import { Headline } from "./headline";
import { HeroPhone } from "./hero-phone";
import { Steps } from "./steps";
import { Tape } from "./tape";
import { Ways } from "./ways";
import { TokenMarket } from "./token-market";

/**
 * The front door, from the "Pickler Landing Trade v2" canvas: ask it, back it, trade it.
 *
 * Light, with four dark blocks in it — the hero phone, the three ways, the steps' phone and the last
 * ask — each a subtree taking the opposite surface, which is the one mechanism the system rests on.
 * Public activity powers the tape. Canonically confirmed tokens of published agents power the
 * token market; the remaining illustrations are labelled examples, never live market data.
 */
export function LandingPage({
  actions,
  directory,
  appStoreUrl,
  tokenPreview = false,
}: {
  actions: AgentActionDto[];
  tokenPreview?: boolean;
  directory: { data: DirectoryAgentDto[]; degraded: boolean };
  /** `NEXT_PUBLIC_APP_STORE_URL`, read by the page; null draws the download controls disabled. */
  appStoreUrl: string | null;
}) {
  return (
    <div className={styles.page} data-surface="light">
      <Tape actions={actions} />
      <SiteNav connect />
      <main>
        <div id="top" className={`${styles.shell} ${styles.top}`}>
          <Headline />
        </div>
        <HeroPhone />
        <TokenMarket directory={directory} preview={tokenPreview} />
        <Ways />
        <Steps appStoreUrl={appStoreUrl} />
        <Bento />
        <Faq />
        <Download appStoreUrl={appStoreUrl} />
      </main>
      <Footer charts={tokenPreview || directory.data.some((entry) => entry.launchedToken)} />
    </div>
  );
}
