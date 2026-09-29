"use client";
import { useRouter } from "next/navigation";
import { Button } from "@pickler/ui";
import { useStudioHref } from "@/features/site/studio-href";
import type { Agent } from "../api";
import { gateHref, gateNote } from "./gate";
import styles from "./create.module.css";

/**
 * "+ New agent" while another agent is unfunded: shown instead of the flow, before any passkey
 * prompt, with the way back to the agent that needs funding. The API refuses the create anyway
 * (409 `UNFUNDED_AGENT`); this keeps the person from approving a wallet it would refuse.
 */
export function Locked({ agent }: { agent: Agent }) {
  const router = useRouter();
  const studio = useStudioHref();
  const { title, note } = gateNote(agent);
  return (
    <section className={styles.step} id="create-locked">
      <p className={styles.kicker}>NEW AGENT</p>
      <h1 className={styles.headline} tabIndex={-1}>
        {title}
      </h1>
      <p className={styles.lead}>{note}</p>
      <div className={styles.nav}>
        <Button size="lg" onClick={() => router.push(gateHref(agent, studio))}>
          Fund {agent.name ?? "it"}
        </Button>
      </div>
    </section>
  );
}
