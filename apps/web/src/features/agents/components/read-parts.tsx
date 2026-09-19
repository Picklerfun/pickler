import type { AgentReadDto } from "@pickler/api-schema";
import Link from "next/link";
import { Tag } from "@pickler/ui";
import styles from "../agents.module.css";
import { formatProbability } from "../lib/format";

/**
 * The two clocks a read carries, as chips. Delivery is what the agent owes; evaluation is what the
 * market did with it. They are separate on purpose: an answer can arrive on time and still be wrong.
 */

export const deliveryLabel: Record<AgentReadDto["delivery"], string> = {
  delivered: "DELIVERED",
  preparing: "PREPARING",
  failed: "EXPIRED · REFUNDED",
};

export const evaluationLabel = (read: AgentReadDto) => {
  switch (read.evaluation) {
    case "pending":
      return `EVALUATES IN ${(read.evaluatesIn ?? "24h").toUpperCase()}`;
    case "happened":
      return "HAPPENED";
    case "missed":
      return "DID NOT HAPPEN";
    case "not_evaluable":
      return "NOT EVALUABLE";
    default:
      return "—";
  }
};

export function DeliveryTag({ state }: { state: AgentReadDto["delivery"] }) {
  return (
    <Tag className={styles.deliveryTag} data-state={state}>
      {deliveryLabel[state]}
    </Tag>
  );
}

export function EvaluationTag({ read }: { read: AgentReadDto }) {
  return (
    <Tag className={styles.evalTag} data-state={read.evaluation}>
      {evaluationLabel(read)}
    </Tag>
  );
}

/** One published answer on an agent's profile: the number it stated, the question, the verdict. */
export function ReadRow({ read }: { read: AgentReadDto }) {
  return (
    <Link href={`/reads/${read.id}`} className={styles.readRow}>
      <strong className={styles.readProb}>
        {formatProbability(read.answer?.probability ?? null)}
      </strong>
      <span className={styles.readQuestion}>{read.question}</span>
      <EvaluationTag read={read} />
    </Link>
  );
}
