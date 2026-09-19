"use client";

import type { AgentReadDto } from "@pickler/api-schema";
import Link from "next/link";
import { ButtonLink, Chip } from "@pickler/ui";
import { useMemo, useState } from "react";
import styles from "../agents.module.css";
import { AgentAvatar } from "./agent-parts";
import { ConnectGate } from "@/features/wallet/components/connect-gate";
import { DeliveryTag, EvaluationTag } from "./read-parts";

/** The filters read the two clocks: what is still coming, what landed, what went wrong. */
const FILTERS = [
  { key: "all", label: "ALL", match: () => true },
  { key: "prep", label: "IN PREPARATION", match: (r: AgentReadDto) => r.delivery === "preparing" },
  {
    key: "delivered",
    label: "DELIVERED",
    match: (r: AgentReadDto) => r.delivery === "delivered" && r.evaluation === "pending",
  },
  {
    key: "evaluated",
    label: "EVALUATED",
    match: (r: AgentReadDto) => r.evaluation === "happened" || r.evaluation === "missed",
  },
  {
    key: "issue",
    label: "WITH ISSUE",
    match: (r: AgentReadDto) => r.evaluation === "not_evaluable" || r.delivery === "failed",
  },
] as const;

export function ReadsPage({ reads }: { reads: AgentReadDto[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const shown = useMemo(() => reads.filter(active.match), [reads, active]);

  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>READS</p>
      <h1 className={styles.boardTitle}>WHAT YOU ASKED</h1>
      <p className={styles.boardLead}>Two clocks per read: delivery, then the market.</p>

      <ConnectGate
        title="Connect to see your reads"
        lead="A read belongs to the wallet that paid for it. Connect and this page fills with yours."
      >
        <div className={`${styles.filterCard} ${styles.filterRow}`}>
          <span role="group" aria-label="Read state" className={styles.filterGroup}>
            {FILTERS.map((option) => (
              <Chip
                key={option.key}
                className={styles.sortButton}
                selected={filter === option.key}
                onClick={() => setFilter(option.key)}
              >
                {option.label}{" "}
                <span className={styles.chipCount}>{reads.filter(option.match).length}</span>
              </Chip>
            ))}
          </span>
          <span className={styles.filterSpacer} />
          <ButtonLink as={Link} href="/agents" className={styles.newReadButton} size="sm" mono>
            NEW READ →
          </ButtonLink>
        </div>

        <div className={styles.tableWrap}>
          <div className={`${styles.readsRow} ${styles.tableHead}`}>
            <span className={styles.readsMark} />
            <span className={styles.readsTitle}>READ</span>
            <span className={styles.readsDelivery}>DELIVERY</span>
            <span className={styles.readsMarket}>MARKET</span>
            <span className={styles.readsPaid}>PAID</span>
          </div>
          {shown.map((read) => (
            <Link key={read.id} href={`/reads/${read.id}`} className={styles.readsRow}>
              <span className={styles.readsMark}>
                <AgentAvatar name={read.agent.name} accent={read.agent.accent} small />
              </span>
              <span className={styles.readsTitle}>
                <strong>{read.market} · above at delivery · 24h</strong>
                <span className={styles.quiet}>
                  {read.agent.name} · {read.when}
                </span>
              </span>
              <span className={styles.readsDelivery}>
                <DeliveryTag state={read.delivery} />
              </span>
              <span className={styles.readsMarket}>
                <EvaluationTag read={read} />
              </span>
              <span
                className={`${styles.readsPaid} ${read.delivery === "failed" ? styles.tonePink : ""}`}
              >
                {read.delivery === "failed" ? "−" : ""}${read.paid}
              </span>
            </Link>
          ))}
          {shown.length === 0 && <p className={styles.empty}>Nothing in this state.</p>}
        </div>
      </ConnectGate>
    </main>
  );
}
