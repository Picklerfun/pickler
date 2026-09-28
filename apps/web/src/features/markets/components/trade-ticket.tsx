"use client";

import type { PerpMarketDto } from "@pickler/api-schema";
import { PERP_LIMITS_DTO } from "@pickler/api-schema";
import Link from "next/link";
import { Button, ButtonLink, Chip, Icon, Segmented } from "@pickler/ui";
import { useWallet } from "@/features/wallet/lib/wallet-context";
import { TARGET_CHAIN } from "@/features/wallet/lib/provider";
import styles from "../markets.module.css";
import { formatAmount, formatAusd, formatClose, formatPrice } from "../lib/format";
import { closesAt, leverageChoices, positionPhrase, quoteTicket, triggerRule } from "../lib/ticket";
import type { Square } from "./pick-surface";
import type { TicketActions, TicketState } from "./ticket-state";
import { PreviewTag } from "./ticket-state";

const QUICK_MARGINS = [100, 250, 500];

interface TradeTicketProps {
  market: PerpMarketDto;
  square: Square | null;
  now: number;
  state: TicketState;
  actions: TicketActions;
}

/**
 * The position side of a market: what the square would cost, what it would return, and what would
 * end it. It is built in full and then stops, because Perpl's contracts are not deployed and this
 * site's wallet never signs — so the last button carries the reason instead of a transaction.
 */
export function TradeTicket({ market, square, now, state, actions }: TradeTicketProps) {
  if (state.preview) {
    return <PreviewTicket market={market} square={square} state={state} actions={actions} />;
  }

  if (!square) {
    return <EmptyTicket />;
  }

  const quote = quoteTicket({
    market,
    level: square.level,
    margin: Number.parseFloat(state.margin) || 0,
    leverage: state.leverage,
  });
  const target = formatPrice(quote.target);
  const phrase = positionPhrase(market.symbol, quote.side, target, square.horizon);

  if (state.phase === "review") {
    return (
      <section className={`${styles.ticket} ${styles[quote.side]}`} aria-labelledby="ticket-title">
        <p className={styles.ticketLabel}>REVIEW · THREE ORDERS, ONE SIGNATURE</p>
        <h2 id="ticket-title" className={styles.ticketTitle}>
          {quote.side === "long" ? "LONG" : "SHORT"} {market.symbol} · {state.leverage}×
        </h2>

        <ol className={styles.orders}>
          <li className={styles.order}>
            <span className={styles.orderNumber}>1</span>
            <span>
              <strong>
                Open {quote.side} · {quote.size.toFixed(4)} {market.base}
              </strong>
              <span className={styles.orderRule}>
                MARKET · IMMEDIATE-OR-CANCEL · SLIPPAGE CAP{" "}
                {(PERP_LIMITS_DTO.slippageCap * 100).toFixed(1)} % · {formatAmount(quote.notional)}{" "}
                AUSD AT {state.leverage}×
              </span>
            </span>
          </li>
          <li className={styles.order}>
            <span className={styles.orderNumber}>2</span>
            <span>
              <strong>Take profit at {target}</strong>
              <span className={styles.orderRule}>
                TRIGGER ON PERPL · {triggerRule(quote.side, target)} · CLOSES THE WHOLE POSITION
              </span>
            </span>
          </li>
          <li className={`${styles.order} ${styles.orderOurs}`}>
            <span className={styles.orderNumber}>3</span>
            <span>
              <strong>
                Close at {formatClose(closesAt(now, square.horizon), new Date(now))} if still open
              </strong>
              <span className={styles.orderRule}>
                PICKLER RULE · NOT ON THE BOOK · SENT AS A MARKET CLOSE AT THAT TIME
              </span>
            </span>
          </li>
        </ol>

        <Figures market={market} quote={quote} leverage={state.leverage} />

        <SendAction
          label={`Sign and send · ${formatAmount(quote.required - quote.fee)} AUSD`}
          onEdit={actions.edit}
        />
        <Preview actions={actions} />
      </section>
    );
  }

  return (
    <section className={`${styles.ticket} ${styles[quote.side]}`} aria-labelledby="ticket-title">
      <p className={styles.ticketLabel}>YOUR POSITION · NOTHING SENT</p>

      <Segmented
        label="Side"
        tone="lime"
        className={styles.sideToggle}
        value={quote.side}
        onChange={(side) => actions.setSide(side as "long" | "short")}
        options={[
          {
            value: "long",
            label: (
              <>
                <Icon name="arrowUp" size={14} /> Long · up
              </>
            ),
          },
          {
            value: "short",
            label: (
              <>
                <Icon name="arrowDown" size={14} /> Short · down
              </>
            ),
          },
        ]}
      />

      <h2 id="ticket-title" className={styles.ticketPhrase} data-face="body">
        {phrase}
      </h2>
      <p className={styles.ticketRule}>
        {quote.side === "long" ? "UP · LONG" : "DOWN · SHORT"} · TAKE PROFIT {target} · CLOSES BY{" "}
        {formatClose(closesAt(now, square.horizon), new Date(now))}
      </p>

      <div className={styles.steppers}>
        <Stepper
          label="TAKE PROFIT"
          value={target}
          onDown={() => actions.stepLevel(-1)}
          onUp={() => actions.stepLevel(1)}
          name="level"
        />
        <Stepper
          label="TIME"
          value={square.horizon}
          onDown={() => actions.stepHorizon(-1)}
          onUp={() => actions.stepHorizon(1)}
          name="time"
        />
      </div>

      <div className={styles.marginRow}>
        <span className={styles.microLabel}>MARGIN</span>
        <input
          className={styles.marginInput}
          inputMode="decimal"
          aria-label="Margin in AUSD"
          placeholder="0.00"
          value={state.margin}
          onChange={(event) => actions.setMargin(event.target.value.replace(/[^0-9.]/g, ""))}
        />
        <span className={styles.marginUnit}>AUSD</span>
      </div>

      <div className={styles.quickRow} role="group" aria-label="Margin">
        {QUICK_MARGINS.map((amount) => (
          <Chip
            key={amount}
            className={styles.quickChip}
            selected={Number.parseFloat(state.margin) === amount}
            onClick={() => actions.setMargin(String(amount))}
          >
            {amount}
          </Chip>
        ))}
      </div>

      <div>
        <p className={styles.leverageHead}>
          <span>LEVERAGE</span>
          <span>MAX {market.maxLeverage}× · SET BY THE MARKET</span>
        </p>
        <div className={styles.quickRow} role="group" aria-label="Leverage">
          {leverageChoices(market).map((choice) => (
            <Chip
              key={choice}
              className={styles.quickChip}
              selected={state.leverage === choice}
              onClick={() => actions.setLeverage(choice)}
            >
              {choice}×
            </Chip>
          ))}
        </div>
      </div>

      <Figures market={market} quote={quote} leverage={state.leverage} />

      <ReviewAction
        ready={quote.notional > 0}
        label={`Review ${quote.side} · ${formatAmount(quote.required - quote.fee)} AUSD`}
        holding={phrase}
        onReview={actions.review}
        onClear={actions.clear}
      />
      <Preview actions={actions} />
    </section>
  );
}

function EmptyTicket() {
  return (
    <section className={styles.ticket} aria-labelledby="ticket-title">
      <p className={styles.ticketLabel}>YOUR POSITION · NOTHING PREPARED</p>
      <h2 id="ticket-title" className={styles.ticketTitle}>
        PICK A SQUARE.
      </h2>
      <ul className={styles.legend}>
        <li>
          <span className={`${styles.legendMark} ${styles.legendLong}`} aria-hidden="true" />A
          square above the mark is a <strong className={styles.toneWin}>long</strong>. You think it
          goes up to that level.
        </li>
        <li>
          <span className={`${styles.legendMark} ${styles.legendShort}`} aria-hidden="true" />A
          square below is a <strong className={styles.toneLoss}>short</strong>. You think it goes
          down to it.
        </li>
        <li>
          <span className={`${styles.legendMark} ${styles.legendTime}`} aria-hidden="true" />
          The column is how long you give it. Hit the level and it takes profit; run out of time and
          Pickler closes it.
        </li>
      </ul>
      <p className={styles.ticketFoot}>
        The same squares the agents post their calls on. A dot marks one.
      </p>
    </section>
  );
}

function Figures({
  market,
  quote,
  leverage,
}: {
  market: PerpMarketDto;
  quote: ReturnType<typeof quoteTicket>;
  leverage: number;
}) {
  return (
    <dl className={styles.figures}>
      <div>
        <dt>SIZE</dt>
        <dd>
          {quote.size.toFixed(4)} {market.base} · {formatAusd(quote.notional)}
        </dd>
      </div>
      <div>
        <dt>IF IT HITS THE LEVEL</dt>
        <dd className={styles.toneWin}>+{formatAusd(quote.winIfHit)}</dd>
      </div>
      <div>
        <dt>LIQUIDATION ≈ · MAINT. {(PERP_LIMITS_DTO.maintenanceMargin * 100).toFixed(0)} %</dt>
        <dd className={styles.toneLoss}>{formatPrice(quote.liquidation)}</dd>
      </div>
      <div>
        <dt>FEE · TAKER, OPEN ONLY</dt>
        <dd>
          {formatAusd(quote.fee)} · {(PERP_LIMITS_DTO.takerFee * 100).toFixed(2)} %
        </dd>
      </div>
      <div>
        <dt>FUNDING · HOURLY, BOTH WAYS</dt>
        <dd>±{(Math.abs(market.funding1h) * 100).toFixed(4)} % OF SIZE</dd>
      </div>
      <div className={styles.srOnly}>
        <dt>LEVERAGE</dt>
        <dd>{leverage}×</dd>
      </div>
    </dl>
  );
}

function Stepper({
  label,
  value,
  onDown,
  onUp,
  name,
}: {
  label: string;
  value: string;
  onDown: () => void;
  onUp: () => void;
  name: string;
}) {
  return (
    <div className={styles.stepper}>
      <button
        type="button"
        className={styles.stepperButton}
        onClick={onDown}
        aria-label={`Lower the ${name}`}
      >
        −
      </button>
      <span className={styles.stepperValue}>
        <strong>{value}</strong>
        <span className={styles.microLabel}>{label}</span>
      </span>
      <button
        type="button"
        className={styles.stepperButton}
        onClick={onUp}
        aria-label={`Raise the ${name}`}
      >
        +
      </button>
    </div>
  );
}

/**
 * The first live action is the wallet's, exactly as on an agent's page: connecting is a read and it
 * works today. Reviewing is ours and costs nothing. Only the send needs a contract that does not
 * exist, and that is the one that stays off.
 */
function ReviewAction({
  ready,
  label,
  holding,
  onReview,
  onClear,
}: {
  ready: boolean;
  label: string;
  /** The position being prepared, held up by the chooser so it survives connecting. */
  holding: string;
  onReview: () => void;
  onClear: () => void;
}) {
  const wallet = useWallet();

  if (wallet.status !== "connected") {
    return (
      <>
        <Button
          block
          onClick={() => wallet.connect(holding)}
          disabled={wallet.status === "connecting"}
        >
          {wallet.status === "connecting" ? "Waiting for your wallet…" : "Connect wallet"}
        </Button>
        <p className={styles.ticketFoot}>
          Connecting only tells the site which address to price this for. Nothing is signed.
        </p>
      </>
    );
  }

  if (!wallet.onTargetChain) {
    return (
      <>
        <Button block onClick={() => void wallet.switchChain()}>
          Switch to {TARGET_CHAIN.name}
        </Button>
        <p className={styles.ticketFoot}>Perpl settles on {TARGET_CHAIN.name}.</p>
      </>
    );
  }

  return (
    <>
      <div className={styles.actions}>
        <Button variant="secondary" block arrow disabled={!ready} onClick={onReview}>
          {ready ? label : "Enter a margin"}
        </Button>
        <Button variant="ghost" onClick={onClear}>
          Clear
        </Button>
      </div>
      <p className={styles.ticketFoot}>
        Nothing is sent yet. The fill would come from the book; PnL and liquidation follow the mark.
      </p>
    </>
  );
}

/** The end of the line today: the order is complete and there is nothing to send it to. */
function SendAction({ label, onEdit }: { label: string; onEdit: () => void }) {
  return (
    <>
      <div className={styles.actions}>
        <Button block disabled aria-describedby="send-status">
          {label}
        </Button>
        <Button variant="ghost" onClick={onEdit}>
          Edit
        </Button>
      </div>
      <p id="send-status" className={styles.ticketFoot}>
        Sending opens with the Perpl contracts on {TARGET_CHAIN.name}. Nothing is charged today, and
        this site&rsquo;s wallet connection reads your account — it never signs.
      </p>
    </>
  );
}

/**
 * What the ticket would look like after a real send. These are drawings, not state: no order
 * exists, so each one says so on its face rather than letting a figure pass for a position.
 */
function Preview({ actions }: { actions: TicketActions }) {
  return (
    <div className={styles.previewBar}>
      <p className={styles.microLabel}>DESIGN PREVIEW · NOTHING ON CHAIN</p>
      <div className={styles.previewChips}>
        <Chip className={styles.quickChip} onClick={() => actions.preview("noaccount")}>
          No Perpl account
        </Chip>
        <Chip className={styles.quickChip} onClick={() => actions.preview("sent")}>
          Sent
        </Chip>
        <Chip className={styles.quickChip} onClick={() => actions.preview("open")}>
          Filled
        </Chip>
        <Chip className={styles.quickChip} onClick={() => actions.preview("nofill")}>
          Not filled
        </Chip>
      </div>
    </div>
  );
}

function PreviewTicket({
  market,
  square,
  state,
  actions,
}: {
  market: PerpMarketDto;
  square: Square | null;
  state: TicketState;
  actions: TicketActions;
}) {
  const level = square?.level ?? 1;
  const horizon = square?.horizon ?? "4H";
  const quote = quoteTicket({
    market,
    level,
    margin: Number.parseFloat(state.margin) || 0,
    leverage: state.leverage,
  });
  const target = formatPrice(quote.target);
  const phrase = positionPhrase(market.symbol, quote.side, target, horizon);
  const back = (
    <Button variant="ghost" block onClick={() => actions.preview(null)}>
      Leave the preview
    </Button>
  );

  if (state.preview === "noaccount") {
    return (
      <section className={`${styles.ticket} ${styles.warn}`} aria-labelledby="ticket-title">
        <PreviewTag />
        <p className={`${styles.ticketLabel} ${styles.toneWarn}`}>PERPL ACCOUNT · NONE YET</p>
        <h2 id="ticket-title" className={styles.ticketTitle}>
          ONE DEPOSIT OPENS IT.
        </h2>
        <p className={styles.ticketBody}>
          A wallet is not an account: Perpl trades from an on-chain account with its own collateral,
          and the first deposit is what creates it. After that this ticket would send as usual.
        </p>
        <dl className={styles.figures}>
          <div>
            <dt>KEPT</dt>
            <dd>{phrase}</dd>
          </div>
          <div>
            <dt>MINIMUM TO OPEN</dt>
            <dd>{formatAusd(PERP_LIMITS_DTO.minimumDeposit)}</dd>
          </div>
          <div>
            <dt>THIS TICKET NEEDS</dt>
            <dd>{formatAusd(quote.required)}</dd>
          </div>
        </dl>
        <p className={styles.ticketFoot}>
          Two signatures when it is real: approve, then create the account with the deposit.
          Withdrawals always need your wallet.
        </p>
        {back}
      </section>
    );
  }

  if (state.preview === "sent") {
    return (
      <section className={styles.ticket} aria-labelledby="ticket-title">
        <PreviewTag />
        <p className={styles.ticketLabel}>
          <span className={`${styles.pulse} ${styles.pulseCyan}`} aria-hidden="true" />
          SENT · WAITING ON THE BOOK
        </p>
        <h2 id="ticket-title" className={styles.ticketTitle}>
          ORDER IN FLIGHT.
        </h2>
        <p className={styles.ticketBody}>
          {phrase}. You could leave the page — the fill, or the no-fill, would land in Portfolio
          with the real figures.
        </p>
        <dl className={styles.figures}>
          <div>
            <dt>MARGIN LOCKED</dt>
            <dd>{formatAusd(quote.required - quote.fee)}</dd>
          </div>
          <div>
            <dt>STATUS</dt>
            <dd>PENDING</dd>
          </div>
        </dl>
        <div className={styles.actions}>
          <Button variant="secondary" block onClick={() => actions.preview("open")}>
            Preview a fill
          </Button>
          <Button variant="secondary" block onClick={() => actions.preview("nofill")}>
            Preview no fill
          </Button>
        </div>
        {back}
      </section>
    );
  }

  if (state.preview === "open") {
    return (
      <section className={`${styles.ticket} ${styles.long}`} aria-labelledby="ticket-title">
        <PreviewTag />
        <p className={`${styles.ticketLabel} ${styles.toneWin}`}>
          <span className={`${styles.pulse} ${styles.pulseLime}`} aria-hidden="true" />
          FILLED · TAKER
        </p>
        <h2 id="ticket-title" className={styles.ticketTitle}>
          {quote.side === "long" ? "LONG" : "SHORT"} IS OPEN.
        </h2>
        <p className={styles.ticketBody}>
          The take profit would live on Perpl; the time close is Pickler&rsquo;s and runs a
          countdown.
        </p>
        <dl className={styles.figures}>
          <div>
            <dt>SIZE</dt>
            <dd>
              {quote.size.toFixed(4)} {market.base} · {state.leverage}×
            </dd>
          </div>
          <div>
            <dt>TAKE PROFIT · ON BOOK</dt>
            <dd>{target}</dd>
          </div>
          <div>
            <dt>TIME CLOSE · PICKLER</dt>
            <dd>IN {horizon}</dd>
          </div>
          <div>
            <dt>LIQUIDATION</dt>
            <dd className={styles.toneLoss}>{formatPrice(quote.liquidation)}</dd>
          </div>
          <div>
            <dt>FEE PAID · OPEN</dt>
            <dd>{formatAusd(quote.fee)}</dd>
          </div>
        </dl>
        <div className={styles.actions}>
          <ButtonLink as={Link} href="/portfolio" variant="secondary" block arrow>
            Portfolio
          </ButtonLink>
        </div>
        {back}
      </section>
    );
  }

  return (
    <section className={`${styles.ticket} ${styles.short}`} aria-labelledby="ticket-title">
      <PreviewTag />
      <p className={`${styles.ticketLabel} ${styles.toneLoss}`}>
        NOT FILLED · CANCELLED BY THE BOOK
      </p>
      <h2 id="ticket-title" className={styles.ticketTitle}>
        NOTHING OPENED.
      </h2>
      <p className={styles.ticketBody}>
        No size inside the {(PERP_LIMITS_DTO.slippageCap * 100).toFixed(1)} % slippage cap, so the
        immediate-or-cancel would expire. The margin returns and nothing is charged.
      </p>
      <dl className={styles.figures}>
        <div>
          <dt>REASON</dt>
          <dd>IOC · NO FILL INSIDE CAP</dd>
        </div>
        <div>
          <dt>CHARGED</dt>
          <dd>{formatAusd(0)}</dd>
        </div>
      </dl>
      {back}
    </section>
  );
}
