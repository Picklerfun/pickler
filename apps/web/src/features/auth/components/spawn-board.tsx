"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import styles from "../auth.module.css";
import type { AuthBoardData } from "../lib/board-data";
import { shapeForAccent } from "../lib/shapes";
import { Shape } from "./shape";

const DROP_MS = 1900;
const CAPACITY = 6;

export function SpawnBoard({ board }: { board: AuthBoardData }) {
  const items = board.deposits;
  const [state, setState] = useState({
    stack: items.length > 1 ? [0, 1] : items.length ? [0] : [],
    cursor: Math.min(2, items.length),
    clearing: false,
  });
  const { stack, cursor, clearing } = state;

  useEffect(() => {
    if (items.length === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timer = setInterval(() => {
      setState((prev) =>
        prev.stack.length >= CAPACITY
          ? { stack: [], cursor: prev.cursor, clearing: true }
          : { stack: [...prev.stack, prev.cursor], cursor: prev.cursor + 1, clearing: false },
      );
    }, DROP_MS);
    return () => clearInterval(timer);
  }, [items.length]);

  useEffect(() => {
    if (!clearing) {
      return;
    }
    const timer = setTimeout(() => setState((prev) => ({ ...prev, clearing: false })), 420);
    return () => clearTimeout(timer);
  }, [clearing]);

  const next = items.length ? items[cursor % items.length] : undefined;

  return (
    <aside className={styles.board} aria-label="Agents on the testnet">
      <div className={styles.boardHead}>
        <Image
          src="/brand/mascot.webp"
          alt=""
          width={1000}
          height={834}
          className={styles.mascotSmall}
          unoptimized
        />
        <span>
          <span className={styles.liveRow}>
            <span className={styles.liveDot} aria-hidden="true" />
            AGENTS SPAWNING
          </span>
          <span className={styles.bigNumber}>{board.agentsCreated.toLocaleString("en-US")}</span>
          <span className={styles.smallNote}>built on testnet so far</span>
        </span>
      </div>
      <div className={styles.boardBody}>
        <div className={styles.monoRow}>
          <span>LANDING NOW</span>
          <span>{board.fundedTotal.toLocaleString("en-US")} MON BACKED</span>
        </div>
        <ul className={styles.well} aria-label="Recent agents">
          {clearing && (
            <li className={styles.wellClear} aria-hidden="true">
              LINE CLEAR
            </li>
          )}
          {stack.map((position, i) => {
            const item = items[position % items.length]!;
            return (
              <li key={`${i}-${position}`} className={styles.drop}>
                <Shape shape={shapeForAccent(item.accent)} accent={item.accent} />
                <span className={styles.dropText}>
                  <strong>{item.name}</strong>
                  <span>{item.meta}</span>
                </span>
              </li>
            );
          })}
        </ul>
        {next && (
          <p className={styles.nextLabel}>
            NEXT · {next.name} · {next.meta}
          </p>
        )}
      </div>
      <p className={styles.boardFoot}>
        Free on testnet. Your first agent takes about two minutes — and it only ever spends what you
        fund.
      </p>
    </aside>
  );
}
