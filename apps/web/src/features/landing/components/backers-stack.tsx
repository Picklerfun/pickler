"use client";

import type { LandingResponse } from "@pickler/api-schema";
import { useEffect, useState } from "react";
import styles from "../landing.module.css";
import { formatInteger } from "../lib/format";
import { useAnimationInterval, useLanding, usePrefersReducedMotion } from "../lib/landing-data";
import { AgentMark } from "./agent-mark";

const STACK_CAPACITY = 6;
const DROP_MS = 1700;
const CLEAR_FLASH_MS = 420;

type Deposit = LandingResponse["backing"]["recent"][number];

const depositMeta = (deposit: Deposit) =>
  `${deposit.agent.ticker} · +${formatInteger(deposit.amount)} MON backed`;

export function BackersStack() {
  const { backing } = useLanding().data;
  const deposits = backing.recent;
  const reducedMotion = usePrefersReducedMotion();

  // Positions into `deposits`; the well fills bottom-up, then clears like a completed line.
  const [stack, setStack] = useState<number[]>([0, 1]);
  const [cursor, setCursor] = useState(2);
  const [clearing, setClearing] = useState(false);

  useAnimationInterval(() => {
    if (deposits.length === 0) {
      return;
    }
    if (stack.length >= STACK_CAPACITY) {
      setStack([]);
      setClearing(true);
      return;
    }
    setStack((current) => [...current, cursor]);
    setCursor((c) => c + 1);
  }, DROP_MS);

  useEffect(() => {
    if (!clearing) {
      return;
    }
    const timer = setTimeout(() => setClearing(false), CLEAR_FLASH_MS);
    return () => clearTimeout(timer);
  }, [clearing]);

  const visible = reducedMotion
    ? deposits.slice(0, STACK_CAPACITY)
    : deposits.length === 0
      ? []
      : stack.map((position) => deposits[position % deposits.length]!);
  const next = deposits.length > 0 ? deposits[cursor % deposits.length] : undefined;

  return (
    <div className={styles.backers}>
      <div className={styles.backersHead}>
        <h2 className={styles.label}>BACKERS DEPOSITING</h2>
        <span className={styles.funded}>{formatInteger(backing.fundedTotal)} MON FUNDED</span>
      </div>
      <ul className={styles.well} aria-label="Recent deposits">
        {clearing && (
          <li className={styles.wellClear} aria-hidden="true">
            LINE CLEAR
          </li>
        )}
        {visible.map((deposit, i) => (
          <li key={`${i}-${stack[i] ?? i}`} className={styles.drop}>
            <AgentMark agent={deposit.agent} bevel tight />
            <span className={styles.dropText}>
              <span className={styles.dropName}>{deposit.agent.name}</span>
              <span className={styles.dropMeta}>{depositMeta(deposit)}</span>
            </span>
          </li>
        ))}
      </ul>
      {next && !reducedMotion && <p className={styles.nextLabel}>NEXT · {depositMeta(next)}</p>}
    </div>
  );
}
