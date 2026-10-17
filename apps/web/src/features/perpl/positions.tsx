"use client";

import { useId, useState } from "react";
import type { PerplPortfolioDto } from "@pickler/api-schema";
import { Button, Icon, Meter, Tag } from "@pickler/ui";
import { money, number, percent, price, signedMoney, tone } from "./display";
import { MarketAsset, marketIdentity } from "./market-asset";
import styles from "./positions.module.css";

type Position = PerplPortfolioDto["positions"][number];

function positionKey(position: Position) {
  return `${position.accountId}:${position.id}`;
}

export function OpenPositions({
  positions,
  accountCount,
}: {
  positions: Position[];
  accountCount: number;
}) {
  const panelId = useId();
  const titleId = useId();
  const [selectedKey, setSelectedKey] = useState<string | null>(() =>
    positions[0] ? positionKey(positions[0]) : null,
  );
  const selected =
    positions.find((position) => positionKey(position) === selectedKey) ?? positions[0];

  return (
    <div className={styles.positions}>
      <div className={styles.selector}>
        <h2>
          Open positions <span>{positions.length}</span>
        </h2>
        {selected ? (
          <ul className={styles.list} aria-label="Open Perpl positions">
            {positions.map((position) => {
              const identity = marketIdentity(position.symbol);
              const active = positionKey(position) === positionKey(selected);

              return (
                <li key={positionKey(position)}>
                  <Button
                    variant="tile"
                    className={styles.choice}
                    aria-pressed={active}
                    aria-controls={panelId}
                    aria-label={`View ${identity.ticker} ${position.side} position in account ${position.accountId}`}
                    onClick={() => setSelectedKey(positionKey(position))}
                  >
                    <span className={styles.choiceHead}>
                      <PositionIdentity position={position} />
                      <PositionSide side={position.side} />
                      <Icon name="chevronRight" size={20} className={styles.chevron} />
                    </span>
                    <span className={styles.pnl} data-surface={active ? "dark" : "light"}>
                      <span>Open price P&amp;L</span>
                      <strong data-tone={tone(position.pricePnlAusd)}>
                        {signedMoney(position.pricePnlAusd)} <small>AUSD</small>
                      </strong>
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.empty}>
            {accountCount
              ? "No open positions on this wallet."
              : "This wallet has no exchange account yet."}
          </p>
        )}
      </div>
      {selected ? (
        <section className={styles.detail} id={panelId} aria-labelledby={titleId}>
          <span className={styles.selectionAnnouncement} role="status" aria-atomic="true">
            {marketIdentity(selected.symbol).ticker} {selected.side} position selected
          </span>
          <PositionDetail key={positionKey(selected)} position={selected} titleId={titleId} />
        </section>
      ) : null}
    </div>
  );
}

function PositionIdentity({ position }: { position: Position }) {
  const identity = marketIdentity(position.symbol);

  return (
    <span className={styles.identity}>
      <MarketAsset symbol={position.symbol} />
      <span>
        <strong>{identity.ticker}</strong>
        <small>{identity.asset?.name ?? "Perpetual"}</small>
      </span>
    </span>
  );
}

function PositionSide({ side }: { side: Position["side"] }) {
  return (
    <Tag className={styles.side} data-tone={side === "long" ? "good" : "loss"}>
      <Icon name={side === "long" ? "arrowUp" : "arrowDown"} size={14} />
      {side === "long" ? "Long" : "Short"}
    </Tag>
  );
}

function PositionDetail({ position: p, titleId }: { position: Position; titleId: string }) {
  const ticker = marketIdentity(p.symbol).ticker;
  const buffer = p.priceBufferBps === null ? null : Number(p.priceBufferBps);
  let risk: "neutral" | "loss" | "caution" | "good" = "neutral";
  let meterTone: "cyan" | "magenta" | "amber" | "lime" = "cyan";

  if (buffer !== null) {
    if (buffer <= 0) {
      risk = "loss";
      meterTone = "magenta";
    } else if (buffer < 500) {
      risk = "caution";
      meterTone = "amber";
    } else {
      risk = "good";
      meterTone = "lime";
    }
  }

  return (
    <div className={styles.detailContent}>
      <header className={styles.detailHead}>
        <h3 id={titleId}>{ticker} position</h3>
        <div className={styles.detailIdentity}>
          <PositionIdentity position={p} />
          <PositionSide side={p.side} />
        </div>
      </header>
      <div className={styles.prices}>
        <dl>
          <dt>Entry price</dt>
          <dd>
            {price(p.entryPrice)} <span>AUSD</span>
          </dd>
        </dl>
        <Icon name="arrow" size={22} className={styles.priceArrow} />
        <dl>
          <dt>Mark price</dt>
          <dd>
            {price(p.markPrice)} <span>AUSD</span>
          </dd>
        </dl>
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>Size</dt>
          <dd>
            {number(p.quantity, 8)} <span>{ticker}</span>
          </dd>
        </div>
        <div>
          <dt>Collateral</dt>
          <dd>
            {money(p.collateralAusd)} <span>AUSD</span>
          </dd>
        </div>
      </dl>
      <div className={styles.buffer} data-tone={risk}>
        <details className={styles.bufferInfo}>
          <summary>
            Estimated price buffer <Icon name="help" size={16} />
          </summary>
          <p>
            Collateral exhaustion estimate: {price(p.collateralExhaustionPrice)} AUSD. This is not
            the liquidation price. The bar spans 0–20%.
          </p>
        </details>
        <div className={styles.bufferValue}>
          <strong>{percent(p.priceBufferBps)}</strong>
          {buffer !== null ? (
            <Meter
              className={styles.bufferMeter}
              value={Math.max(0, Math.min(100, buffer / 20))}
              tone={meterTone}
              label="Estimated price buffer, full scale 20 percent"
            />
          ) : (
            <span className={styles.unavailable}>Unavailable</span>
          )}
        </div>
      </div>
    </div>
  );
}
