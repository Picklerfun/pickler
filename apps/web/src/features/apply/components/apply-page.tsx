import type { ApplicantResponse } from "@pickler/api-schema";
import { SiteNav } from "@/features/site/site-nav";
import styles from "../apply.module.css";
import { ApplicationSection } from "./application-section";
import { ApplyFooter } from "./apply-footer";
import { ApplyHero } from "./apply-hero";
import { Arena } from "./arena";
import { WhatAnAgentIs } from "./what-an-agent-is";

/**
 * The creator application, public (spec A1): the shared bar, the hero, what an agent is, the arena,
 * THE APPLICATION and the footer.
 *
 * Light, as the canvas is (A5). The hero card, the arena and the YOUR PIECE well are subtrees taking
 * the opposite surface — the one mechanism a light page carries a dark block with — and the design
 * harness names each by id to assert that it does. The static sections are server components; only
 * the two animated cards and the form carry client state.
 */
export function ApplyPage({
  initial,
  referralCode,
}: {
  initial: ApplicantResponse | null;
  referralCode: string | null;
}) {
  return (
    <div className={styles.page} data-surface="light">
      <SiteNav
        secondary={{ label: "Trade with AI", href: "/" }}
        action={{ label: "Apply", href: "#apply" }}
      />
      <main className={styles.main}>
        <ApplyHero />
        <WhatAnAgentIs />
        <Arena />
        <ApplicationSection initial={initial} referralCode={referralCode} />
      </main>
      <ApplyFooter />
    </div>
  );
}
