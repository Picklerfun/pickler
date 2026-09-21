"use client";

import type { MarketDetailDto } from "@pickler/api-schema";
import { HORIZON_OPTIONS, LEVEL_OPTIONS, READ_HORIZON_DTO } from "@pickler/api-schema";
import Link from "next/link";
import { useState } from "react";
import { Icon, Segmented } from "@pickler/ui";
import { accentVars } from "@/lib/accent";
import { useServerNow } from "@/lib/now";
import styles from "../markets.module.css";
import { formatChange, formatCompactAusd, formatFunding, formatPrice, plural } from "../lib/format";
import { levelPrice, levelSide, outOfReach, type Side } from "../lib/ticket";
import { AskTicket } from "./ask-ticket";
import { PickSurface, squareBlock, type Square, type SquareBlock } from "./pick-surface";
import type { Preview, TicketActions, TicketState } from "./ticket-state";
import { TradeTicket } from "./trade-ticket";

type Mode = "trade" | "ask";

/**
 * One market, and the two things you can do with it. The surface is shared: the same square is a
 * position under Trade and a question under Ask, which is the whole point of putting them on one
 * page rather than in two products.
 */
export function MarketView({
  detail,
  initialMode,
  nowIso,
}: {
  detail: MarketDetailDto;
  initialMode: Mode;
  nowIso: string;
}) {
  const { market } = detail;
  const now = useServerNow(nowIso);

  const [mode, setMode] = useState<Mode>(initialMode);
  const [square, setSquare] = useState<Square | null>(null);
  const [blocked, setBlocked] = useState<SquareBlock | null>(null);
  const [ticket, setTicket] = useState<TicketState>({
    phase: "ticket",
    preview: null,
    margin: "250",
    leverage: Math.min(5, market.maxLeverage),
  });

  const patch = (next: Partial<TicketState>) => setTicket((current) => ({ ...current, ...next }));

  /** Walk the levels until one is takeable, so a stepper never parks on a refused square. */
  const stepLevel = (direction: 1 | -1) => {
    if (!square) {
      return;
    }
    const from = LEVEL_OPTIONS.indexOf(square.level as (typeof LEVEL_OPTIONS)[number]);
    for (
      let index = from - direction;
      index >= 0 && index < LEVEL_OPTIONS.length;
      index -= direction
    ) {
      const candidate = { level: LEVEL_OPTIONS[index]!, horizon: square.horizon };
      if (!squareBlock(market, candidate, mode)) {
        select(candidate);
        return;
      }
    }
  };

  const stepHorizon = (direction: 1 | -1) => {
    if (!square) {
      return;
    }
    const from = HORIZON_OPTIONS.indexOf(square.horizon);
    for (
      let index = from + direction;
      index >= 0 && index < HORIZON_OPTIONS.length;
      index += direction
    ) {
      const candidate = { level: square.level, horizon: HORIZON_OPTIONS[index]! };
      if (!squareBlock(market, candidate, mode)) {
        select(candidate);
        return;
      }
    }
  };

  /** Mirror the level across the mark, landing on the nearest level the surface actually draws. */
  const setSide = (side: Side) => {
    if (!square || levelSide(square.level) === side) {
      return;
    }
    const wanted = side === "long" ? Math.abs(square.level) : -Math.abs(square.level);
    const nearest = [...LEVEL_OPTIONS]
      .filter((level) => levelSide(level) === side)
      .sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted))[0];
    if (nearest !== undefined && !outOfReach(market, nearest, square.horizon)) {
      select({ level: nearest, horizon: square.horizon });
    }
  };

  function select(next: Square) {
    setSquare(next);
    setBlocked(null);
    patch({ phase: "ticket", preview: null });
  }

  const actions: TicketActions = {
    setMargin: (margin) => patch({ margin }),
    setLeverage: (leverage) => patch({ leverage }),
    setSide,
    stepLevel,
    stepHorizon,
    review: () => patch({ phase: "review" }),
    edit: () => patch({ phase: "ticket" }),
    clear: () => {
      setSquare(null);
      setBlocked(null);
      patch({ phase: "ticket", preview: null });
    },
    preview: (preview: Preview) => patch({ preview }),
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setBlocked(null);
    patch({ phase: "ticket", preview: null });
    // A read only runs over a day, so carrying a four-hour square into Ask would quietly change
    // the question. The level survives the switch; the clock does not.
    if (next === "ask" && square && square.horizon !== READ_HORIZON_DTO) {
      setSquare({ level: square.level, horizon: READ_HORIZON_DTO });
    }
  };

  const asking = mode === "ask";
  const locked = ticket.preview === "sent" || ticket.preview === "open";

  return (
    <main className={styles.main} style={accentVars(market.accent)}>
      <Link href="/markets" className={styles.back}>
        <Icon name="arrowLeft" size={14} /> MARKETS
      </Link>

      <header className={styles.marketHeader}>
        <div>
          <p className={styles.eyebrow}>MARKET · PERPL ON MONAD</p>
          <h1 className={styles.title}>{market.symbol}.</h1>
          <p className={styles.lead}>
            Up is long, down is short, right is more time. Pick a square.
          </p>
        </div>

        <dl className={styles.tiles}>
          <div className={styles.tile}>
            <dt>MARK</dt>
            <dd>
              {formatPrice(market.mark)}{" "}
              <span className={market.change24h < 0 ? styles.toneLoss : styles.toneWin}>
                {formatChange(market.change24h)}
              </span>
            </dd>
          </div>
          <div className={styles.tile}>
            <dt>FUNDING 1H</dt>
            <dd>{formatFunding(market.funding1h)}</dd>
          </div>
          <div className={styles.tile}>
            <dt>OPEN INTEREST</dt>
            <dd>{formatCompactAusd(market.openInterest)}</dd>
          </div>
          <div className={styles.tile}>
            <dt>MAX LEVERAGE</dt>
            <dd>
              {market.maxLeverage}× <span className={styles.tileNote}>ISOLATED</span>
            </dd>
          </div>
        </dl>
      </header>

      <div className={styles.modeRow}>
        <Segmented
          label="What to do with a square"
          className={styles.modes}
          value={mode}
          onChange={(next) => switchMode(next as Mode)}
          options={[
            { value: "ask", label: "Ask an agent" },
            { value: "trade", label: "Trade it yourself" },
          ]}
        />
        <Link href="/agents" className={styles.coverage}>
          {market.agentsReading === 0
            ? "NO AGENT COVERS THIS MARKET YET"
            : `${plural(market.agentsReading, "AGENT")} ${market.agentsReading === 1 ? "COVERS" : "COVER"} THIS MARKET`}{" "}
          <Icon name="arrow" size={13} />
        </Link>
      </div>

      <div className={styles.layout}>
        <div className={styles.surfaceColumn}>
          <PickSurface
            detail={detail}
            mode={mode}
            selection={square}
            locked={locked}
            now={now}
            onPick={select}
            onBlocked={(_, block) => setBlocked(block)}
          />

          <div className={styles.surfaceFoot}>
            <p className={styles.hint}>
              {asking
                ? square
                  ? "Move the level on the grid or with the stepper. The question fixes when you pay."
                  : "Click a square: its level becomes the question. Dots mark squares an agent already has a public call on."
                : square
                  ? "Click another square to move the target, or switch side in the ticket to mirror it below the mark."
                  : "Click a square: above the mark opens a long, below a short. The column is how long you give it."}
            </p>
            <p className={styles.legendLine}>
              <span className={styles.legendDot} aria-hidden="true" />
              AN AGENT HAS A PUBLIC CALL HERE
            </p>
          </div>

          {blocked && (
            <div className={styles.notice} role="status">
              <p className={styles.noticeTitle}>
                {blocked === "reach" ? "Square not available" : "Reads run a day out"}
              </p>
              <p className={styles.noticeBody}>
                {blocked === "reach"
                  ? `At one hour, that level is further than ${market.symbol} has moved in any hour this month. Give it more time or pick a closer level.`
                  : `Every read resolves ${READ_HORIZON_DTO} after delivery, so Ask uses that column. The shorter ones are for a position of your own.`}
              </p>
            </div>
          )}

          {ticket.preview === "open" && square && (
            <div className={styles.openStrip}>
              <span className={styles.previewTag}>DESIGN PREVIEW · NO ORDER EXISTS</span>
              <span className={styles.openPhrase}>
                {levelSide(square.level) === "long" ? "LONG" : "SHORT"} to{" "}
                {formatPrice(levelPrice(market.mark, square.level))} · CLOSES IN {square.horizon}
              </span>
            </div>
          )}
        </div>

        <div className={styles.ticketColumn}>
          {asking ? (
            <AskTicket
              detail={detail}
              square={square}
              onStepLevel={stepLevel}
              onClear={actions.clear}
            />
          ) : (
            <TradeTicket
              market={market}
              square={square}
              now={now}
              state={ticket}
              actions={actions}
            />
          )}

          <aside className={styles.sideNote}>
            <p className={styles.microLabel}>MARK PRICE · ON PERPL</p>
            <p>
              The mark drives PnL, the take profit and liquidation; a fill would come from the book.
              Reads resolve on the mark too, which is what makes an answer and a position
              comparable.
            </p>
          </aside>
        </div>
      </div>
    </main>
  );
}
