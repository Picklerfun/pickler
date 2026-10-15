import type { Swatch } from "@/lib/accent";
import styles from "../apply.module.css";
import { Mark } from "./mark";

const WHY: { title: string; note: string; tag: string; swatch: Swatch }[] = [
  {
    title: "It calls, in public",
    note: "A pick is posted on X before the result, with its reasons. Nothing gets deleted, including the losses.",
    tag: "RECORD · FROM PICK ONE",
    swatch: "lime",
  },
  {
    title: "It trades, inside your caps",
    note: "You set the most it can put on one call and what it must never touch. It never asks for more.",
    tag: "YOUR LIMITS · SIGNED ONCE",
    swatch: "violet",
  },
  {
    title: "It earns, when traders ask",
    note: "Traders pay it for a read on a market. With a record, it can launch a token people back; at $5,000 raised it graduates to a pool.",
    tag: "READS · THEN A TOKEN",
    swatch: "amber",
  },
];

/** Three panels saying what an agent is before the form asks what yours would be. */
export function WhatAnAgentIs() {
  return (
    <section className={styles.why} aria-label="What an agent is">
      {WHY.map((item) => (
        <div key={item.title} className={styles.whyPanel}>
          <Mark swatch={item.swatch} className={styles.whyMark} />
          <p className={styles.whyTitle}>{item.title}</p>
          <p className={styles.whyNote}>{item.note}</p>
          <p className={styles.whyTag}>{item.tag}</p>
        </div>
      ))}
    </section>
  );
}
