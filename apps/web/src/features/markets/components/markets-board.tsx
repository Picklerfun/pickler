"use client";

import type { PerpMarketDto } from "@pickler/api-schema";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ButtonLink, Chip, Input } from "@pickler/ui";
import { accentVars } from "@/lib/accent";
import styles from "../markets.module.css";
import {
  formatChange,
  formatCompactAusd,
  formatFunding,
  formatPrice,
  pluralOrDash,
  sourceEyebrow,
  sourceFootnote,
} from "../lib/format";

const FILTERS = [
  { key: "all", label: "ALL MARKETS", match: () => true },
  { key: "agents", label: "WITH AGENTS", match: (m: PerpMarketDto) => (m.agentsReading ?? 0) > 0 },
  { key: "calls", label: "OPEN CALLS", match: (m: PerpMarketDto) => (m.openCalls ?? 0) > 0 },
] as const;

const SORTS = [
  {
    key: "agents",
    label: "AGENTS",
    // A count nobody has measured ranks as none, which leaves the order the API sent.
    by: (a: PerpMarketDto, b: PerpMarketDto) => (b.agentsReading ?? 0) - (a.agentsReading ?? 0),
  },
  {
    key: "oi",
    label: "OPEN INTEREST",
    by: (a: PerpMarketDto, b: PerpMarketDto) => b.openInterest - a.openInterest,
  },
  {
    key: "move",
    label: "24H MOVE",
    by: (a: PerpMarketDto, b: PerpMarketDto) => Math.abs(b.change24h) - Math.abs(a.change24h),
  },
] as const;

/**
 * Every market the venue lists. The row says who is already reading it before it says how big it
 * is, because the two things you can do here — ask an agent, or take the position yourself — are
 * only as good as the coverage behind them.
 */
export function MarketsBoard({
  markets,
  degraded = false,
}: {
  markets: PerpMarketDto[];
  degraded?: boolean;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("agents");
  const [query, setQuery] = useState("");

  // One venue answers for the whole board, so any market names the source of all of them.
  const source = markets[0]?.source;
  const active = FILTERS.find((option) => option.key === filter) ?? FILTERS[0];
  const order = SORTS.find((option) => option.key === sort) ?? SORTS[0];

  const shown = useMemo(() => {
    const needle = query.trim().toUpperCase();
    return markets
      .filter(active.match)
      .filter((market) => needle === "" || market.symbol.includes(needle))
      .sort(order.by);
  }, [markets, active, order, query]);

  return (
    <main className={styles.main}>
      <p className={styles.eyebrow} data-source={source?.venue}>
        {sourceEyebrow("MARKETS", source)}
      </p>
      <h1 className={styles.title}>EVERY MARKET.</h1>
      <p className={styles.lead}>
        Pick a level and a time. Ask an agent what it thinks, or take the position yourself. Both
        settle on the same mark price.
      </p>
      {degraded ? (
        <p className={styles.degradedNote} data-degraded="true" role="status">
          The board is catching up. Numbers will appear shortly.
        </p>
      ) : null}

      <div className={styles.filterCard}>
        <div className={styles.filterRow} role="group" aria-label="Coverage">
          {FILTERS.map((option) => (
            <Chip
              key={option.key}
              className={styles.filterChip}
              selected={option.key === filter}
              onClick={() => setFilter(option.key)}
            >
              {option.label}
              <span className={styles.filterCount}>{markets.filter(option.match).length}</span>
            </Chip>
          ))}
        </div>

        <div className={styles.filterRow}>
          <Input
            shape="pill"
            className={styles.search}
            type="search"
            placeholder="search a market…"
            aria-label="Search a market"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className={styles.sortLabel} id="markets-sort">
            SORT BY
          </span>
          <span className={styles.filterGroup} role="group" aria-labelledby="markets-sort">
            {SORTS.map((option) => (
              <Chip
                key={option.key}
                className={styles.filterChip}
                selected={option.key === sort}
                onClick={() => setSort(option.key)}
              >
                {option.label}
              </Chip>
            ))}
          </span>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className={styles.empty}>No market matches that. Clear the search or the filter.</p>
      ) : (
        <ul className={styles.marketGrid}>
          {shown.map((market) => (
            <MarketRow key={market.symbol} market={market} />
          ))}
        </ul>
      )}

      <p className={styles.footnote}>{sourceFootnote(source)}</p>
    </main>
  );
}

function MarketRow({ market }: { market: PerpMarketDto }) {
  const href = `/markets/${market.symbol}`;

  return (
    <li className={styles.marketCard} style={accentVars(market.accent)}>
      <div className={styles.marketHead}>
        <span className={styles.marketMark} aria-hidden="true">
          {market.base}
        </span>
        <span className={styles.marketName}>
          <span className={styles.marketPair}>
            <Link href={href} className={styles.marketLink}>
              {market.symbol}
            </Link>
            <span className={styles.marketLev}>MAX {market.maxLeverage}×</span>
          </span>
          <span className={styles.marketCoverage}>
            {pluralOrDash(market.agentsReading, "AGENT")} READING ·{" "}
            {pluralOrDash(market.openCalls, "OPEN CALL")}
          </span>
        </span>
        <span className={styles.marketPrice}>
          <span className={styles.marketPriceValue}>{formatPrice(market.mark)}</span>
          <span className={market.change24h < 0 ? styles.toneLoss : styles.toneWin}>
            {formatChange(market.change24h)} · 24H
          </span>
        </span>
      </div>

      <dl className={styles.marketStats}>
        <div>
          <dt>FUNDING 1H</dt>
          <dd>{formatFunding(market.funding1h)}</dd>
        </div>
        <div>
          <dt>OPEN INTEREST</dt>
          <dd>{formatCompactAusd(market.openInterest)}</dd>
        </div>
        <div>
          <dt>LAST CALL</dt>
          <dd>{market.lastCall ? `${market.lastCall.agent} · ${market.lastCall.when}` : "—"}</dd>
        </div>
      </dl>

      <div className={styles.marketFoot}>
        <p className={styles.marketNote}>{market.note}</p>
        <span className={styles.marketActions}>
          <ButtonLink
            as={Link}
            href={`${href}?side=ask`}
            size="sm"
            mono
            arrow
            className={styles.askAction}
          >
            ASK
          </ButtonLink>
          <ButtonLink
            as={Link}
            href={`${href}?side=trade`}
            size="sm"
            mono
            arrow
            className={styles.tradeAction}
          >
            TRADE
          </ButtonLink>
        </span>
      </div>
    </li>
  );
}
