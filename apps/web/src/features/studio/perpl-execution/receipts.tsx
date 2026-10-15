"use client";
import { Button, Icon } from "@pickler/ui";
import { ChainReference } from "@/features/tokens/chain-reference";
import type { PerplExecution } from "./use-execution";
import { amount, groupCycles, orderIcon, orderLabels, timestamp } from "./presentation";
import styles from "./execution.module.css";

export function TransactionLinks({ hashes, preview }: { hashes: string[]; preview: boolean }) {
  if (hashes.length === 0) {
    return <span className={styles.note}>Tx hash not recorded</span>;
  }
  return (
    <div className={styles.links} aria-label="Transaction hashes">
      {hashes.map((hash, index) => (
        <ChainReference
          key={hash}
          value={hash}
          chainId={10143}
          kind="tx"
          label={`Perpl transaction${hashes.length > 1 ? ` ${index + 1}` : ""}`}
          preview={preview}
        />
      ))}
    </div>
  );
}

export function PerplCycleHistory({
  execution,
  compact = false,
  onControls,
}: {
  execution: PerplExecution;
  compact?: boolean;
  onControls?: (() => void) | undefined;
}) {
  const state = execution.state;
  const cycles = groupCycles(state?.orders ?? []);
  const visible = compact ? cycles.slice(0, 1) : cycles;
  return (
    <section
      className={styles.panel}
      id={compact ? "perpl-recent-orders" : "perpl-trading-record"}
      aria-label="Perpl trading cycles"
    >
      <div className={styles.head}>
        <h3 className={styles.title}>
          <Icon name="activity" size={21} />
          {compact ? "Recent cycle" : "Trading record"}
        </h3>
        <span className={styles.note}>Perpl · Monad Testnet</span>
      </div>
      {visible.length === 0 ? (
        <div className={styles.empty}>
          <Icon name="file" size={24} />
          <strong>No recorded cycle yet</strong>
          <p className={styles.note}>
            Open Controls to connect an account and start one cycle. Its opening, closing and
            recorded transaction hashes will appear here.
          </p>
          {onControls && (
            <Button variant="secondary" onClick={onControls}>
              <Icon name="sliders" size={17} />
              Open Controls
            </Button>
          )}
        </div>
      ) : (
        <div className={styles.cycles}>
          {visible.map((cycle) => {
            const closed = cycle.orders.some(
              (order) => order.action.startsWith("close") && order.status === "filled",
            );
            return (
              <article className={styles.cycle} key={cycle.id}>
                {!compact && (
                  <div className={styles.head}>
                    <strong>{cycle.symbol} cycle</strong>
                    <span className={styles.note}>
                      {closed ? "Close confirmed" : "Execution history"}
                    </span>
                  </div>
                )}
                <ol className={styles.orderList}>
                  {cycle.orders.map((order) => (
                    <li className={styles.order} key={order.id}>
                      <strong className={styles.orderAction}>
                        <Icon
                          name={order.action.startsWith("open") ? "arrowUp" : "arrowDown"}
                          size={21}
                        />
                        {order.action.startsWith("open") ? "Open" : "Close"} {order.symbol}
                        <small>{order.action.endsWith("short") ? "Short" : "Long"}</small>
                      </strong>
                      <span className={styles.orderStatus} data-state={order.status}>
                        <Icon name={orderIcon(order)} size={17} />
                        {orderLabels[order.status]}
                      </span>
                      <TransactionLinks hashes={order.txHashes} preview={execution.preview} />
                      <time className={styles.note} dateTime={order.createdAt}>
                        {timestamp(order.createdAt)}
                      </time>
                    </li>
                  ))}
                </ol>
                <details className={styles.orderDetails}>
                  <summary>
                    Execution details
                    <Icon name="chevronDown" size={14} />
                  </summary>
                  {cycle.orders.map((order) => (
                    <div key={order.id} className={styles.executionDetail}>
                      <strong>
                        {order.action.startsWith("open") ? "Opening" : "Closing"} · {order.symbol}
                      </strong>
                      <dl className={styles.detailGrid}>
                        <div>
                          <dt>Filled size</dt>
                          <dd>{amount(order.filledSize)}</dd>
                        </div>
                        <div>
                          <dt>Fill price</dt>
                          <dd>{amount(order.fillPrice)}</dd>
                        </div>
                        <div>
                          <dt>Fee · AUSD</dt>
                          <dd>{amount(order.feeAusd)}</dd>
                        </div>
                        <div>
                          <dt>Request</dt>
                          <dd>#{order.requestId}</dd>
                        </div>
                        <div>
                          <dt>Order</dt>
                          <dd>{order.orderId === null ? "—" : `#${order.orderId}`}</dd>
                        </div>
                      </dl>
                      {order.status !== "filled" && (
                        <p className={styles.note}>
                          Submission and transaction inclusion do not establish a fill. The status
                          above follows Perpl execution evidence.
                        </p>
                      )}
                    </div>
                  ))}
                </details>
              </article>
            );
          })}
        </div>
      )}
      {!compact && state?.positions.some((position) => position.closed) && (
        <details className={styles.orderDetails}>
          <summary>
            Last closed position snapshots
            <Icon name="chevronDown" size={14} />
          </summary>
          <ul className={styles.positionList}>
            {state.positions
              .filter((position) => position.closed)
              .map((position) => (
                <li key={position.id} className={styles.position}>
                  <strong>{position.symbol} · Closed</strong>
                  <dl className={styles.positionMetrics}>
                    <div>
                      <dt>Realized price P&L · AUSD</dt>
                      <dd>{amount(position.realizedPnlAusd)}</dd>
                    </div>
                    <div>
                      <dt>Exit price</dt>
                      <dd>{amount(position.exitPrice)}</dd>
                    </div>
                    <div>
                      <dt>Fee · AUSD</dt>
                      <dd>{amount(position.feeAusd)}</dd>
                    </div>
                    <div>
                      <dt>Funding · AUSD</dt>
                      <dd>{amount(position.fundingAusd)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
          </ul>
        </details>
      )}
    </section>
  );
}
