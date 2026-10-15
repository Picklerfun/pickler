"use client";
import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import type { PerplDashboardMarketsDto, PerplPortfolioDto } from "@pickler/api-schema";
import { BrandMark, Button, Icon, Meter, Skeleton, Tag, type IconName } from "@pickler/ui";
import { ChainReference } from "@/features/tokens/chain-reference";
import { usePerplDashboard } from "./use-dashboard";
import { MarketAsset, marketIdentity } from "./market-asset";
import styles from "./dashboard.module.css";
function number(value: string | null, digits = 2) {
  if (value === null) {
    return "—";
  }
  const n = Number(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n)
    : "—";
}
function money(value: string | null) {
  if (value === null || !Number.isFinite(Number(value))) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}
function signedMoney(value: string | null) {
  return `${value !== null && Number(value) > 0 ? "+" : ""}${money(value)}`;
}
function tone(value: string | null) {
  return value === null || Number(value) === 0 ? "neutral" : Number(value) < 0 ? "loss" : "good";
}
function percent(bps: string | null, signed = false, digits = 2) {
  if (bps === null) {
    return "—";
  }
  const value = Number(bps) / 100;
  if (value !== 0 && Math.abs(value) < 10 ** -digits) {
    return `${value < 0 ? "−" : signed ? "+" : ""}<${10 ** -digits}%`;
  }
  return `${signed && value > 0 ? "+" : ""}${number(String(value), digits)}%`;
}
function clock(at: string) {
  return new Date(at).toLocaleTimeString("en-GB", { timeZone: "UTC" });
}
export function PerplDashboard({ observedWallet = null }: { observedWallet?: string | null }) {
  const view = usePerplDashboard(observedWallet);
  const { wallet, portfolio } = view;
  return (
    <PerplDashboardSurface snapshot={view} walletAddress={view.address || null}>
      {observedWallet ? (
        <p className={styles.footnote}>Viewing the public portfolio of the wallet in this link.</p>
      ) : null}
      {!view.address ? (
        <div className={styles.connect}>
          <Icon name="wallet" size={26} />
          <h3>See your positions alongside the market.</h3>
          <p>Connect your Perpl testnet wallet to load its public positions automatically.</p>
          <Button onClick={() => wallet.connect("View your Perpl portfolio")} size="md">
            Connect wallet
          </Button>
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
  children,
}: {
  snapshot: DashboardSnapshot;
  walletAddress: string | null;
  preview?: boolean;
  children?: ReactNode;
}) {
  const { market, portfolio } = view;
  let freshness = preview ? "Sample snapshot" : "Updating";
  if (view.marketError || market?.stale) {
    freshness = "Last snapshot";
  }
  return (
    <main className={styles.main}>
      <header className={styles.heading}>
        <div>
          <h1>Perpl overview.</h1>
          <p>Explore Perpl markets. Connect your wallet to see your portfolio.</p>
        </div>
        <div className={styles.headingTags}>
          {preview ? <Tag data-tone="caution">Preview · demo data</Tag> : null}
          <Tag className={styles.network}>
            <Image src="/brand/monad.png" alt="" width={16} height={16} unoptimized />
            Monad testnet
          </Tag>
        </div>
      </header>
      <section className={styles.section} aria-labelledby="perpl-protocol-title">
        <div className={styles.sectionHead}>
          <div className={styles.sectionIdentity}>
            <span className={styles.sectionIcon}>
              <Icon name="chart" size={22} />
            </span>
            <div>
              <h2 id="perpl-protocol-title">The market</h2>
              <p>Perpetual markets · AUSD</p>
            </div>
          </div>
          <span
            className={styles.status}
            data-stale={Boolean(view.marketError || market?.stale)}
            role="status"
          >
            <span className={styles.statusDot} aria-hidden="true" />
            {market ? `${freshness} · ${clock(market.observedAt)} UTC` : "Connecting to Perpl…"}
          </span>
        </div>
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
            <Skeleton />
          </div>
        )}
      </section>
      <section className={styles.section} aria-labelledby="perpl-wallet-title">
        <div className={styles.sectionHead}>
          <div className={styles.sectionIdentity}>
            <span className={styles.sectionIcon}>
              <Icon name="wallet" size={22} />
            </span>
            <div>
              <h2 id="perpl-wallet-title">{preview ? "Example portfolio" : "Your portfolio"}</h2>
              <p>
                {preview ? "Illustrative Perpl account" : "Real positions in your Perpl account"}
              </p>
            </div>
          </div>
          {walletAddress ? (
            <ChainReference
              value={walletAddress}
              kind="address"
              label="Wallet address"
              chainId={10143}
              preview={preview}
            />
          ) : null}
        </div>
        {portfolio ? (
          <Portfolio
            data={portfolio}
            preview={preview}
            stale={Boolean(
              view.error || portfolio.stale || view.now - Date.parse(portfolio.observedAt) > 20_000,
            )}
          />
        ) : null}
        {view.error ? (
          <p className={styles.notice} role="alert">
            {view.error}
          </p>
        ) : null}
        {children}
        <p className={styles.footnote}>
          {preview
            ? "Sample data only. No wallet authorization or Perpl requests."
            : "Public on-chain positions update every 5 seconds while visible. Estimates exclude accrued funding and closing fees. No signature needed."}
        </p>
      </section>
    </main>
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
                    href={`/markets/${item.symbol.includes("-PERP") ? item.symbol : `${item.symbol}-PERP`}`}
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
    { label: "Price P&L · open", value: data.pricePnlAusd, icon: "chart", color: true },
    ...(data.source === "onchain"
      ? []
      : [
          {
            label: "Realized P&L · all time",
            value: data.realizedPnlAusd,
            icon: "check" as const,
            color: true,
          },
        ]),
  ] satisfies { label: string; value: string | null; icon: IconName; color?: boolean }[];
  const exposures = [
    { label: "Gross exposure", value: data.grossExposureAusd, icon: "target" },
    { label: "Net exposure", value: data.netExposureAusd, icon: "bars" },
    { label: "Position collateral", value: data.collateralAusd, icon: "shield" },
    { label: "Locked in orders", value: data.lockedOrdersAusd, icon: "lock" },
  ] satisfies { label: string; value: string | null; icon: IconName }[];
  return (
    <div id="perpl-portfolio" className={styles.portfolio} data-stale={stale}>
      <div className={styles.portfolioMeta}>
        <Tag data-tone={stale ? "caution" : "good"}>
          {preview
            ? "Sample snapshot"
            : stale
              ? "Last snapshot"
              : data.source === "onchain"
                ? "On-chain snapshot"
                : "Live snapshots"}
        </Tag>
        <span className={styles.updatedAt}>
          <Icon name="clock" size={13} />
          {clock(data.observedAt)} UTC · Block {data.block.toLocaleString("en-US")}
        </span>
        {data.frozen ? <Tag data-tone="loss">Account frozen</Tag> : null}
      </div>
      <div className={styles.balanceGrid}>
        <div id="perpl-equity" className={styles.equity} data-surface="dark">
          <dl>
            <dt>
              <BrandMark name="ausd" size={20} />
              Equity estimate
            </dt>
            <dd>
              {money(data.equityEstimateAusd)} <span>AUSD</span>
            </dd>
          </dl>
          <p className={styles.equityNote}>
            <Icon name="shield" size={13} />
            Read-only portfolio
          </p>
        </div>
        <dl className={styles.figures} data-onchain={data.source === "onchain"}>
          {figures.map((item) => (
            <div key={item.label}>
              <dt>
                <Icon name={item.icon} size={16} />
                {item.label}
              </dt>
              <dd data-tone={item.color ? tone(item.value) : undefined}>
                {item.color ? signedMoney(item.value) : money(item.value)}
              </dd>
              <span className={styles.metricUnit}>AUSD</span>
            </div>
          ))}
        </dl>
      </div>
      <dl className={styles.exposure}>
        {exposures.map((item) => (
          <div key={item.label}>
            <dt>
              <Icon name={item.icon} size={15} />
              {item.label}
            </dt>
            <dd>
              {money(item.value)} <span>AUSD</span>
            </dd>
          </div>
        ))}
      </dl>
      <div className={styles.positionsHead}>
        <h3>
          Open positions <span>{data.positions.length}</span>
        </h3>
        <span>
          {data.accountCount} exchange {data.accountCount === 1 ? "account" : "accounts"}
        </span>
      </div>
      {data.positions.length === 0 ? (
        <p className={styles.empty}>
          {data.accountCount
            ? "No open positions on this wallet."
            : "This wallet has no exchange account yet."}
        </p>
      ) : (
        <div className={styles.positionGrid}>
          {data.positions.map((position) => (
            <Position key={position.id} position={position} />
          ))}
        </div>
      )}
      {data.positions.length > 0 ? (
        <details className={styles.explanation}>
          <summary>
            <Icon name="help" size={15} />
            What does the price buffer mean?
            <Icon name="chevronDown" size={14} />
          </summary>
          <p>
            The distance from the current mark to the price where the remaining collateral would be
            exhausted by price loss alone. Perpl can liquidate earlier because of maintenance
            margin, funding and fees. This is an estimate, not Perpl&rsquo;s liquidation price.
          </p>
        </details>
      ) : null}
    </div>
  );
}
function Position({ position: p }: { position: PerplPortfolioDto["positions"][number] }) {
  const buffer = p.priceBufferBps === null ? null : Number(p.priceBufferBps);
  const risk =
    buffer === null ? "neutral" : buffer <= 0 ? "loss" : buffer < 500 ? "caution" : "good";
  return (
    <article className={styles.position}>
      <div className={styles.positionHead}>
        <div className={styles.positionIdentity}>
          <MarketAsset symbol={p.symbol} />
          <div>
            <h4>{marketIdentity(p.symbol).ticker}</h4>
            <Tag className={styles.positionSide} data-tone={p.side === "long" ? "good" : "loss"}>
              <Icon name={p.side === "long" ? "arrowUp" : "arrowDown"} size={11} />
              {p.side === "long" ? "Long" : "Short"}
              {p.leverage === null ? "" : ` · ${p.leverage}×`}
            </Tag>
          </div>
        </div>
        <div className={styles.positionPnl}>
          <span>Open P&L</span>
          <strong data-tone={tone(p.pricePnlAusd)}>
            {signedMoney(p.pricePnlAusd)} <small>AUSD</small>
          </strong>
        </div>
      </div>
      <dl className={styles.positionFigures}>
        <div>
          <dt>Size</dt>
          <dd>{number(p.quantity, 6)}</dd>
        </div>
        <div>
          <dt>Entry</dt>
          <dd>{number(p.entryPrice, 8)}</dd>
        </div>
        <div>
          <dt>Mark</dt>
          <dd>{number(p.markPrice, 8)}</dd>
        </div>
        <div>
          <dt>Collateral · AUSD</dt>
          <dd>{money(p.collateralAusd)}</dd>
        </div>
      </dl>
      <div className={styles.risk} data-tone={risk}>
        <span className={styles.riskLabel}>
          <Icon name="shield" size={14} />
          Price buffer estimate
        </span>
        <strong>{percent(p.priceBufferBps)}</strong>
        {buffer !== null ? (
          <Meter
            value={Math.max(0, Math.min(100, buffer / 20))}
            tone={
              risk === "good"
                ? "lime"
                : risk === "caution"
                  ? "amber"
                  : risk === "loss"
                    ? "magenta"
                    : "cyan"
            }
            label="Estimated price buffer, full scale 20 percent"
          />
        ) : (
          <span className={styles.riskUnknown}>Price unavailable</span>
        )}
        <small>Collateral exhaustion at {number(p.collateralExhaustionPrice, 8)} AUSD</small>
      </div>
    </article>
  );
}
