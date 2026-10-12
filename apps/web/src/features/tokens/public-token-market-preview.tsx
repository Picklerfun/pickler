"use client";

import { useState } from "react";
import type { AgentTokenDto } from "@pickler/api-schema";
import { AreaChart, Button, Field, Icon, Input, Meter, Segmented, Tag } from "@pickler/ui";
import { AgentTokenIdentity } from "./agent-token-card";
import { ChainReference } from "./chain-reference";
import {
  PREVIEW_CHANGE,
  PREVIEW_HISTORY,
  PREVIEW_TRADES,
  type PreviewRange,
} from "./public-token-market-preview.fixture";
import styles from "./public-token-market-preview.module.css";

/** Local visual exploration only: no quotes, providers, wallet ceremonies or transactions. */
export function PublicTokenMarketPreview({ token }: { token: AgentTokenDto }) {
  if (process.env.NODE_ENV === "production") {
    return null;
  }
  return <MarketPreview token={token} />;
}

function MarketPreview({ token }: { token: AgentTokenDto }) {
  const [range, setRange] = useState<PreviewRange>("24H");
  const [explained, setExplained] = useState(false);
  const ticker = token.ticker.replace(/^\$+/, "");

  return (
    <div className={styles.preview} data-token-market-preview="true">
      <section
        className={styles.market}
        data-token-state="launched"
        aria-label="Token market preview"
      >
        <header className={styles.header}>
          <div className={styles.identity}>
            <AgentTokenIdentity token={token} />
          </div>
          <div className={styles.badges}>
            <Tag>MONAD TESTNET</Tag>
            <Tag className={styles.demo}>PREVIEW · DEMO DATA</Tag>
          </div>
          <div className={styles.address}>
            <ChainReference
              value={token.address}
              chainId={token.chainId}
              label="demo token address"
              preview
            />
          </div>
        </header>

        <div className={styles.workspace}>
          <section className={styles.pricePanel} aria-label="Token price and valuation">
            <dl className={styles.metrics}>
              <div>
                <dt>Price</dt>
                <dd>
                  0.00198333 <span>AUSD</span>
                  <small className={styles.gain}>
                    {PREVIEW_CHANGE[range]} ({range.toLowerCase()})
                  </small>
                </dd>
              </div>
              <div>
                <dt>
                  <abbr title="Fully diluted valuation: the price of the entire fixed supply">
                    FDV
                  </abbr>
                </dt>
                <dd>
                  41,649 <span>AUSD</span>
                </dd>
              </div>
              <div>
                <dt>Volume · 24h</dt>
                <dd>
                  3,240 <span>AUSD</span>
                </dd>
              </div>
            </dl>
            <div className={styles.chartToolbar}>
              <span className={styles.caption}>Price history · AUSD</span>
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
              <AreaChart
                points={PREVIEW_HISTORY[range]}
                height={300}
                precision={8}
                variant="market"
                currency="AUSD"
                label={`Simulated ${range.toLowerCase()} price history in AUSD; current price 0.00198333`}
              />
            </div>
          </section>
          <PreviewTradeTicket ticker={ticker} />
        </div>
      </section>

      <section className={styles.curve} aria-label="Bonding curve progress">
        <div className={styles.curveHead}>
          <h2>
            Curve progress <span className={styles.progressValue}>68%</span>
          </h2>
          <div className={styles.curveActions}>
            <span className={styles.onCurve}>On the curve</span>
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={explained}
              aria-controls="token-curve-explanation"
              onClick={() => setExplained((value) => !value)}
            >
              How the curve works <Icon name={explained ? "chevronUp" : "chevronDown"} size={14} />
            </Button>
          </div>
        </div>
        <Meter value={68} tone="lime" className={styles.progress} label="Curve supply sold" />
        <div className={styles.curveFigures}>
          <span>
            <strong>11.424M / 16.8M</strong> sold
          </span>
          <span>
            Real reserve <strong>≈11,102 AUSD</strong>
          </span>
          <span>
            <strong>5.376M</strong> tokens remaining
          </span>
        </div>
        {explained && (
          <p className={styles.explanation} id="token-curve-explanation">
            Buying raises the price; selling lowers it. The curve ends after 16.8M tokens are sold
            net. The remaining 4.2M tokens and the accumulated AUSD reserve fund liquidity.
            Graduation depends on the verified DEX configuration.
          </p>
        )}
      </section>

      <dl className={styles.distribution}>
        <div>
          <dt>Total supply</dt>
          <dd>
            21M <span>fixed · no further minting</span>
          </dd>
        </div>
        <div>
          <dt>Distribution</dt>
          <dd>80% curve · 20% liquidity</dd>
        </div>
        <div>
          <dt>Creator allocation</dt>
          <dd>
            None <span>no initial project reserve</span>
          </dd>
        </div>
      </dl>

      <section className={styles.recent} aria-label="Simulated recent trades">
        <div className={styles.recentHead}>
          <h2>Recent trades</h2>
          <span className={styles.caption}>Illustrative activity · UTC · sample receipts</span>
        </div>
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
                <th>Price · AUSD</th>
                <th>Amount</th>
                <th>Value · AUSD</th>
                <th>Transaction · sample</th>
              </tr>
            </thead>
            <tbody>
              {PREVIEW_TRADES.map((trade) => (
                <tr key={trade.time}>
                  <td>{trade.time}</td>
                  <td>
                    <Tag className={trade.side === "Buy" ? styles.buyTag : styles.sellTag}>
                      {trade.side}
                    </Tag>
                  </td>
                  <td>{trade.price}</td>
                  <td>{trade.amount}</td>
                  <td>{trade.value}</td>
                  <td>
                    <ChainReference
                      value={trade.txHash}
                      chainId={10143}
                      kind="tx"
                      label={`sample testnet ${trade.side.toLowerCase()} transaction at ${trade.time} UTC`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function PreviewTradeTicket({ ticker }: { ticker: string }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amounts, setAmounts] = useState({ buy: "100", sell: "25000" });
  const [slippage, setSlippage] = useState("50");
  const [reviewed, setReviewed] = useState(false);
  const amount = amounts[side];
  const asset = side === "buy" ? "AUSD" : ticker;
  const hasExample = amount === (side === "buy" ? "100" : "25000");
  const valid =
    /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0 && Number.isFinite(Number(amount));

  return (
    <section className={styles.ticket} aria-label="Preview token trade">
      <h2>Trade token</h2>
      <Segmented
        label="Preview trade side"
        value={side}
        tone="lime"
        className={styles.choices}
        options={[
          { value: "buy", label: "Buy" },
          { value: "sell", label: "Sell" },
        ]}
        onChange={(next) => {
          setSide(next);
          setReviewed(false);
        }}
      />
      <Field label={`You pay · ${asset}`}>
        <Input
          aria-label={`Preview amount · ${asset}`}
          inputMode="decimal"
          maxLength={24}
          value={amount}
          onChange={(event) => {
            setAmounts((value) => ({ ...value, [side]: event.target.value }));
            setReviewed(false);
          }}
        />
      </Field>
      <div className={styles.estimate}>
        <div>
          <span>You receive (est.)</span>
          <span>Illustrative quote</span>
        </div>
        <strong>
          {hasExample ? (side === "buy" ? `≈49,420 ${ticker}` : "≈49 AUSD") : "Not quoted"}
        </strong>
      </div>
      <div className={styles.slippage}>
        <span>Slippage limit</span>
        <Segmented
          label="Preview slippage limit"
          value={slippage}
          onChange={(value) => {
            setSlippage(value);
            setReviewed(false);
          }}
          tone="lime"
          className={styles.choices}
          options={[
            { value: "50", label: "0.5%" },
            { value: "100", label: "1%" },
          ]}
        />
      </div>
      <Button disabled={!valid} onClick={() => setReviewed(true)}>
        Preview {side}
      </Button>
      {reviewed ? (
        <p className={styles.review} role="status">
          Demo {side} reviewed · {amount} {asset}. No wallet was connected and no transaction was
          sent.
        </p>
      ) : (
        <p className={styles.ticketNote}>1% curve fee · Gas in MON</p>
      )}
    </section>
  );
}
