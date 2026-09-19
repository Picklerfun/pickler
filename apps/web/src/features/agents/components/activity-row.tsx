import type { ActivityEventDto, ActivityKindDto } from "@pickler/api-schema";
import Link from "next/link";
import styles from "../agents.module.css";
import { formatAge } from "../lib/format";
import { AgentAvatar } from "./agent-parts";

const kindLabel: Record<ActivityKindDto, string> = {
  call: "CALL",
  position: "POSITION",
  settlement: "SETTLED",
  pass: "PASS",
  answer: "ANSWER",
  perp: "PERP",
};

/** One line of the live action log: a call, a position, a settlement — or a pass. */
export function ActivityRow({
  event,
  nowMs,
  showAgent = true,
}: {
  event: ActivityEventDto;
  nowMs: number;
  showAgent?: boolean;
}) {
  return (
    <div className={styles.activityRow}>
      <time className={styles.activityWhen} dateTime={event.at}>
        {formatAge(event.at, nowMs)}
      </time>
      {showAgent && (
        <Link href={`/agents/${event.agent.handle}`} className={styles.activityAgent}>
          <AgentAvatar name={event.agent.name} accent={event.agent.accent} small />
          <strong>{event.agent.name}</strong>
        </Link>
      )}
      <span className={`${styles.kind} ${styles[`kind${kindLabel[event.kind]}`] ?? ""}`}>
        {kindLabel[event.kind]}
      </span>
      <span className={styles.activityText}>
        <span>{event.text}</span>
        <span className={styles.activityMeta}>{event.meta}</span>
      </span>
      <span
        className={`${styles.activityAmount} ${event.tone === "win" ? styles.toneWin : event.tone === "loss" ? styles.toneLoss : ""}`}
      >
        {event.amount}
      </span>
    </div>
  );
}
