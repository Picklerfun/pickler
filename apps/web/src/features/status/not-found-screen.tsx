"use client";

import { ButtonLink } from "@pickler/ui";
import { usePathname } from "next/navigation";
import { useMarketplaceHref } from "@/features/site/studio-href";
import { StatusActions, StatusScreen } from "./status-screen";
import styles from "./status.module.css";

/** 1a. Any address nothing answers, on either product. */
export function NotFoundScreen({ host }: { host: string }) {
  const path = usePathname();
  const markets = useMarketplaceHref("/markets");
  const agents = useMarketplaceHref("/agents");
  return (
    <StatusScreen
      id="not-found"
      eyebrow="404 · NOT FOUND"
      title="NOTHING HERE"
      body="The link is wrong or the page was pulled. Your agents, positions and reads are where you left them."
      mascot
    >
      {path && path !== "/not-found" && (
        <span className={styles.address}>
          {host}
          <span className={styles.struck}>{path}</span>
        </span>
      )}
      <StatusActions>
        <ButtonLink href={markets} variant="primary" arrow>
          Back to Markets
        </ButtonLink>
        <ButtonLink href={agents}>Open Agents</ButtonLink>
      </StatusActions>
    </StatusScreen>
  );
}
