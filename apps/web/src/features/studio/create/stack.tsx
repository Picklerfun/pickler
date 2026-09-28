"use client";
import { ORDER, reviewRows, type Draft, type OrderStep, type ReviewRow, type Step } from "./draft";
import { agentInitials } from "../lib/initials";
import { beatTint, type Tint } from "./map";
import { shortAddress } from "./trace";
import styles from "./create.module.css";

/** Each review row's colour, as the canvas paints its dot and its block. */
export function rowTint(key: ReviewRow["key"], draft: Draft): Tint {
  switch (key) {
    case "name":
      return "lime";
    case "tradesOn":
      return "violet";
    case "calls":
      return beatTint(draft.beat) ?? "blue";
    case "reads":
      return "blue";
    case "skills":
      return "orange";
    case "decides":
      return "amber";
  }
}

const CELLS: Record<ReviewRow["key"], number> = {
  name: 4,
  tradesOn: 2,
  calls: 3,
  reads: 3,
  skills: 2,
  decides: 3,
};

/** Which manual step each row is answered on, so manual mode drops a block only once it is reached. */
const ROW_STEP: Record<ReviewRow["key"], OrderStep> = {
  name: "name",
  tradesOn: "trades",
  calls: "looks",
  reads: "reads",
  skills: "skills",
  decides: "decides",
};

interface Block {
  key: string;
  tint: Tint;
  cells: number;
  value: string;
  label: string;
}

/** Whether a row has anything worth a block yet: the canvas leaves an empty answer out. */
function answered(row: ReviewRow, draft: Draft): boolean {
  switch (row.key) {
    case "name":
      return draft.name.trim().length > 0;
    case "tradesOn":
      return draft.venues.length > 0;
    case "calls":
      return row.value.length > 0;
    case "reads":
      return true;
    case "skills":
      return draft.skills.length + draft.custom.length > 0;
    case "decides":
      return draft.edge.trim().length > 0;
  }
}

/**
 * The piece: the agent taking shape as a stack of blocks, one per answer, then its wallet and its
 * first call once they exist. Nothing here is decoration over missing data — a block appears only
 * for something the draft, the ceremony or the run actually holds.
 */
export function Stack({
  draft,
  step,
  mode,
  revealed,
  wallet,
  call,
  owner,
}: {
  draft: Draft;
  step: Step;
  mode: "auto" | "manual";
  /** On the reading screen, how many rows have been revealed so far. */
  revealed: number;
  wallet: string | null;
  call: string | null;
  owner: string;
}) {
  const rows = reviewRows(draft);
  const at = ORDER.indexOf(step as OrderStep);

  const shown = (row: ReviewRow, index: number): boolean => {
    if (step === "reading") {
      return index < revealed;
    }
    if (step === "start") {
      return false;
    }
    if (mode === "auto" || step === "review" || step === "run") {
      return true;
    }
    return at >= ORDER.indexOf(ROW_STEP[row.key]);
  };

  const blocks: Block[] = rows
    .filter((row, index) => shown(row, index) && answered(row, draft))
    .map((row) => ({
      key: row.key,
      tint: rowTint(row.key, draft),
      cells: CELLS[row.key],
      value: row.key === "name" ? draft.name.trim() : row.value,
      label: row.label,
    }));
  if (wallet) {
    blocks.push({
      key: "wallet",
      tint: "ink",
      cells: 2,
      value: shortAddress(wallet),
      label: "WALLET",
    });
  }
  if (call) {
    blocks.push({ key: "call", tint: "lime", cells: 2, value: call, label: "FIRST CALL" });
  }

  const name = draft.name.trim();
  const markTint = beatTint(draft.beat);

  return (
    <aside className={styles.piece} aria-label="Your agent so far">
      <div className={styles.pieceHead}>
        <span className={styles.pieceMark} data-tint={markTint ?? undefined}>
          {agentInitials(name)}
        </span>
        <span className={styles.pieceWho}>
          <b>{name || "Your agent"}</b>
          <small>{draft.handle ? `@${draft.handle}` : "@handle"}</small>
        </span>
      </div>
      <ol className={styles.stack}>
        {blocks.map((block) => (
          <li key={block.key} className={styles.block}>
            <span className={styles.cells} data-tint={block.tint} aria-hidden="true">
              {Array.from({ length: block.cells }, (_, index) => (
                <i key={index} />
              ))}
            </span>
            <span className={styles.blockValue}>{block.value}</span>
            <span className={styles.blockLabel}>{block.label}</span>
          </li>
        ))}
        {blocks.length === 0 && <li className={styles.stackEmpty}>EVERY ANSWER DROPS A BLOCK</li>}
      </ol>
      <p className={styles.owner}>
        OWNED BY <b>{owner}</b>
      </p>
    </aside>
  );
}
