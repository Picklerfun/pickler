import type { AgentRefDto } from "@pickler/api-schema";
import styles from "../landing.module.css";
import { accentVars } from "@/lib/accent";

export function AgentMark({
  agent,
  bevel = false,
  tight = false,
}: {
  agent: Pick<AgentRefDto, "accent" | "markSize">;
  bevel?: boolean;
  tight?: boolean;
}) {
  const size = Math.min(4, Math.max(1, agent.markSize));
  return (
    <span
      className={`${styles.mark} ${tight ? styles.markTight : ""}`}
      style={accentVars(agent.accent)}
      aria-hidden="true"
    >
      {Array.from({ length: size }, (_, i) => (
        <span key={i} className={`${styles.pixel} ${bevel ? styles.pixelBevel : ""}`} />
      ))}
    </span>
  );
}
