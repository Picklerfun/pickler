"use client";
import Link from "next/link";
import type { PerplDashboardMarketsDto, PerplPortfolioDto } from "@pickler/api-schema";
import { Button, Icon, Meter, Skeleton, Tag } from "@pickler/ui";
import { ChainReference } from "@/features/tokens/chain-reference";
import { usePerplDashboard } from "./use-dashboard";
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
function money(value: string | null, digits = 2) {
  return value === null ? "—" : number(value, digits);
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
export function PerplDashboard() {
  const view = usePerplDashboard();
  const { wallet, market, portfolio } = view;
  const busy = view.stage !== "idle";
  const labels = {
    idle: "Authorize read-only access",
    preparing: "Preparing read access…",
    signing: "Confirm read access in wallet",
    authorizing: "Connecting to Perpl…",
  };
  return (
    <main className={styles.main}>
      <header className={styles.heading}>
        <div>
          <h1>Perpl overview.</h1>
          <p>Markets, your positions and the price risk you carry.</p>
        </div>
        <Tag data-tone="caution">Monad testnet</Tag>
      </header>
      <section className={styles.section} aria-labelledby="perpl-protocol-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 id="perpl-protocol-title">The market</h2>
            <p>Perpl exchange data · AUSD</p>
          </div>
          <span
            className={styles.status}
            data-stale={Boolean(view.marketError || market?.stale)}
            role="status"
          >
            {market
              ? `${view.marketError || market.stale ? "Last snapshot" : "Updating"} · ${clock(market.observedAt)} UTC`
              : "Connecting to Perpl…"}
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
          <div>
            <h2 id="perpl-wallet-title">Your portfolio</h2>
            <p>Real positions in your Perpl account</p>
          </div>
          {wallet.address ? (
            <ChainReference
              value={wallet.address}
              kind="address"
              label="Wallet address"
              chainId={10143}
            />
          ) : null}
        </div>
        {portfolio ? (
          <Portfolio
            data={portfolio}
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
        {!wallet.address ? (
          <div className={styles.connect}>
            <Icon name="wallet" size={26} />
            <h3>See your positions alongside the market.</h3>
            <p>Connect the wallet you use on Perpl.</p>
            <Button onClick={() => wallet.connect("View your Perpl portfolio")} size="md">
              Connect wallet
            </Button>
          </div>
        ) : !wallet.onTargetChain ? (
          <div className={styles.connect}>
            <p>Switch networks to authorize testnet read access.</p>
            <Button
              onClick={() => {
                void wallet.switchChain();
              }}
              disabled={wallet.switching}
            >
              {wallet.switching ? "Confirm network in wallet" : "Switch to Monad testnet"}
            </Button>
            {wallet.switchFailure ? <p role="alert">{wallet.switchFailure.hint}</p> : null}
          </div>
        ) : !view.authorized ? (
          <div className={styles.authorization}>
            <div>
              <h3>Allow account reads.</h3>
              <p>Allow reads for one hour. No permission to place orders or move funds.</p>
            </div>
            <Button
              aria-busy={busy}
              disabled={busy}
              onClick={() => {
                void view.authorize();
              }}
              className={styles.authorize}
            >
              {busy ? (
                <span className={styles.spinner} aria-hidden="true" />
              ) : (
                <Icon name="wallet" size={18} />
              )}
              {labels[view.stage]}
            </Button>
          </div>
        ) : !portfolio && !view.error ? (
          <div className={styles.loading} role="status" aria-label="Loading Perpl account">
            <Skeleton />
            <Skeleton />
          </div>
        ) : null}
        <p className={styles.footnote}>
          Updates every 5 seconds while visible. Estimates exclude accrued funding and closing fees.
          Refreshing requires read authorization again.
        </p>
      </section>
    </main>
  );
}
function Protocol({ market }: { market: PerplDashboardMarketsDto }) {
  return (
    <>
      <div className={styles.protocolSummary}>
        <strong>
          {money(market.totalOpenInterestAusd)} <span>AUSD</span>
        </strong>
        <span>Protocol open interest</span>
        <span>{market.markets.length} open markets</span>
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
                  >
                    {item.symbol.replace(/-PERP$/, "")}
                    <Icon name="arrow" size={14} />
                  </Link>
                </th>
                <td data-label="Mark · AUSD">
                  {number(item.price, Math.abs(Number(item.price)) < 1 ? 8 : 2)}
                </td>
                <td data-label="24h change" data-tone={tone(item.change24hBps)}>
                  {percent(item.change24hBps, true)}
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
function Portfolio({ data, stale }: { data: PerplPortfolioDto; stale: boolean }) {
  const figures = [
    { label: "Equity estimate", value: data.equityEstimateAusd },
    { label: "Available", value: data.availableAusd },
    { label: "Price P&L · open", value: data.pricePnlAusd, color: true },
    { label: "Realized P&L · all time", value: data.realizedPnlAusd, color: true },
  ];
  return (
    <div className={styles.portfolio} data-stale={stale}>
      <div className={styles.portfolioMeta}>
        <Tag data-tone={stale ? "caution" : "good"}>
          {stale ? "Last snapshot" : "Live snapshots"}
        </Tag>
        <span>
          {clock(data.observedAt)} UTC · Block {data.block.toLocaleString("en-US")}
        </span>
        {data.frozen ? <Tag data-tone="loss">Account frozen</Tag> : null}
      </div>
      <dl className={styles.figures}>
        {figures.map((item) => (
          <div key={item.label}>
            <dt>{item.label} · AUSD</dt>
            <dd data-tone={item.color ? tone(item.value) : undefined}>{money(item.value)}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.exposure}>
        <div>
          <span>Gross exposure</span>
          <strong>{money(data.grossExposureAusd)} AUSD</strong>
        </div>
        <div>
          <span>Net exposure</span>
          <strong>{money(data.netExposureAusd)} AUSD</strong>
        </div>
        <div>
          <span>Position collateral</span>
          <strong>{money(data.collateralAusd)} AUSD</strong>
        </div>
        <div>
          <span>Locked in orders</span>
          <strong>{money(data.lockedOrdersAusd)} AUSD</strong>
        </div>
      </div>
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
          <summary>What does the price buffer mean?</summary>
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
        <div>
          <h4>{p.symbol.replace(/-PERP$/, "")}</h4>
          <Tag data-tone={p.side === "long" ? "good" : "loss"}>
            {p.side} · {p.leverage}×
          </Tag>
        </div>
        <strong data-tone={tone(p.pricePnlAusd)}>
          {money(p.pricePnlAusd)} <span>AUSD</span>
        </strong>
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
        <span>Price buffer estimate</span>
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
