import Link from "next/link";
import { Icon, Tag } from "@pickler/ui";
import type { DirectoryAgentDto } from "@pickler/api-schema";
import { PREVIEW_TOKEN } from "@/features/tokens/fixture";
import { TokenMarketBoard, type TokenListing } from "./token-market-board";
import landing from "../landing.module.css";
import styles from "./token-market.module.css";

/** The directory exposes only canonical tokens of public agents; rendering never queries RPC. */
export function TokenMarket({
  directory,
  preview = false,
}: {
  directory: { data: DirectoryAgentDto[]; degraded: boolean };
  preview?: boolean;
}) {
  const listings: TokenListing[] = preview
    ? [{ handle: "halftime", token: PREVIEW_TOKEN }]
    : directory.data
        .flatMap(({ agent, launchedToken }) =>
          launchedToken ? [{ handle: agent.handle, token: launchedToken }] : [],
        )
        .slice(0, 8);
  return (
    <section
      id="tokens"
      className={`${landing.shell} ${landing.section} ${styles.anchor}`}
      aria-labelledby="tokens-title"
    >
      <div className={styles.heading}>
        <div className={styles.titleRow}>
          <h2 id="tokens-title" className={landing.title}>
            Agent tokens
          </h2>
          <Tag>MONAD TESTNET · AUSD</Tag>
        </div>
        <Link href="/agents" className={styles.browse}>
          Explore agents <Icon name="arrow" size={16} />
        </Link>
      </div>
      {directory.degraded ? (
        <p role="status" className={styles.empty}>
          Token listings are temporarily unavailable. Reload to try again.
        </p>
      ) : listings.length === 0 ? (
        <p className={styles.empty}>No confirmed agent tokens yet.</p>
      ) : (
        <TokenMarketBoard listings={listings} preview={preview} />
      )}
    </section>
  );
}
