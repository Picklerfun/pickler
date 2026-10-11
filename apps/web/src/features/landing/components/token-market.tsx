import Link from "next/link";
import { Icon } from "@pickler/ui";
import type { DirectoryAgentDto } from "@pickler/api-schema";
import { AgentAvatar } from "@/features/studio/shell/agent-avatar";
import landing from "../landing.module.css";
import styles from "./token-market.module.css";

/** The directory exposes only canonical tokens of public agents; rendering never queries RPC. */
export function TokenMarket({
  directory,
}: {
  directory: { data: DirectoryAgentDto[]; degraded: boolean };
}) {
  const launches = directory.data.filter((entry) => entry.launchedToken).slice(0, 8);
  return (
    <section
      id="tokens"
      className={`${landing.shell} ${landing.section}`}
      aria-labelledby="tokens-title"
    >
      <div className={styles.heading}>
        <div>
          <h2 id="tokens-title" className={landing.title}>
            Agent tokens
          </h2>
          <p className={styles.note}>Buy and sell with your wallet. AUSD on Monad testnet.</p>
        </div>
        <Link href="/agents" className={styles.browse}>
          Explore agents <Icon name="arrow" size={16} />
        </Link>
      </div>
      {directory.degraded ? (
        <p role="status" className={styles.empty}>
          Token listings are temporarily unavailable. Reload to try again.
        </p>
      ) : launches.length === 0 ? (
        <p className={styles.empty}>No confirmed agent tokens yet.</p>
      ) : (
        <ul className={styles.grid}>
          {launches.map(
            ({ agent, launchedToken: token }) =>
              token && (
                <li key={agent.id}>
                  <Link
                    href={`/agents/${encodeURIComponent(agent.handle)}`}
                    className={styles.card}
                  >
                    <div className={styles.identity}>
                      <AgentAvatar
                        accent={token.avatar.accent}
                        pattern={token.avatar.pattern}
                        size="chip"
                      />
                      <div className={styles.name}>
                        <strong>{token.name}</strong>
                        <span>
                          {token.ticker} · @{agent.handle}
                        </span>
                      </div>
                    </div>
                    <div className={styles.action}>
                      <span>{token.chainId === 10143 ? "MONAD TESTNET" : "MONAD"}</span>
                      <span>
                        View token <Icon name="arrow" size={14} />
                      </span>
                    </div>
                  </Link>
                </li>
              ),
          )}
        </ul>
      )}
    </section>
  );
}
