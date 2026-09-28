import type { LaunchSummaryDto, ReadDto } from "@pickler/api-schema";
import Link from "next/link";
import { Chip } from "@pickler/ui";

import styles from "../agents.module.css";

/**
 * The launch catalogue, as the chain actually has it.
 *
 * Four states, kept apart on purpose, because collapsing them is how an interface ends up
 * implying something is true that nobody checked:
 *
 * - unavailable: the API has no launch surface. We could not ask.
 * - never indexed: we asked, and nothing has ever been read from a chain.
 * - empty: we asked, the indexer is current, and no launch exists yet.
 * - stale: there are rows, but the projection is behind, so what is shown may have moved.
 *
 * An empty board is the honest answer today: no Pickler contract is deployed. Showing sample
 * rows here would be indistinguishable from a working product to anyone looking at it.
 */
export function LaunchBoard({ read }: { read: ReadDto<LaunchSummaryDto[]> | null }) {
  if (read === null) {
    return (
      <Empty
        title="The launch catalogue is not connected"
        detail="This deployment of the API has no launch surface. Nothing is missing on chain; we simply cannot ask."
      />
    );
  }

  if (read.data.length === 0) {
    return read.asOfBlock === null ? (
      <Empty
        title="Nothing has been indexed yet"
        detail="No chain has been read. Until the launch contracts are deployed and the indexer is pointed at them, this catalogue stays empty."
      />
    ) : (
      <Empty
        title="No launches yet"
        detail={`The indexer is current as of block ${read.asOfBlock}. Nothing has launched.`}
      />
    );
  }

  return (
    <section className={styles.panel}>
      <header className={styles.label}>
        <span>LAUNCHES</span>
        <Freshness read={read} />
      </header>

      <ul>
        {read.data.map((launch) => (
          <li key={launch.id}>
            <Link href={`/tokens/${encodeURIComponent(launch.ticker.replace("$", ""))}`}>
              <strong>{launch.ticker}</strong>
              <span>{launch.name}</span>
            </Link>

            <Chip>{phaseLabel[launch.phase]}</Chip>

            {/* A launch with no agent linked is normal: the chain knows a key that nothing
                reverses into our identifier, and saying so beats implying an agent exists. */}
            {launch.agentId === null ? <Chip>UNLINKED AGENT</Chip> : null}

            <span title={`${launch.chainId} · ${launch.address}`}>
              {launch.chainId.startsWith("eip155:10143") ? "TESTNET" : "MAINNET"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const phaseLabel: Record<LaunchSummaryDto["phase"], string> = {
  reserved: "RESERVED",
  launching: "LAUNCHING",
  pre_graduation: "ON THE CURVE",
  graduated: "GRADUATED",
  failed: "FAILED",
};

/** A read that is behind says so here rather than being presented as current. */
function Freshness({ read }: { read: ReadDto<LaunchSummaryDto[]> }) {
  if (!read.stale) {
    return <span className={styles.toneMuted}>AS OF BLOCK {read.asOfBlock}</span>;
  }

  return (
    <span className={styles.toneLoss}>
      BEHIND — LAST READ {read.indexedAt ? new Date(read.indexedAt).toUTCString() : "never"}
    </span>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <section className={styles.panel}>
      <h2 className={styles.label}>{title}</h2>
      <p className={styles.toneMuted}>{detail}</p>
    </section>
  );
}
