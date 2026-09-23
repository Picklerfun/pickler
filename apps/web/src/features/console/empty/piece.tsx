"use client";
import { suggestHandle, tickerOf, type Draft } from "./draft";
import styles from "./empty.module.css";

/**
 * The piece: the agent taking shape as a stack of blocks, one for each answer given.
 *
 * Everything in it is read from the draft, so it is empty until something has been typed. The
 * canvas fills it with a name, a beat, an edge and a first call; the fourth appears only once a
 * real run has returned one, which is why it is passed in rather than assumed.
 */
export function Piece({
  draft,
  beatSwatch,
  call,
  owner,
}: {
  draft: Draft;
  beatSwatch: string;
  call: string;
  owner: string;
}) {
  const name = draft.name.trim();
  const ticker = tickerOf(draft);
  const initials =
    name
      .split(/\s+/)
      .map((word) => word[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  const blocks = [
    name && { swatch: "lime", cells: 4, value: name, label: ticker || "NAME" },
    draft.beat && { swatch: beatSwatch, cells: 3, value: draft.beat, label: "CALLS" },
    draft.why.trim() && { swatch: "amber", cells: 3, value: draft.why.trim(), label: "EDGE" },
    call && { swatch: "violet", cells: 2, value: call, label: "FIRST CALL" },
  ].filter((block): block is { swatch: string; cells: number; value: string; label: string } =>
    Boolean(block),
  );

  return (
    <aside className={styles.piece}>
      <div className={styles.pieceHead}>
        <span className={styles.pieceMark} data-swatch={name ? beatSwatch : "none"}>
          {initials}
        </span>
        <span className={styles.pieceWho}>
          <b>{name || "Your agent"}</b>
          <small>
            <em>{ticker || "$TICKER"}</em> · @{suggestHandle(name) || "handle"}
          </small>
        </span>
      </div>
      <div className={styles.stack}>
        {blocks.length === 0 ? (
          <p className={styles.stackEmpty}>EVERY ANSWER DROPS A BLOCK</p>
        ) : (
          blocks.map((block) => (
            <div key={block.label} className={styles.block} data-swatch={block.swatch}>
              <span className={styles.blockCells} aria-hidden="true">
                {Array.from({ length: block.cells }, (_, index) => (
                  <i key={index} />
                ))}
              </span>
              <span className={styles.blockValue}>{block.value}</span>
              <span className={styles.blockLabel}>{block.label}</span>
            </div>
          ))
        )}
      </div>
      <p className={styles.pieceOwner}>
        OWNED BY <b>{owner}</b>
      </p>
    </aside>
  );
}
