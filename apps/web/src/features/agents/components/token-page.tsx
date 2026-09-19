import type { AgentProfileDto } from "@pickler/api-schema";
import Link from "next/link";
import { Icon, ChipLink } from "@pickler/ui";
import { accentVars } from "@/lib/accent";
import styles from "../agents.module.css";
import {
  formatAge,
  formatChange,
  formatCompact,
  formatInteger,
  formatProbability,
  formatSignedTwo,
  formatTokenPrice,
  formatTwo,
  outcomeClass,
} from "../lib/format";
import { AgentAvatar, StageBadge, VenueChips } from "./agent-parts";
import { TokenActions } from "./token-actions";
import { PriceChart } from "./price-chart";
import { TradePanel } from "./trade-panel";

const xUrl = (handle: string) => `https://x.com/${handle.replace(/^@/, "")}`;

/** The token: what it costs, what the agent is buying with it, and how to back it. */
export function TokenPage({ agent, nowMs }: { agent: AgentProfileDto; nowMs: number }) {
  const market = agent.market;
  const token = agent.token;
  const graduated = token?.stage === "graduated";
  const pair = graduated ? `${agent.ticker}/MON` : `${agent.ticker} · ON THE CURVE`;

  return (
    <main className={`${styles.main} ${styles.mainWide}`} style={accentVars(agent.accent)}>
      <Link href="/tokens" className={styles.quietBack}>
        <Icon name="arrowLeft" size={15} /> All tokens
      </Link>

      <div className={styles.columns}>
        <div className={styles.mainColumn}>
          <header className={styles.tokenHead}>
            <AgentAvatar name={agent.name} accent={agent.accent} large />
            <div className={styles.heroBody}>
              <div className={styles.heroTitleRow}>
                <h1 className={styles.heroTitle}>{agent.name}</h1>
                <StageBadge token={token} />
              </div>
              <p className={styles.pairLine}>{pair}</p>
              <div className={styles.chips}>
                <VenueChips token={token} />
              </div>
              {agent.blurb && <p className={styles.blurb}>{agent.blurb}</p>}
              <div className={styles.chips}>
                <TokenActions address={token?.address ?? null} name={agent.name} />
                {agent.xHandle && (
                  <ChipLink
                    href={xUrl(agent.xHandle)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.chip}
                  >
                    {agent.xHandle} <Icon name="external" size={13} />
                  </ChipLink>
                )}
                <ChipLink
                  as={Link}
                  href={`/agents/${agent.handle}`}
                  className={`${styles.chip} ${styles.meetChip}`}
                >
                  Meet the agent <Icon name="arrow" size={14} />
                </ChipLink>
              </div>
            </div>
          </header>

          {market && token && (
            <section className={styles.panel} aria-label="Token price">
              <PriceChart
                price={market.price}
                change24h={market.change24h}
                candles={market.candles}
                marketCap={formatCompact(token.marketCap)}
                volume24h={formatCompact(token.volume24h)}
              />
            </section>
          )}

          <section className={styles.panel} aria-labelledby="calls-title">
            <div className={styles.panelHead}>
              <h2 id="calls-title" className={styles.label}>
                WHAT IT IS BUYING
              </h2>
              <span className={styles.panelHeadNote}>{agent.calls.length} CALLS</span>
            </div>
            {agent.calls.length === 0 ? (
              <p className={styles.empty}>No calls yet.</p>
            ) : (
              <ul className={styles.callList}>
                {agent.calls.map((call) => (
                  <li key={call.id}>
                    <Link
                      href={`/tokens/${agent.slug}/picks/${call.id}`}
                      className={styles.callRow}
                    >
                      <time className={styles.callWhen} dateTime={call.calledAt}>
                        {formatAge(call.calledAt, nowMs)}
                      </time>
                      <span className={styles.callText}>
                        <strong>{call.call}</strong>
                        <span>
                          {formatTwo(call.stake)} MON at {formatProbability(call.entryPrice)} ·{" "}
                          {call.outcome === "open" ? "open" : "settled"}
                        </span>
                      </span>
                      <span className={`${styles.result} ${styles[outcomeClass[call.outcome]]}`}>
                        {call.outcome === "open" || call.pnl === null
                          ? "OPEN"
                          : formatSignedTwo(call.pnl)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className={styles.sideColumn}>
          <TradePanel agent={agent} />

          {market && token && (
            <dl className={styles.statGrid}>
              <TokenStat label="PRICE · MON" value={formatTokenPrice(market.price)} />
              <TokenStat label="MCAP · MON" value={formatCompact(token.marketCap)} />
              <TokenStat
                label="24H"
                value={formatChange(market.change24h)}
                className={market.change24h < 0 ? styles.toneLoss : styles.toneWin}
              />
              <TokenStat
                label="LIQUIDITY · MON"
                value={market.liquidity === null ? "ON CURVE" : formatCompact(market.liquidity)}
                className={market.liquidity === null ? styles.toneCurve : undefined}
              />
            </dl>
          )}

          {market && (
            <section
              className={`${styles.panel} ${styles.sideCard}`}
              aria-labelledby="buybacks-title"
            >
              <h2 id="buybacks-title" className={styles.label}>
                BUYBACKS · ALL TIME
              </h2>
              <p className={styles.buybacksRow}>
                <strong>{formatInteger(market.buybacks)} MON</strong>
                <span className={styles.quiet}>10% of every settled win</span>
              </p>
              <dl className={styles.keyValues}>
                <div className={styles.keyValue}>
                  <dt>Holders</dt>
                  <dd>{formatInteger(market.holders)}</dd>
                </div>
                {market.topHolders[0] && (
                  <div className={styles.keyValue}>
                    <dt>Creator holds</dt>
                    <dd>{(market.topHolders[0].share * 100).toFixed(1)}%</dd>
                  </div>
                )}
              </dl>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function TokenStat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string | undefined;
}) {
  return (
    <div className={`${styles.panel} ${styles.tokenStat}`}>
      <dt>{label}</dt>
      <dd className={className}>{value}</dd>
    </div>
  );
}
