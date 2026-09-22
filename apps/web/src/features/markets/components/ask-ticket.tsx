"use client";

import type { MarketDetailDto } from "@pickler/api-schema";
import { READ_HORIZON_DTO } from "@pickler/api-schema";
import Link from "next/link";
import { ButtonLink, Button } from "@pickler/ui";
import styles from "../markets.module.css";
import { formatLevel, formatPrice } from "../lib/format";
import { levelPrice } from "../lib/ticket";
import type { Square } from "./pick-surface";

interface AskTicketProps {
  detail: MarketDetailDto;
  square: Square | null;
  onStepLevel: (direction: 1 | -1) => void;
  onClear: () => void;
}

/**
 * The other thing a square can be: a question, put to an agent, answered with a probability and
 * the reasoning under it. Violet everywhere, so asking never reads as backing anyone.
 *
 * The grid moves the level of the question and nothing else. Every read still resolves a day out,
 * which is what lets two agents' answers on the same market be compared at all.
 */
export function AskTicket({ detail, square, onStepLevel, onClear }: AskTicketProps) {
  const { market } = detail;
  const covered = market.agentsReading > 0;

  if (!square) {
    return (
      <section className={`${styles.ticket} ${styles.ask}`} aria-labelledby="ticket-title">
        <p className={`${styles.ticketLabel} ${styles.toneAskInk}`}>
          YOUR QUESTION · NOTHING PREPARED
        </p>
        <h2 id="ticket-title" className={styles.ticketTitle}>
          PICK A SQUARE TO ASK.
        </h2>
        <p className={styles.ticketBody}>
          A level becomes one fixed question: will the mark be above it a day from delivery. An
          agent answers with a probability, its reasons and its limits.
        </p>
        <p className={styles.ticketFoot}>Asking never opens a position. Trade does.</p>
      </section>
    );
  }

  const target = formatPrice(levelPrice(market.mark, square.level));

  return (
    <section className={`${styles.ticket} ${styles.ask}`} aria-labelledby="ticket-title">
      <p className={`${styles.ticketLabel} ${styles.toneAskInk}`}>YOUR QUESTION · NOTHING SENT</p>
      <h2 id="ticket-title" className={styles.ticketPhrase}>
        {detail.readQuestion.replace("{level}", target)}
      </h2>
      <p className={styles.ticketRule}>
        RESOLVES ON PERPL MARK · {formatLevel(square.level)} FROM MARK · {READ_HORIZON_DTO} AFTER
        DELIVERY
      </p>

      <div className={styles.steppers}>
        <div className={styles.stepper}>
          <button
            type="button"
            className={styles.stepperButton}
            onClick={() => onStepLevel(-1)}
            aria-label="Lower the level"
          >
            −
          </button>
          <span className={styles.stepperValue}>
            <strong>{target}</strong>
            <span className={styles.microLabel}>LEVEL</span>
          </span>
          <button
            type="button"
            className={styles.stepperButton}
            onClick={() => onStepLevel(1)}
            aria-label="Raise the level"
          >
            +
          </button>
        </div>
      </div>

      {covered ? (
        <div className={styles.actions}>
          <ButtonLink
            as={Link}
            href="/agents"
            variant="secondary"
            block
            arrow
            className={styles.askAction}
          >
            Choose an agent
          </ButtonLink>
          <Button variant="ghost" onClick={onClear}>
            Clear
          </Button>
        </div>
      ) : (
        <>
          <Button block disabled aria-describedby="ask-status">
            No agent covers this market
          </Button>
          <p id="ask-status" className={styles.ticketFoot}>
            Nobody reads {market.symbol} yet, so there is no one to take the question. Trade is
            open, and the agents directory says who covers what.
          </p>
        </>
      )}

      <p className={styles.ticketFoot}>
        Nothing is charged here: paying for a read needs the testnet contracts. Two clocks run when
        it does — delivery, which is refunded if the agent misses its window, and the market a day
        later.
      </p>
    </section>
  );
}
