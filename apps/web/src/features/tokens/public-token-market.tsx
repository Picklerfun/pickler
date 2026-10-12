"use client";

import { useEffect, useState } from "react";
import type { AgentTokenDto } from "@pickler/api-schema";
import { freshnessReadSchema, launchDetailSchema } from "@pickler/api-schema";
import { formatUnits } from "viem";
import { AreaChart, Button, Icon, Meter, Segmented, Skeleton, Tag } from "@pickler/ui";
import { AgentTokenIdentity } from "./agent-token-card";
import { ChainReference } from "./chain-reference";
import { PublicTokenTrade } from "./public-token-trade";
import styles from "./public-token-market.module.css";

const marketRead = freshnessReadSchema(launchDetailSchema);
const ranges = { "1H": 3_600_000, "24H": 86_400_000, "7D": 604_800_000 };
type Range = keyof typeof ranges;
type State = {
  status: "loading" | "ready" | "error";
  read: ReturnType<typeof marketRead.parse> | null;
};

function amount(value: string | null | undefined, decimals: number, precision = 6) {
  if (value === null || value === undefined) {
    return "—";
  }
  const [whole, fraction = ""] = formatUnits(BigInt(value), decimals).split(".");
  const tail = fraction.slice(0, precision).replace(/0+$/, "");
  return BigInt(whole!).toLocaleString("en-US") + (tail ? `.${tail}` : "");
}

/** The production market surface reads the existing catalogue; trading stays explicit. */
export function PublicTokenMarket({
  token,
  handle,
  preview = false,
}: {
  token: AgentTokenDto;
  handle: string;
  preview?: boolean;
}) {
  const [state, setState] = useState<State>({ status: preview ? "ready" : "loading", read: null });
  const [range, setRange] = useState<Range>("24H");
  const [explained, setExplained] = useState(false);
  const [request, setRequest] = useState(0);

  useEffect(() => {
    if (preview) {
      return;
    }
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    async function load() {
      try {
        const id = `eip155:${token.chainId}:${token.address.toLowerCase()}`;
        const response = await fetch(`/api/v1/launches/${encodeURIComponent(id)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 404) {
          if (active) {
            setState({ status: "ready", read: null });
          }
          return;
        }
        if (!response.ok) {
          throw new Error("Market read unavailable");
        }
        const read = marketRead.parse(await response.json());
        if (
          read.data.address.toLowerCase() !== token.address.toLowerCase() ||
          read.data.chainId !== `eip155:${token.chainId}` ||
          !["pre_graduation", "graduated"].includes(read.data.phase)
        ) {
          throw new Error("Market identity mismatch");
        }
        if (active) {
          setState({ status: "ready", read });
        }
      } catch {
        if (active) {
          setState((previous) => ({ ...previous, status: "error" }));
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void load();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [token.address, token.chainId, request, preview]);

  const market = state.read?.data.market;
  const terms = market?.terms;
  const graduated = state.read?.data.phase === "graduated";
  const quote = state.read?.data.quote;
  const symbol = quote?.symbol ?? "Quote asset";
  const quoteDecimals = quote?.decimals ?? 6;
  const tokenDecimals = market?.tokenDecimals ?? 18;
  const end = market ? Date.parse(market.windowEnd) : 0;
  const history =
    market?.history.filter((point) => Date.parse(point.at) >= end - ranges[range]) ?? [];
  // Number conversion is solely for chart coordinates; all financial values arrive prepared.
  const bySecond = new Map<number, number>();
  for (const point of history) {
    const at = Math.floor(Date.parse(point.at) / 1000) * 1000;
    const value = Number(formatUnits(BigInt(point.priceWad), 18));
    if (Number.isFinite(at) && Number.isFinite(value) && value > 0) {
      bySecond.set(at, value);
    }
  }
  const points = [...bySecond].map(([at, value]) => ({ at, value })).sort((a, b) => a.at - b.at);
  const loading = state.status === "loading" && !state.read;
  function refresh() {
    if (preview) {
      return;
    }
    setState((previous) => ({ ...previous, status: "loading" }));
    setRequest((value) => value + 1);
  }

  return (
    <div className={styles.marketView} data-token-market="live">
      <section className={styles.market} data-token-state="launched" aria-label="Token market">
        <header className={styles.header}>
          <div className={styles.identity}>
            <AgentTokenIdentity token={token} />
          </div>
          <Tag>{token.chainId === 10143 ? "MONAD TESTNET" : "MONAD"}</Tag>
          <div className={styles.address}>
            <ChainReference
              value={token.address}
              chainId={token.chainId}
              label="token address"
              preview={preview}
            />
          </div>
        </header>
        <div className={styles.workspace}>
          <section
            className={styles.pricePanel}
            aria-label="Token price and valuation"
            aria-busy={state.status === "loading"}
          >
            <dl className={styles.metrics}>
              <div>
                <dt>
                  {market?.priceKind === "last_trade"
                    ? "Last trade price"
                    : graduated
                      ? "Final curve price"
                      : "Curve price"}
                </dt>
                <dd>
                  {loading ? <Skeleton shape="line" /> : amount(market?.priceWad, 18, 8)}{" "}
                  <span>{symbol}</span>
                </dd>
              </div>
              <div>
                <dt>
                  <abbr title="Fully diluted valuation: the observed price multiplied by the entire supply">
                    FDV
                  </abbr>
                </dt>
                <dd>
                  {loading ? <Skeleton shape="line" /> : amount(market?.fdvWad, 18, 2)}{" "}
                  <span>{symbol}</span>
                </dd>
              </div>
              <div>
                <dt>Curve volume · 24h</dt>
                <dd>
                  {loading ? (
                    <Skeleton shape="line" />
                  ) : (
                    amount(market?.volume24h, quoteDecimals, 2)
                  )}{" "}
                  <span>{symbol}</span>
                </dd>
              </div>
            </dl>
            <div className={styles.chartToolbar}>
              <span className={styles.caption}>Price history · {symbol}</span>
              <Segmented
                label="Token price timeframe"
                value={range}
                onChange={setRange}
                tone="lime"
                options={[
                  { value: "1H", label: "1H" },
                  { value: "24H", label: "24H" },
                  { value: "7D", label: "7D" },
                ]}
              />
            </div>
            <div className={styles.chart}>
              {loading ? (
                <Skeleton shape="panel" />
              ) : points.length > 1 ? (
                <AreaChart
                  points={points}
                  height={240}
                  precision={8}
                  label={`${range.toLowerCase()} observed token prices in ${symbol}`}
                />
              ) : (
                <div className={styles.empty} role="status">
                  <Icon name="chart" size={24} />
                  <strong>
                    {market?.recentTrades.length
                      ? "More trades will build the chart"
                      : "No curve trades recorded yet"}
                  </strong>
                  <span>
                    {market?.priceWad
                      ? "The recorded price is shown above."
                      : "Price history appears as confirmed trades are indexed."}
                  </span>
                </div>
              )}
            </div>
            <div className={styles.dataStatus} role="status">
              <span className={styles.caption}>
                {state.status === "error"
                  ? "Market data could not be refreshed. Trading remains available."
                  : loading
                    ? "Loading market data…"
                    : !market
                      ? "Market data is being indexed. Trading remains available."
                      : `${state.read?.stale ? "Index catching up · " : "Indexed · "}Block ${market.observedBlock}${market.historyTruncated ? " · hourly snapshots" : ""}`}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={preview || state.status === "loading"}
                onClick={refresh}
              >
                {state.status === "loading"
                  ? "Refreshing…"
                  : state.status === "error"
                    ? "Retry"
                    : "Refresh"}
              </Button>
            </div>
          </section>
          <div className={styles.ticket}>
            <PublicTokenTrade
              token={token}
              handle={handle}
              preview={preview}
              embedded
              onConfirmed={refresh}
            />
          </div>
        </div>
      </section>
      <section className={styles.curve} aria-label="Bonding curve progress">
        <div className={styles.curveHead}>
          <h2>
            Curve progress{" "}
            <span className={styles.progressValue}>
              {market?.progressBps !== null && market?.progressBps !== undefined
                ? `${(market.progressBps / 100).toLocaleString("en-US")}%`
                : "—"}
            </span>
          </h2>
          <div className={styles.curveActions}>
            <span className={styles.onCurve}>
              {graduated
                ? "Graduated"
                : market?.progressBps === 10000
                  ? "Curve complete"
                  : market
                    ? "On the curve"
                    : "Awaiting market data"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={explained}
              aria-controls="public-curve-explanation"
              onClick={() => setExplained((value) => !value)}
            >
              How the curve works <Icon name={explained ? "chevronUp" : "chevronDown"} size={14} />
            </Button>
          </div>
        </div>
        {market?.progressBps !== null && market?.progressBps !== undefined && (
          <Meter
            value={market.progressBps / 100}
            tone="lime"
            className={styles.progress}
            label="Curve supply sold"
          />
        )}
        <div className={styles.curveFigures}>
          <span>
            <strong>
              {amount(market?.netSold, tokenDecimals, 2)}
              {terms ? ` / ${amount(terms.saleAllocation, tokenDecimals, 0)}` : ""}
            </strong>{" "}
            sold net
          </span>
          <span>
            {graduated ? "Reserve at curve completion" : "Recorded real reserve"}{" "}
            <strong>
              {amount(market?.realQuoteReserve, quoteDecimals, 2)} {symbol}
            </strong>
          </span>
          <span>
            <strong>{amount(market?.remainingTokens, tokenDecimals, 2)}</strong> tokens remaining
          </span>
        </div>
        {explained && (
          <p className={styles.explanation} id="public-curve-explanation">
            Buying raises the curve price; selling lowers it. Real reserves back trading and exclude
            fees. When the sale allocation is exhausted, the remaining liquidity tokens and real
            reserve can migrate to the configured DEX. Displayed snapshots are informational; your
            trade is quoted separately before signing.
          </p>
        )}
      </section>
      <dl className={styles.distribution}>
        <div>
          <dt>Total supply</dt>
          <dd>
            {amount(state.read?.data.totalSupply, tokenDecimals, 0)}{" "}
            <span>fixed · no further minting</span>
          </dd>
        </div>
        <div>
          <dt>Distribution</dt>
          <dd>
            {terms
              ? `${amount(terms.saleAllocation, tokenDecimals, 0)} curve`
              : "Awaiting verified preset"}
            {terms && (
              <span>{amount(terms.lpAllocation, tokenDecimals, 0)} reserved for liquidity</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Creator allocation</dt>
          <dd>
            {terms ? "None" : "Awaiting verified preset"}
            <span>{terms ? "no initial project reserve" : "Historical terms are preserved"}</span>
          </dd>
        </div>
      </dl>
      <section className={styles.recent} aria-label="Recent curve trades">
        <div className={styles.recentHead}>
          <h2>Recent trades</h2>
          <span className={styles.caption}>Curve activity · UTC · price excludes fees</span>
        </div>
        {market?.recentTrades.length ? (
          <div
            className={styles.tableViewport}
            tabIndex={0}
            aria-label="Recent trades table; scroll horizontally on small screens"
          >
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Side</th>
                  <th>Price · {symbol}</th>
                  <th>Amount</th>
                  <th>Paid / received · {symbol}</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {market.recentTrades.map((trade) => (
                  <tr key={`${trade.txHash}:${trade.logIndex}`}>
                    <td>
                      <time dateTime={trade.blockTime}>
                        {new Date(trade.blockTime).toISOString().slice(0, 19).replace("T", " ")}
                      </time>
                    </td>
                    <td>
                      <Tag className={trade.side === "buy" ? styles.buyTag : styles.sellTag}>
                        {trade.side === "buy" ? "Buy" : "Sell"}
                      </Tag>
                    </td>
                    <td>{amount(trade.priceWad, 18, 8)}</td>
                    <td>{amount(trade.tokenAmount, tokenDecimals, 2)}</td>
                    <td>{amount(trade.quoteAmount, quoteDecimals, 2)}</td>
                    <td>
                      <ChainReference
                        value={trade.txHash}
                        chainId={token.chainId}
                        kind="tx"
                        label={`${trade.side} transaction`}
                        preview={preview}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.caption}>
            {loading
              ? "Loading recent trades…"
              : state.status === "error"
                ? "Recent trades are unavailable. Retry the market read above."
                : "Confirmed curve trades will appear here with their transaction hashes."}
          </p>
        )}
      </section>
    </div>
  );
}
