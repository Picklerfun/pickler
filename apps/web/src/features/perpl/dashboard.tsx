"use client";

import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import type { PerplDashboardMarketsDto, PerplPortfolioDto } from "@pickler/api-schema";
import { BrandMark, Button, Icon, Skeleton, Tag, type IconName } from "@pickler/ui";
import { ChainReference } from "@/features/tokens/chain-reference";
import { usePerplDashboard } from "./use-dashboard";
import { MarketAsset, marketIdentity } from "./market-asset";
import { MarketTicker } from "./market-ticker";
import { OpenPositions } from "./positions";
import { clock, marketHref, money, number, percent, signedMoney, tone } from "./display";
import styles from "./dashboard.module.css";

export function PerplDashboard({ observedWallet = null }: { observedWallet?: string | null }) {
  const view = usePerplDashboard(observedWallet);
  const { wallet, portfolio } = view;
  return (
    <PerplDashboardSurface
      snapshot={view}
      walletAddress={view.address || null}
      observed={Boolean(observedWallet)}
    >
      {observedWallet ? (
        <p className={styles.footnote}>Viewing the public portfolio of the wallet in this link.</p>
      ) : null}
      {!view.address ? (
        <div className={styles.connect}>
          <Icon name="wallet" size={26} />
          <h2>Your portfolio, at a glance.</h2>
          <p>Connect your Perpl testnet wallet. Your public positions load automatically.</p>
          <Button onClick={() => wallet.connect("View your Perpl portfolio")} size="md">
            Connect wallet
          </Button>
          <small>Read-only. No signature needed to load positions.</small>
        </div>
      ) : !portfolio && !view.error ? (
        <div className={styles.loading} role="status" aria-label="Loading Perpl account">
          <Skeleton />
          <Skeleton />
        </div>
      ) : null}
    </PerplDashboardSurface>
  );
}

type DashboardSnapshot = Pick<
  ReturnType<typeof usePerplDashboard>,
  "market" | "marketError" | "portfolio" | "error" | "now"
>;

export function PerplDashboardSurface({
  snapshot: view,
  walletAddress,
  preview = false,
  observed = false,
  children,
}: {
  snapshot: DashboardSnapshot;
  walletAddress: string | null;
  preview?: boolean;
  observed?: boolean;
  children?: ReactNode;
}) {
  const { market, portfolio } = view;
  const marketStale = Boolean(view.marketError || market?.stale);
  const portfolioStale = Boolean(
    view.error ||
    portfolio?.stale ||
    (portfolio && view.now - Date.parse(portfolio.observedAt) > 20_000),
  );
  return (
    <>
      <MarketTicker market={market} stale={marketStale} preview={preview} />
      <main className={styles.main}>
        <header className={styles.heading}>
          <div>
            <h1 id="perpl-wallet-title">
              {observed
                ? "Perpl wallet portfolio"
                : walletAddress
                  ? "Your Perpl portfolio"
                  : "Perpl overview"}
              <span className={styles.titleDot}>.</span>
            </h1>
            <p>Your positions. Your exposure. One clear view.</p>
          </div>
          <div className={styles.headingAside}>
            <div className={styles.headingTags}>
              <Tag className={styles.network}>
                <Image src="/brand/monad.png" alt="" width={16} height={16} unoptimized />
                Monad testnet
              </Tag>
              <Tag>
                <Icon name="shield" size={13} /> Read-only
              </Tag>
            </div>
            {preview ? <span className={styles.previewNote}>Preview · demo data</span> : null}
            {observed && walletAddress ? (
              <ChainReference
                value={walletAddress}
                kind="address"
                label="Observed wallet address"
                chainId={10143}
              />
            ) : null}
          </div>
        </header>
        <section className={styles.walletSection} aria-labelledby="perpl-wallet-title">
          {portfolio ? (
            <Portfolio data={portfolio} preview={preview} stale={portfolioStale} />
          ) : null}
          {view.error ? (
            <p className={styles.notice} role="alert">
              {view.error}
            </p>
          ) : null}
          {children}
        </section>
        <details className={styles.marketDetails} id="perpl-market-details">
          <summary>
            <span>
              <h2 id="perpl-protocol-title">Perpl markets</h2>
              <span className={styles.status} data-stale={marketStale}>
                <span className={styles.statusDot} aria-hidden="true" />
                {preview ? "Example markets" : marketStale ? "Last snapshot" : "Auto-updates"}
                {market ? ` · ${clock(market.observedAt)} UTC` : ""}
              </span>
            </span>
            <span className={styles.marketDisclosure}>
              Market details <Icon name="chevronDown" size={16} />
            </span>
          </summary>
          {view.marketError ? (
            <p className={styles.notice} role="status">
              {view.marketError}
            </p>
          ) : null}
          {market ? (
            <Protocol market={market} />
          ) : view.marketError ? null : (
            <div className={styles.loading}>
              <Skeleton />
              <Skeleton />
            </div>
          )}
        </details>
        {preview ? (
          <p className={styles.footnote}>Example data only. No wallet or Perpl requests.</p>
        ) : null}
      </main>
    </>
  );
}

function Protocol({ market }: { market: PerplDashboardMarketsDto }) {
  return (
    <>
      <div className={styles.protocolSummary}>
        <div className={styles.openInterest}>
          <span>
            <Icon name="activity" size={15} />
            Protocol open interest
          </span>
          <strong>
            {money(market.totalOpenInterestAusd)} <span>AUSD</span>
          </strong>
        </div>
        <span className={styles.marketCount}>
          <Icon name="grid" size={15} />
          {market.markets.length} open markets
        </span>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.marketTable}>
          <thead>
            <tr>
              <th>Market</th>
              <th>Mark · AUSD</th>
              <th>24h change</th>
              <th>Funding</th>
              <th>Open interest · AUSD</th>
              <th>Max leverage</th>
            </tr>
          </thead>
          <tbody>
            {market.markets.map((item) => (
              <tr key={item.id}>
                <th scope="row">
                  <Link
                    href={marketHref(item.symbol)}
                    aria-label={marketIdentity(item.symbol).ticker}
                    className={styles.marketIdentity}
                  >
                    <MarketAsset symbol={item.symbol} />
                    <span className={styles.assetName}>
                      <strong>{marketIdentity(item.symbol).ticker}</strong>
                      <small>{marketIdentity(item.symbol).asset?.name ?? "Perpetual"}</small>
                    </span>
                    <Icon name="arrow" size={14} className={styles.marketArrow} />
                  </Link>
                </th>
                <td data-label="Mark · AUSD">
                  {number(item.price, Math.abs(Number(item.price)) < 1 ? 8 : 2)}
                </td>
                <td data-label="24h change" data-tone={tone(item.change24hBps)}>
                  <Tag className={styles.movement} data-tone={tone(item.change24hBps)}>
                    {item.change24hBps !== null && Number(item.change24hBps) !== 0 ? (
                      <Icon
                        name={Number(item.change24hBps) < 0 ? "arrowDown" : "arrowUp"}
                        size={12}
                      />
                    ) : null}
                    {percent(item.change24hBps, true)}
                  </Tag>
                </td>
                <td data-label="Funding">
                  <span data-tone={tone(item.fundingBps)}>{percent(item.fundingBps, true, 4)}</span>
                  <small>
                    {item.fundingIntervalSec
                      ? `per ${number(String(item.fundingIntervalSec / 3600))}h`
                      : "interval unknown"}
                  </small>
                </td>
                <td data-label="Open interest · AUSD">{money(item.openInterestAusd)}</td>
                <td data-label="Max leverage">{item.maxLeverage}×</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Portfolio({
  data,
  stale,
  preview,
}: {
  data: PerplPortfolioDto;
  stale: boolean;
  preview: boolean;
}) {
  const figures = [
    { label: "Available", value: data.availableAusd, icon: "wallet" },
    { label: "Open P&L · price", value: data.pricePnlAusd, icon: "chart", color: true },
    { label: "Position collateral", value: data.collateralAusd, icon: "shield" },
  ] satisfies { label: string; value: string | null; icon: IconName; color?: boolean }[];
  const exposures = [
    { label: "Gross exposure", value: data.grossExposureAusd },
    { label: "Net exposure", value: data.netExposureAusd },
    { label: "Locked in orders", value: data.lockedOrdersAusd },
  ];
  return (
    <div id="perpl-portfolio" className={styles.portfolio} data-stale={stale}>
      <div id="perpl-equity" className={styles.balance} data-surface="dark">
        <div className={styles.balanceStatus} role="status">
          <span className={styles.statusDot} data-stale={stale} aria-hidden="true" />
          {preview ? "Example portfolio" : stale ? "Last snapshot" : "Auto-updates"}
          {data.frozen ? <Tag data-tone="loss">Account frozen</Tag> : null}
        </div>
        <div className={styles.balanceGrid}>
          <dl className={styles.equity}>
            <dt>
              <BrandMark name="ausd" size={20} /> Portfolio value · estimate
            </dt>
            <dd>
              {money(data.equityEstimateAusd)} <span>AUSD</span>
            </dd>
          </dl>
          <dl className={styles.figures}>
            {figures.map((item) => (
              <div key={item.label}>
                <dt>
                  <Icon name={item.icon} size={16} /> {item.label}
                </dt>
                <dd data-tone={item.color ? tone(item.value) : undefined}>
                  {item.color ? signedMoney(item.value) : money(item.value)} <span>AUSD</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <OpenPositions
        key={data.wallet}
        positions={data.positions}
        accountCount={data.accountCount}
      />
      <details className={styles.explanation} id="perpl-estimates">
        <summary>
          <Icon name="help" size={15} /> About these estimates <Icon name="chevronDown" size={14} />
        </summary>
        <p>
          Price buffer estimates the move from the current mark that would exhaust remaining
          collateral through price loss alone. Perpl can liquidate earlier because of maintenance
          margin, funding and fees. It is not Perpl&rsquo;s liquidation price. The buffer bar spans
          0–20%.
        </p>
        <p>
          Portfolio value and open price P&L exclude accrued funding and closing fees. An
          unavailable price or estimate stays unknown.
        </p>
        <dl className={styles.exposure}>
          {exposures.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>
                {money(item.value)} <span>AUSD</span>
              </dd>
            </div>
          ))}
        </dl>
        <div className={styles.accountMeta}>
          <ChainReference
            value={data.wallet}
            kind="address"
            label="Wallet address"
            chainId={10143}
            preview={preview}
          />
          <span>
            {data.accountCount} exchange {data.accountCount === 1 ? "account" : "accounts"}
          </span>
          <span>
            {clock(data.observedAt)} UTC · Block {data.block.toLocaleString("en-US")}
          </span>
        </div>
      </details>
      <p className={styles.footnote}>
        Price buffer is an estimate, not a liquidation price. P&L excludes funding and closing fees.
      </p>
    </div>
  );
}
