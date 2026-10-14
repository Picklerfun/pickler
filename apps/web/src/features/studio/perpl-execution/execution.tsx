"use client";
import { useState } from "react";
import { Button, Field, Input, ButtonLink } from "@pickler/ui";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pickler/ui/select";
import type { Agent } from "../api";
import type { PerplExecution } from "./use-execution";
import { perplExecutionMessage } from "./use-execution";
import styles from "./execution.module.css";
import { ExistingPerplKey } from "./existing-key";
import { useMarketplaceHref } from "@/features/site/studio-href";

const setupLabels = {
  approve: "Approve collateral for Perpl",
  create_account: "Create and fund the Perpl account",
  deposit: "Deposit collateral in Perpl",
  forwarding: "Enable trading for this account",
  enroll: "Authorize this agent's trading key",
};
const orderLabels = {
  prepared: "Queued",
  dispatching: "Sending",
  unknown: "Checking submission",
  accepted: "Submitted",
  filled: "Filled",
  partial: "Partially filled",
  rejected: "Refused",
  cancelled: "Cancelled",
  expired: "Expired",
};
function TransactionLinks({ hashes }: { hashes: string[] }) {
  return (
    <span className={styles.links}>
      {hashes.map((hash, index) => (
        <a
          className={styles.link}
          key={hash}
          href={`https://testnet.monadscan.com/tx/${hash}`}
          target="_blank"
          rel="noreferrer"
        >
          View transaction{hashes.length > 1 ? ` ${index + 1}` : ""}
        </a>
      ))}
    </span>
  );
}
export function PerplTradingControls({
  execution,
  agent,
  canManage,
  onLimits,
}: {
  execution: PerplExecution;
  agent: Agent;
  canManage: boolean;
  onLimits?: () => void;
}) {
  const [selectedSymbol, setSymbol] = useState(agent.config.perpl?.markets[0] ?? "");
  const markets = agent.config.perpl?.markets ?? [];
  const symbol = markets.includes(selectedSymbol) ? selectedSymbol : (markets[0] ?? "");
  const walletHref = useMarketplaceHref(`/perpl?wallet=${execution.state?.address ?? ""}`);
  const [margin, setMargin] = useState(String(Math.min(agent.spend?.perCallAusd ?? 1, 1)));
  const [collateral, setCollateral] = useState<string | null>(null);
  const [holding, setHolding] = useState("30");
  const [funding, setFunding] = useState(false);
  const state = execution.state;
  const minimumRequirement = state?.setupRequired
    ? state.requirements?.minimumAccountAusd
    : state?.requirements?.minimumDepositAusd;
  const minimumCollateral = minimumRequirement?.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  const selectedCollateral = collateral ?? minimumCollateral ?? "100";
  const collateralExceedsDailyLimit = Number(selectedCollateral) > (agent.spend?.perDayAusd ?? 0);
  const setup = state?.setup.at(-1);
  const active =
    !!state?.session && ["active", "paused", "stopping", "frozen"].includes(state.session.status);
  const disabled = execution.busy || execution.preview || !canManage;
  const marketOccupied = !!state?.positions.some(
    (p) => !p.closed && p.symbol === symbol && !p.managedBySession,
  );
  const preparePending = !!setup && !["confirmed", "failed"].includes(setup.status);
  return (
    <section
      className={styles.panel}
      id="perpl-trading-controls"
      aria-label="Perpl trading controls"
    >
      <div className={styles.head}>
        <h3 className={styles.title}>Perpl trading</h3>
        <span className={styles.status}>MONAD TESTNET</span>
      </div>
      {!state ? (
        <p className={styles.note}>Reading its trading account…</p>
      ) : !state.available ? (
        <p className={styles.note}>Trading is not available for this agent yet.</p>
      ) : (
        <>
          <p className={styles.note}>
            Orders run from this agent&apos;s Perpl account. One new position at a time, at 1×
            leverage. Existing positions in other markets stay outside this session.
          </p>
          {state.setupRequired && !preparePending && (
            <ExistingPerplKey
              key={`${agent.productId ?? agent.id}:${state.address ?? ""}`}
              address={state.address}
              disabled={disabled || active}
              connect={execution.connectKey}
            />
          )}
          {state.setupEnabled === false && state.setupRequired && !preparePending ? (
            <p className={styles.note}>
              Automatic account setup is unavailable. Connect an existing Perpl key for this wallet
              to continue.
            </p>
          ) : state.setupRequired || funding || preparePending ? (
            <>
              <Field label="Collateral · AUSD">
                <Input
                  inputMode="decimal"
                  value={selectedCollateral}
                  onChange={(e) => setCollateral(e.target.value)}
                  disabled={disabled || preparePending}
                />
              </Field>
              <p className={styles.note}>
                Daily collateral limit: {agent.spend?.perDayAusd ?? 0} AUSD. A new account also
                requires Perpl&apos;s minimum deposit.
              </p>
              {minimumCollateral && (
                <p className={styles.note}>
                  Perpl minimum: {minimumCollateral} AUSD. Maximum per deposit:{" "}
                  {state.requirements?.maximumCollateralAusd
                    .replace(/(\.\d*?)0+$/, "$1")
                    .replace(/\.$/, "")}{" "}
                  AUSD.
                </p>
              )}
              {collateralExceedsDailyLimit && (
                <p className={styles.error} role="alert">
                  Set this agent&apos;s daily limit to at least {selectedCollateral} AUSD before
                  preparing this deposit.
                </p>
              )}
              {onLimits && (
                <Button disabled={disabled || preparePending} onClick={onLimits}>
                  Edit agent limits
                </Button>
              )}
              {setup && setup.status !== "confirmed" && setup.status !== "failed" ? (
                <div className={styles.copy}>
                  <strong>{setupLabels[setup.kind]}</strong>
                  {setup.kind === "enroll" && state.keyExpiresAt && (
                    <p className={styles.note}>
                      Trading permission expires{" "}
                      {new Date(state.keyExpiresAt).toISOString().slice(0, 10)}.
                    </p>
                  )}
                  <p className={styles.note}>
                    {setup.kind === "enroll"
                      ? "Allow reading and trading only. This key cannot withdraw your funds."
                      : setup.kind === "forwarding"
                        ? "Allow Perpl to forward orders for this account."
                        : `${setup.collateralAusd} AUSD · authorized with your passkey.`}
                  </p>
                  {setup.status === "awaiting_signature" ? (
                    <Button
                      variant="primary"
                      disabled={disabled}
                      onClick={() => void execution.authorize()}
                    >
                      {execution.busy ? "Waiting for authorization…" : "Authorize with passkey"}
                    </Button>
                  ) : (
                    <p className={styles.note} role="status">
                      Checking this account step. Its authorization will not be repeated.
                    </p>
                  )}
                  {setup.txHash && <TransactionLinks hashes={[setup.txHash]} />}
                </div>
              ) : (
                <Button
                  variant="primary"
                  disabled={
                    disabled ||
                    !state.admissionsEnabled ||
                    state.setupEnabled === false ||
                    collateralExceedsDailyLimit
                  }
                  onClick={() => void execution.prepare(selectedCollateral)}
                >
                  {execution.busy
                    ? "Preparing…"
                    : state.setupRequired
                      ? "Set up Perpl"
                      : "Prepare deposit"}
                </Button>
              )}
              {!state.setupRequired && !preparePending && (
                <Button disabled={execution.busy} onClick={() => setFunding(false)}>
                  Back to trading
                </Button>
              )}
            </>
          ) : (
            <>
              <div className={styles.form}>
                <Field label="Market">
                  <Select value={symbol} onValueChange={setSymbol} disabled={disabled || active}>
                    <SelectTrigger aria-label="Trading market">
                      <SelectValue placeholder="Select a market" />
                    </SelectTrigger>
                    <SelectContent data-surface="dark">
                      <SelectGroup>
                        {(agent.config.perpl?.markets ?? []).map((market) => (
                          <SelectItem key={market} value={market}>
                            {market}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Margin · AUSD">
                  <Input
                    inputMode="decimal"
                    value={margin}
                    onChange={(e) => setMargin(e.target.value)}
                    disabled={disabled || active}
                  />
                </Field>
                <Field label="Target holding time · seconds">
                  <Input
                    inputMode="numeric"
                    value={holding}
                    onChange={(e) => setHolding(e.target.value)}
                    disabled={disabled || active}
                  />
                </Field>
              </div>
              <p className={styles.note}>
                One opening and one closing. Confirmed executions and their transactions appear in
                Positions and Record.
              </p>
              {marketOccupied && !active ? (
                <p className={styles.note}>
                  This market has an existing position. Choose another market for a separate trading
                  cycle.
                </p>
              ) : null}
              {state.connection === "key_wallet" && state.address ? (
                <ButtonLink href={walletHref}>View connected wallet</ButtonLink>
              ) : null}
              <div className={styles.actions}>
                {!active ? (
                  <Button
                    variant="primary"
                    id="perpl-start-trading"
                    disabled={disabled || !state.admissionsEnabled || marketOccupied || !symbol}
                    onClick={() =>
                      void execution.start({
                        symbol,
                        marginAusd: margin,
                        leverage: 1,
                        cycles: 1,
                        holdSeconds: Number(holding),
                      })
                    }
                  >
                    {execution.busy ? "Starting…" : "Start trading"}
                  </Button>
                ) : (
                  <PerplHeaderControls execution={execution} canManage={canManage} />
                )}
                {!active && (
                  <Button
                    disabled={disabled || !state.admissionsEnabled || state.setupEnabled === false}
                    onClick={() => setFunding(true)}
                  >
                    Add collateral
                  </Button>
                )}
              </div>
            </>
          )}
          {state.session && (
            <p className={styles.note} role="status">
              {state.session.status.toUpperCase()} · {state.session.completedCycles}/
              {state.session.settings.cycles} cycles closed
              {state.session.error ? ` · ${perplExecutionMessage(state.session.error)}` : ""}
            </p>
          )}
          {!state.admissionsEnabled && (
            <p className={styles.note}>
              New entries are paused. Existing positions remain tracked.
            </p>
          )}
        </>
      )}
      {execution.error && (
        <p className={styles.error} role="alert">
          {execution.error}{" "}
          <Button
            size="sm"
            disabled={execution.busy || execution.preview}
            onClick={() => void execution.refresh()}
          >
            Check status
          </Button>
        </p>
      )}
    </section>
  );
}
export function PerplHeaderControls({
  execution,
  canManage,
}: {
  execution: PerplExecution;
  canManage: boolean;
}) {
  const session = execution.state?.session;
  const disabled = execution.busy || execution.preview || !canManage;
  if (!session || !["active", "paused", "stopping", "frozen"].includes(session.status)) {
    return null;
  }
  return (
    <div className={styles.actions}>
      <Button
        disabled={disabled || !["active", "paused"].includes(session.status)}
        onClick={() => void execution.control(session.status === "paused" ? "resume" : "pause")}
      >
        {session.status === "paused" ? "Resume trading" : "Pause entries"}
      </Button>
      <Button
        disabled={disabled || session.status === "stopping"}
        onClick={() => void execution.control("stop")}
      >
        {session.status === "stopping" ? "Closing positions…" : "Stop & close"}
      </Button>
    </div>
  );
}
export function PerplTradingPositions({
  execution,
  canManage,
}: {
  execution: PerplExecution;
  canManage: boolean;
}) {
  const state = execution.state;
  if (!state?.available || state.setupRequired) {
    return null;
  }
  const positions = state.positions.filter((p) => !p.closed);
  return (
    <section className={styles.panel} id="perpl-trading-positions" aria-label="Perpl positions">
      <div className={styles.head}>
        <h3 className={styles.title}>Open positions · Perpl</h3>
        <span className={styles.status}>{positions.length} OPEN · TESTNET</span>
      </div>
      {positions.length === 0 ? (
        <p className={styles.note}>No open positions confirmed by Perpl.</p>
      ) : (
        <ul className={styles.list}>
          {positions.map((p) => (
            <li className={styles.row} key={p.id}>
              <div className={styles.copy}>
                <strong>
                  {p.side.toUpperCase()} {p.symbol} · {p.leverage}×
                </strong>
                <span className={styles.note}>
                  Margin {p.collateralAusd} AUSD · Size {p.size ?? "—"}
                </span>
                <span className={styles.note}>
                  Entry {p.entryPrice ?? "—"} · Mark {p.markPrice ?? "—"}
                </span>
              </div>
              <div className={styles.copy}>
                <strong>{p.unrealizedPnlAusd ?? "—"} AUSD</strong>
                <span className={styles.note}>Unrealized P&L</span>
                {p.managedBySession ? (
                  <Button
                    size="sm"
                    disabled={
                      !canManage ||
                      execution.preview ||
                      execution.busy ||
                      state.session?.status === "stopping"
                    }
                    onClick={() => void execution.control("close")}
                  >
                    {state.session?.status === "stopping" ? "Closing…" : "Close position"}
                  </Button>
                ) : (
                  <span className={styles.note}>
                    Existing position · not managed by this session
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.facts}>
        <span className={styles.note}>Exchange balance: {state.balanceAusd ?? "—"} AUSD</span>
        {state.observedAt && (
          <span className={styles.note}>
            Updated {new Date(state.observedAt).toISOString().slice(11, 19)} UTC
          </span>
        )}
      </div>
      <PerplTradingRecord execution={execution} compact />
      {execution.error && (
        <p className={styles.error} role="alert">
          {execution.error}
        </p>
      )}
    </section>
  );
}
export function PerplTradingRecord({
  execution,
  compact = false,
}: {
  execution: PerplExecution;
  compact?: boolean;
}) {
  const state = execution.state;
  if (!state?.available || state.setupRequired) {
    return null;
  }
  const orders = compact ? state.orders.slice(0, 4) : state.orders;
  return (
    <section
      className={compact ? styles.copy : styles.panel}
      id={compact ? "perpl-recent-orders" : "perpl-trading-record"}
      aria-label="Perpl order history"
    >
      <div className={styles.head}>
        <h3 className={styles.title}>{compact ? "Recent orders" : "Transactions · Perpl"}</h3>
        <span className={styles.note}>REAL EXECUTIONS · TESTNET</span>
      </div>
      {orders.length === 0 ? (
        <p className={styles.note}>Its submitted orders will appear here.</p>
      ) : (
        <ul className={styles.list}>
          {orders.map((o) => (
            <li className={styles.row} key={o.id}>
              <div className={styles.copy}>
                <strong>
                  {o.action.replaceAll("_", " ").toUpperCase()} {o.symbol}
                </strong>
                <span className={styles.note}>
                  Request #{o.requestId}
                  {o.orderId !== null ? ` · Order #${o.orderId}` : ""} ·{" "}
                  {new Date(o.createdAt).toISOString().slice(11, 19)} UTC
                </span>
                <span className={styles.note}>
                  Filled {o.filledSize ?? "—"} · Price {o.fillPrice ?? "—"} · Fee {o.feeAusd ?? "—"}{" "}
                  AUSD
                </span>
                <TransactionLinks hashes={o.txHashes} />
              </div>
              <span className={styles.status}>{orderLabels[o.status]}</span>
            </li>
          ))}
        </ul>
      )}
      {!compact && state.positions.some((p) => p.closed) && (
        <ul className={styles.list} aria-label="Closed Perpl positions">
          {state.positions
            .filter((p) => p.closed)
            .map((p) => (
              <li className={styles.row} key={p.id}>
                <strong>{p.symbol} · Closed</strong>
                <span className={styles.note}>
                  Latest close · Price P&L {p.realizedPnlAusd ?? "—"} AUSD · Fee {p.feeAusd} AUSD ·
                  Funding {p.fundingAusd ?? "—"} AUSD
                </span>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
