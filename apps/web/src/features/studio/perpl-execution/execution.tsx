"use client";
import { useEffect, useId, useState, type ReactNode } from "react";
import {
  ActionButton,
  Button,
  ButtonLink,
  Field,
  Icon,
  Input,
  Tag,
  type IconName,
} from "@pickler/ui";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pickler/ui/select";
import { Slider } from "@pickler/ui/slider";
import type { Agent } from "../api";
import { useTradingMarkets } from "../shell/trading-markets";
import type { PerplExecution } from "./use-execution";
import { perplExecutionMessage } from "./use-execution";
import { useMarketplaceHref } from "@/features/site/studio-href";
import { ChainReference } from "@/features/tokens/chain-reference";
import { MarketAsset } from "@/features/perpl/market-asset";
import { PerplAccountSetup } from "./account-setup";
import { PerplCycleHistory } from "./receipts";
import {
  accountObserved,
  amount,
  executionMarketOptions,
  sessionFeedback,
  sessionRunning,
  timestamp,
} from "./presentation";
import styles from "./execution.module.css";

function Label({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <span className={styles.label}>
      <Icon name={icon} size={16} />
      {children}
    </span>
  );
}
export function PerplAccountSummary({ execution }: { execution: PerplExecution }) {
  const state = execution.state;
  const connected = !!state?.available && !state.setupRequired;
  return (
    <section className={styles.account} id="perpl-account-summary" aria-label="Perpl account">
      <div className={styles.accountIdentity}>
        <Icon name="user" size={24} />
        <div className={styles.copy}>
          <strong>Perpl account</strong>
          <span className={styles.note}>
            {state?.accountId ? `Account #${state.accountId}` : "Used by this agent for trading"}
          </span>
        </div>
      </div>
      <div className={`${styles.accountFact} ${styles.accountConnection}`}>
        <Label icon="key">API key</Label>
        <strong className={connected ? styles.good : styles.note}>
          {!state ? "Reading…" : connected ? "Connected" : "Connection required"}
        </strong>
      </div>
      <div className={`${styles.accountFact} ${styles.accountWallet}`}>
        <Label icon="wallet">Exchange wallet</Label>
        {state?.address ? (
          <ChainReference
            value={state.address}
            chainId={10143}
            label="Perpl wallet"
            preview={execution.preview}
          />
        ) : (
          <span className={styles.note}>Not connected</span>
        )}
      </div>
      <div className={`${styles.accountFact} ${styles.accountBalance}`}>
        <Label icon="coin">Available on Perpl</Label>
        <strong className={styles.balance}>
          {accountObserved(state) ? amount(state?.balanceAusd) : "—"} <small>AUSD</small>
        </strong>
      </div>
    </section>
  );
}
function ReadNotice({ execution }: { execution: PerplExecution }) {
  if (!execution.error) {
    return null;
  }
  return (
    <div className={styles.error} role="alert">
      <Icon name="alert" size={18} />
      <span>{execution.error}</span>
      <Button
        variant="secondary"
        size="sm"
        disabled={execution.busy || execution.preview}
        onClick={() => void execution.refresh()}
      >
        <Icon name="refresh" size={15} />
        Check status
      </Button>
    </div>
  );
}
function AccountNotice({
  execution,
  onControls,
}: {
  execution: PerplExecution;
  onControls?: (() => void) | undefined;
}) {
  const state = execution.state;
  const title = !state
    ? "Reading the trading account…"
    : !state.available
      ? "Trading is unavailable"
      : state.setupRequired
        ? "Connect a Perpl account"
        : "Waiting for an account observation";
  return (
    <div className={styles.empty}>
      <Icon name={state?.setupRequired ? "key" : "clock"} size={26} />
      <strong>{title}</strong>
      <p className={styles.note}>
        A successful account read is needed to show balances and positions. Recorded history stays
        below when available.
      </p>
      {onControls && (
        <Button variant="secondary" onClick={onControls}>
          <Icon name="sliders" size={17} />
          Open Controls
        </Button>
      )}
    </div>
  );
}

export function PerplTradingControls({
  execution,
  agent,
  canManage,
  onLimits,
  onPositions,
  onMarkets,
}: {
  execution: PerplExecution;
  agent: Agent;
  canManage: boolean;
  onLimits?: () => void;
  onPositions?: () => void;
  onMarkets?: () => void;
}) {
  const fields = useId();
  // Fixture feedback changes only the button; it never submits or changes account data.
  const [previewPhase, setPreviewPhase] = useState<number | null>(null);
  useEffect(() => {
    if (!execution.preview || previewPhase === null) {
      return;
    }
    const timer = setTimeout(
      () => setPreviewPhase(previewPhase < 2 ? previewPhase + 1 : null),
      previewPhase === 2 ? 2200 : 1000,
    );
    return () => clearTimeout(timer);
  }, [execution.preview, previewPhase]);
  const [selectedSymbol, setSymbol] = useState(agent.config.perpl?.markets[0] ?? "");
  const markets = agent.config.perpl?.markets ?? [];
  const symbol = markets.includes(selectedSymbol) ? selectedSymbol : (markets[0] ?? "");
  const marketRead = useTradingMarkets(agent.config.perpl?.network ?? null, execution.preview);
  const marketOptions = executionMarketOptions(marketRead.catalog, markets);
  const marketAllowed = marketRead.allows([symbol]) && markets.includes(symbol);
  const [margin, setMargin] = useState(String(Math.min(agent.spend?.perCallAusd ?? 1, 1)));
  const [holding, setHolding] = useState("30");
  const [funding, setFunding] = useState(false);
  const state = execution.state;
  const active = sessionRunning(state);
  const observed = accountObserved(state);
  const disabled = execution.busy || !canManage;
  const pendingSetup = state?.setup.some((step) => !["confirmed", "failed"].includes(step.status));
  const setup = !!state?.available && (state.setupRequired || funding || pendingSetup);
  const marketOccupied = !!state?.positions.some(
    (position) => !position.closed && position.symbol === symbol && !position.managedBySession,
  );
  const validInput =
    /^\d{1,4}(?:\.\d{1,6})?$/.test(margin) &&
    Number(margin) > 0 &&
    /^\d+$/.test(holding) &&
    Number(holding) >= 30 &&
    Number(holding) <= 3600;
  const actualFeedback = sessionFeedback(state, execution.pendingAction === "start");
  const feedback =
    execution.preview && previewPhase !== null
      ? {
          state:
            previewPhase === 0
              ? ("working" as const)
              : previewPhase === 1
                ? ("waiting" as const)
                : ("success" as const),
          label:
            previewPhase === 0
              ? "Preview · sending"
              : previewPhase === 1
                ? "Preview · awaiting fill"
                : "Preview · confirmed",
          hint: "Visual feedback only · no orders sent",
          busy: previewPhase < 2,
        }
      : actualFeedback;
  const walletHref = useMarketplaceHref(`/perpl?wallet=${state?.address ?? ""}`);
  const managed =
    state?.positions.filter((position) => !position.closed && position.managedBySession) ?? [];
  const other =
    state?.positions.filter((position) => !position.closed && !position.managedBySession) ?? [];
  return (
    <div className={styles.workspace}>
      <PerplAccountSummary execution={execution} />
      <div className={styles.controlGrid}>
        <section
          className={styles.panel}
          id="perpl-trading-controls"
          aria-label="Perpl trading controls"
        >
          <div className={styles.copy}>
            <h3 className={styles.title}>{setup ? "Connect your account" : "Trading controls"}</h3>
            <p className={styles.note}>
              {setup
                ? "Use a Perpl testnet API key to connect the account used by this agent."
                : "Start one testnet trading cycle on Perpl. One opening and one closing."}
            </p>
          </div>
          {setup ? (
            <PerplAccountSetup
              execution={execution}
              agent={agent}
              canManage={canManage}
              funding={funding}
              onBack={() => setFunding(false)}
              onLimits={onLimits}
            />
          ) : !state?.available ? (
            <AccountNotice execution={execution} />
          ) : (
            <>
              <div className={styles.form}>
                <Field htmlFor={`${fields}-market`} label={<Label icon="bars">Market</Label>}>
                  <Select
                    value={symbol}
                    onValueChange={(value) => {
                      if (markets.includes(value) && marketRead.allows([value])) {
                        setSymbol(value);
                      }
                    }}
                    disabled={disabled || active || !marketRead.ready}
                  >
                    <SelectTrigger
                      id={`${fields}-market`}
                      aria-labelledby={`${fields}-market-label`}
                    >
                      <span className={styles.marketValue}>
                        {symbol && <MarketAsset symbol={symbol} />}
                        <SelectValue placeholder="Select a market">
                          {symbol || undefined}
                        </SelectValue>
                      </span>
                    </SelectTrigger>
                    <SelectContent data-surface="dark">
                      <SelectGroup>
                        {marketOptions.map((market) => (
                          <SelectItem
                            key={market.value}
                            value={market.value}
                            disabled={!market.enabled}
                            textValue={market.symbol ?? market.name}
                          >
                            <span className={styles.marketOption}>
                              <span>{market.symbol ?? market.name}</span>
                              {market.reason && <small>{market.reason}</small>}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={<Label icon="coin">Margin · AUSD</Label>}>
                  <Input
                    inputMode="decimal"
                    value={margin}
                    onChange={(e) => setMargin(e.target.value)}
                    disabled={disabled || active}
                  />
                </Field>
                <Field label={<Label icon="clock">Target hold · seconds</Label>}>
                  <Input
                    inputMode="numeric"
                    value={holding}
                    onChange={(e) => setHolding(e.target.value)}
                    disabled={disabled || active}
                  />
                </Field>
                <div className={styles.leverageField}>
                  <div className={styles.head}>
                    <span id={`${fields}-leverage-label`}>
                      <Label icon="shield">Leverage</Label>
                    </span>
                    <strong>1×</strong>
                  </div>
                  <Slider
                    value={[1]}
                    min={1}
                    max={1}
                    step={1}
                    disabled
                    aria-labelledby={`${fields}-leverage-label`}
                    aria-describedby={`${fields}-leverage-hint`}
                    getValueLabel={(value) => `${value}×`}
                  />
                  <span className={styles.note} id={`${fields}-leverage-hint`}>
                    Current limit · 1×
                  </span>
                </div>
              </div>
              <div className={styles.catalogueNote}>
                <span className={styles.note} role="status">
                  {marketRead.phase === "loading"
                    ? "Loading official Perpl markets…"
                    : !marketRead.ready
                      ? "Market catalogue unavailable. Refresh before starting."
                      : !marketAllowed
                        ? "Enable an available market in Sources & rules before starting."
                        : "Official Perpl markets · enabled for this agent"}
                </span>
                {!marketRead.ready && marketRead.phase !== "loading" && (
                  <Button variant="secondary" size="sm" onClick={marketRead.retry}>
                    <Icon name="refresh" size={14} /> Retry markets
                  </Button>
                )}
                {onMarkets && (
                  <Button variant="ghost" size="sm" onClick={onMarkets}>
                    Manage markets <Icon name="arrow" size={14} />
                  </Button>
                )}
              </div>
              <div className={styles.cycleNote}>
                <Icon name="refresh" size={20} />
                <span>
                  Stops after one cycle. The holding time is a target; confirmation can take longer.
                </span>
              </div>
              {marketOccupied && !active && (
                <p className={styles.note}>
                  <Icon name="alert" size={16} /> This market has an existing position. Choose
                  another market for this cycle.
                </p>
              )}
              {!validInput && !active && (
                <p className={styles.note}>
                  Enter a positive margin and a target hold from 30 to 3,600 seconds.
                </p>
              )}
              <ActionButton
                id="perpl-start-trading"
                icon="play"
                state={feedback.state}
                label={feedback.label}
                hint={feedback.hint}
                busy={feedback.busy}
                disabled={
                  disabled ||
                  previewPhase !== null ||
                  active ||
                  !observed ||
                  !!execution.readError ||
                  !state.admissionsEnabled ||
                  marketOccupied ||
                  !marketAllowed ||
                  !validInput
                }
                onClick={() => {
                  if (execution.preview) {
                    setPreviewPhase(0);
                    return;
                  }
                  void execution.start({
                    symbol,
                    marginAusd: margin,
                    leverage: 1,
                    cycles: 1,
                    holdSeconds: Number(holding),
                  });
                }}
              />
              {execution.preview && (
                <p className={styles.note}>Button preview only · no orders are sent.</p>
              )}
              {active && <PerplHeaderControls execution={execution} canManage={canManage} />}
              {!state.admissionsEnabled && (
                <p className={styles.note}>
                  New entries are paused. Existing exits remain tracked.
                </p>
              )}
            </>
          )}
          <ReadNotice execution={execution} />
        </section>
        <aside className={styles.panel} aria-label="This session">
          <h3 className={styles.title}>This session</h3>
          <dl className={styles.sessionFacts}>
            <div>
              <dt>
                <Icon name="bars" size={17} />
                Market
              </dt>
              <dd>{active ? state?.session?.settings.symbol : symbol || "—"}</dd>
            </div>
            <div>
              <dt>
                <Icon name="shield" size={17} />
                Leverage
              </dt>
              <dd>1×</dd>
            </div>
            <div>
              <dt>
                <Icon name="wallet" size={17} />
                Session positions
              </dt>
              <dd>{observed ? managed.length : "—"}</dd>
            </div>
            <div>
              <dt>
                <Icon name="users" size={17} />
                Other wallet positions
              </dt>
              <dd>{observed ? other.length : "—"}</dd>
            </div>
          </dl>
          <p className={styles.note}>Other wallet positions stay outside this session.</p>
          {onPositions ? (
            <Button variant="secondary" block onClick={onPositions}>
              <Icon name="target" size={17} />
              View positions
            </Button>
          ) : state?.address ? (
            <ButtonLink href={walletHref} block>
              <Icon name="external" size={17} />
              View wallet positions
            </ButtonLink>
          ) : null}
          {state?.keyExpiresAt && (
            <p className={styles.expiry}>
              <Icon name="key" size={15} />
              Permission until {timestamp(state.keyExpiresAt)}
            </p>
          )}
          {state?.session?.error && (
            <p className={styles.error}>{perplExecutionMessage(state.session.error)}</p>
          )}
        </aside>
      </div>
      <PerplCycleHistory execution={execution} compact />
      {state?.available &&
        !state.setupRequired &&
        !active &&
        state.setupEnabled !== false &&
        !funding && (
          <details className={styles.advanced}>
            <summary>
              <Icon name="coin" size={18} />
              <span>
                Account funding<small>Prepare an additional collateral deposit</small>
              </span>
              <Icon name="chevronDown" size={18} />
            </summary>
            <Button
              variant="secondary"
              disabled={disabled || execution.preview || !state.admissionsEnabled}
              onClick={() => setFunding(true)}
            >
              Add collateral
            </Button>
          </details>
        )}
    </div>
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
  if (!session || !sessionRunning(execution.state)) {
    return null;
  }
  return (
    <div className={styles.actions}>
      <Button
        variant="secondary"
        disabled={disabled || !["active", "paused"].includes(session.status)}
        aria-busy={execution.pendingAction === "pause" || execution.pendingAction === "resume"}
        onClick={() => void execution.control(session.status === "paused" ? "resume" : "pause")}
      >
        <Icon name={session.status === "paused" ? "play" : "pause"} size={17} />
        {execution.pendingAction === "pause"
          ? "Pausing…"
          : execution.pendingAction === "resume"
            ? "Resuming…"
            : session.status === "paused"
              ? "Resume trading"
              : "Pause entries"}
      </Button>
      <Button
        variant="secondary"
        disabled={disabled || session.status === "stopping"}
        aria-busy={execution.pendingAction === "stop"}
        onClick={() => void execution.control("stop")}
      >
        <Icon name={session.status === "stopping" ? "clock" : "x"} size={17} />
        {session.status === "stopping"
          ? "Closing positions…"
          : execution.pendingAction === "stop"
            ? "Stopping…"
            : "Stop & close"}
      </Button>
    </div>
  );
}

export function PerplTradingPositions({
  execution,
  canManage,
  onControls,
}: {
  execution: PerplExecution;
  canManage: boolean;
  onControls?: () => void;
}) {
  const state = execution.state;
  const observed = accountObserved(state);
  const positions = state?.positions.filter((p) => !p.closed) ?? [];
  return (
    <div className={styles.workspace}>
      <PerplAccountSummary execution={execution} />
      <section className={styles.panel} id="perpl-trading-positions" aria-label="Perpl positions">
        <div className={styles.head}>
          <h3 className={styles.title}>
            <Icon name="target" size={21} />
            Open positions
          </h3>
          <span className={styles.note}>
            {observed ? `${positions.length} on Perpl` : "Account not observed"}
          </span>
        </div>
        {!observed ? (
          <AccountNotice execution={execution} onControls={onControls} />
        ) : positions.length === 0 ? (
          <div className={styles.empty}>
            <Icon name="target" size={25} />
            <strong>No open positions confirmed</strong>
            <p className={styles.note}>
              Start one cycle from Controls to follow its opening and closing here.
            </p>
            {onControls && (
              <Button variant="secondary" onClick={onControls}>
                <Icon name="sliders" size={17} />
                Open Controls
              </Button>
            )}
          </div>
        ) : (
          <div className={styles.positionGroups}>
            {[true, false].map((managed) => {
              const rows = positions.filter((p) => !!p.managedBySession === managed);
              return (
                rows.length > 0 && (
                  <section key={String(managed)}>
                    <h4 className={styles.groupTitle}>
                      <Icon name={managed ? "activity" : "users"} size={17} />
                      {managed ? "Managed by this session" : "Other wallet positions"}
                    </h4>
                    <ul className={styles.positionList}>
                      {rows.map((position) => (
                        <li key={position.id} className={styles.position}>
                          <div className={styles.positionName}>
                            <MarketAsset symbol={position.symbol} />
                            <div className={styles.copy}>
                              <strong>{position.symbol}</strong>
                              <span className={styles.positionSide}>
                                <Tag data-side={position.side}>
                                  {position.side === "long" ? "Long" : "Short"}
                                </Tag>
                                <span className={styles.note}>{position.leverage}×</span>
                              </span>
                            </div>
                          </div>
                          <dl className={styles.positionMetrics}>
                            <div>
                              <dt>Margin · AUSD</dt>
                              <dd>{amount(position.collateralAusd)}</dd>
                            </div>
                            <div>
                              <dt>Entry / mark</dt>
                              <dd>
                                {amount(position.entryPrice)} / {amount(position.markPrice)}
                              </dd>
                            </div>
                            <div>
                              <dt>Size</dt>
                              <dd>{amount(position.size)}</dd>
                            </div>
                            <div>
                              <dt>Unrealized P&L · AUSD</dt>
                              <dd>{amount(position.unrealizedPnlAusd)}</dd>
                            </div>
                          </dl>
                          {managed ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={
                                !canManage ||
                                execution.preview ||
                                execution.busy ||
                                state?.session?.status === "stopping"
                              }
                              onClick={() => void execution.control("close")}
                            >
                              <Icon
                                name={state?.session?.status === "stopping" ? "clock" : "x"}
                                size={15}
                              />
                              {state?.session?.status === "stopping"
                                ? "Closing…"
                                : "Close position"}
                            </Button>
                          ) : (
                            <span className={styles.note}>
                              <Icon name="lock" size={14} /> Read only
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              );
            })}
          </div>
        )}
        {state?.observedAt && (
          <p className={styles.note}>
            Last account observation{" "}
            <time dateTime={state.observedAt}>{timestamp(state.observedAt)}</time>
          </p>
        )}
        <ReadNotice execution={execution} />
      </section>
      <PerplCycleHistory execution={execution} compact />
    </div>
  );
}
export function PerplTradingRecord({
  execution,
  compact = false,
  onControls,
}: {
  execution: PerplExecution;
  compact?: boolean;
  onControls?: () => void;
}) {
  return (
    <div className={styles.workspace}>
      {!compact && <PerplAccountSummary execution={execution} />}
      {!compact && !accountObserved(execution.state) && (
        <section className={styles.panel}>
          <AccountNotice execution={execution} onControls={onControls} />
        </section>
      )}
      <PerplCycleHistory
        execution={execution}
        compact={compact}
        onControls={accountObserved(execution.state) ? onControls : undefined}
      />
      <ReadNotice execution={execution} />
    </div>
  );
}
