import type { AgentReadDto } from "@pickler/api-schema";
import Link from "next/link";
import { ButtonLink, Icon } from "@pickler/ui";
import styles from "../agents.module.css";
import { accentVars } from "@/lib/accent";
import { formatProbability } from "../lib/format";
import { AgentAvatar } from "./agent-parts";
import { DeliveryTag, EvaluationTag } from "./read-parts";

/** What the market did, written on the same card that carried the answer. */
function outcomeCopy(read: AgentReadDto) {
  if (read.delivery === "failed") {
    return {
      title: "NOT DELIVERED",
      sub: `Missed the delivery window. $${read.paid} refunded.`,
      tone: "loss" as const,
    };
  }
  if (read.evaluation === "not_evaluable") {
    return {
      title: "NOT EVALUABLE",
      sub: "No observation inside the tolerance window. Not counted for or against.",
      tone: "curve" as const,
    };
  }
  if (read.evaluation === "happened" || read.evaluation === "missed") {
    return {
      title: read.evaluation === "happened" ? "HAPPENED" : "DID NOT HAPPEN",
      sub: `said ${formatProbability(read.answer?.probability ?? null)} · counted once in its record`,
      tone: read.evaluation === "happened" ? ("win" as const) : ("loss" as const),
    };
  }
  return null;
}

export function ReadCard({ read }: { read: AgentReadDto }) {
  const outcome = outcomeCopy(read);
  const answer = read.answer;

  return (
    <main className={`${styles.main} ${styles.mainNarrow}`} style={accentVars(read.agent.accent)}>
      <div className={styles.readCardNav}>
        <Link href="/reads" className={styles.backLink}>
          <Icon name="arrowLeft" size={14} /> READS
        </Link>
        <Link href={`/agents/${read.agent.handle}`} className={styles.backLink}>
          {read.agent.name.toUpperCase()} <Icon name="arrow" size={14} />
        </Link>
      </div>

      <article className={styles.readCard}>
        <header className={styles.readCardHead}>
          <AgentAvatar name={read.agent.name} accent={read.agent.accent} small />
          <strong>{read.agent.name}</strong>
          <DeliveryTag state={read.delivery} />
          <EvaluationTag read={read} />
          <span className={styles.readCardWhen}>{read.when}</span>
        </header>

        <div className={styles.readCardBody}>
          <p className={styles.label}>THE QUESTION</p>
          <p className={styles.readCardQuestion}>{read.question}</p>

          {answer && (
            <>
              <div className={styles.readAnswer}>
                <span className={styles.readAnswerProb}>
                  <strong>{formatProbability(answer.probability)}</strong>
                  <span className={styles.label}>THAT IT HAPPENS</span>
                </span>
                <dl className={styles.readFacts}>
                  <ReadFact label="REFERENCE" value={answer.reference} />
                  <ReadFact label="ISSUED" value={answer.issuedAt} />
                  <ReadFact label="EVALUATES" value={answer.evaluatesAt} tone={styles.toneOpen} />
                </dl>
              </div>

              <p className={styles.label}>ITS READ</p>
              <p className={styles.readSummary}>{answer.summary}</p>

              <p className={styles.label}>WHY</p>
              <ul className={styles.readReasons}>
                {answer.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>

              <div className={styles.readSplit}>
                <section className={styles.readBox}>
                  <p className={styles.label}>SOURCES</p>
                  <dl className={styles.readSources}>
                    {answer.sources.map((source) => (
                      <div key={source.name}>
                        <dt>{source.name}</dt>
                        <dd>{source.at}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <section className={styles.readBox}>
                  <p className={styles.label}>LIMITS</p>
                  <p className={styles.readLimits}>{answer.limits}</p>
                </section>
              </div>
            </>
          )}

          {outcome && (
            <div className={styles.readOutcome} data-tone={outcome.tone}>
              <span>
                <strong>{outcome.title}</strong>
                <span className={styles.quiet}>{outcome.sub}</span>
              </span>
              {read.outcome && (
                <dl className={styles.readFacts}>
                  <ReadFact label="FINAL" value={read.outcome.final} />
                  <ReadFact label="OBSERVED" value={read.outcome.observedAt} />
                </dl>
              )}
            </div>
          )}
        </div>

        {read.delivery === "delivered" && read.evaluation === "pending" && (
          <footer className={styles.readCardFoot}>
            <ButtonLink
              as={Link}
              href={`/agents/${read.agent.handle}/ask`}
              variant="secondary"
              size="sm"
            >
              Ask it another
            </ButtonLink>
            <span className={styles.quiet}>another market is a new read</span>
          </footer>
        )}
      </article>
    </main>
  );
}

function ReadFact({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string | undefined;
}) {
  return (
    <div>
      <dd className={tone}>{value}</dd>
      <dt className={styles.label}>{label}</dt>
    </div>
  );
}
