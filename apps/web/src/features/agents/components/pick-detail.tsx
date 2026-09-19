import type { PickDetailDto } from "@pickler/api-schema";
import Link from "next/link";
import { Icon } from "@pickler/ui";
import { accentVars } from "@/lib/accent";
import styles from "../agents.module.css";
import {
  formatAge,
  formatInteger,
  formatProbability,
  formatSignedTwo,
  formatTwo,
  outcomeClass,
} from "../lib/format";

const toneAccent = {
  signal: "cyan",
  agent: "lime",
  caution: "cyan",
  win: "lime",
  loss: "magenta",
} as const;

export function PickDetail({ pick, nowMs }: { pick: PickDetailDto; nowMs: number }) {
  const open = pick.outcome === "open";
  const age = formatAge(pick.calledAt, nowMs).toUpperCase();
  const stake = `${formatTwo(pick.stake)} MON`;
  const result = open
    ? `OPEN · ${stake} AT RISK`
    : pick.outcome === "won"
      ? `WON ${formatSignedTwo(pick.pnl ?? 0)} MON`
      : `LOST ${formatTwo(Math.abs(pick.pnl ?? 0))} MON`;

  const chain = [
    ["Position", pick.chain.positionTx],
    ["Settlement", open ? "pending" : pick.chain.settlementTx],
    ["Agent wallet", pick.chain.agentWallet],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  return (
    <main className={`${styles.main} ${styles.mainNarrow}`}>
      <Link href={`/tokens/${pick.agent.slug}`} className={styles.backLink}>
        <Icon name="arrowLeft" size={14} /> {pick.agent.name.toUpperCase()}
      </Link>

      <article className={`${styles.glass} ${styles.pickCard}`}>
        <div className={styles.pickMeta}>
          <span className={styles.label}>
            CALLED {age} AGO{open ? " · STILL OPEN" : ""}
          </span>
          <span
            className={`${styles.result} ${styles.pickResult} ${styles[outcomeClass[pick.outcome]]}`}
          >
            {result}
          </span>
        </div>
        <h1 className={styles.pickTitle}>{pick.call.toUpperCase()}</h1>
        {pick.thesis && <p className={styles.pickBody}>{pick.thesis}</p>}
        <dl className={styles.receipt}>
          <ReceiptItem label="TOOK IT AT" value={formatProbability(pick.entryPrice)} />
          <ReceiptItem label="SIZE" value={stake} />
          <ReceiptItem
            label="WOULD NOT PAY"
            value={pick.maxPrice === null ? "—" : `ABOVE ${formatProbability(pick.maxPrice)}`}
            className={styles.toneMuted}
          />
          {open ? (
            <ReceiptItem label="RESOLVES" value="NOT YET" className={styles.toneOpen} />
          ) : (
            <ReceiptItem
              label="SETTLED"
              value={`${formatSignedTwo(pick.pnl ?? 0)} MON`}
              className={pick.outcome === "won" ? styles.toneWin : styles.toneLoss}
            />
          )}
        </dl>
      </article>

      <div className={styles.columns}>
        <section className={`${styles.panel} ${styles.trailCard}`} aria-labelledby="trail-title">
          <h2 id="trail-title" className={styles.label}>
            THE TRAIL
          </h2>
          <ol className={styles.trail}>
            {pick.steps.map((step, i) => {
              const last = i === pick.steps.length - 1;
              return (
                <li
                  key={i}
                  className={styles.trailStep}
                  style={accentVars(
                    step.tone === "agent" ? pick.agent.accent : toneAccent[step.tone],
                  )}
                >
                  <span className={styles.trailRail} aria-hidden="true">
                    <span className={styles.trailDot} />
                    <span className={styles.trailLine} />
                  </span>
                  <span className={styles.trailBody}>
                    <span className={styles.trailTitleRow}>
                      <strong>{step.title}</strong>
                      {step.at ? (
                        <time className={styles.trailTime} dateTime={step.at}>
                          {formatAge(step.at, nowMs)} ago
                        </time>
                      ) : (
                        <span className={styles.trailTime}>{last ? "now" : "—"}</span>
                      )}
                    </span>
                    <span className={styles.trailNote}>{step.note}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        <div className={`${styles.sideColumn} ${styles.pickSide}`}>
          {pick.post && (
            <section className={`${styles.panel} ${styles.sideCard}`} aria-labelledby="post-title">
              <h2 id="post-title" className={styles.label}>
                POSTED ON X
              </h2>
              <p className={styles.postText}>“{pick.post.text}”</p>
              <p className={styles.postMeta}>
                {[
                  pick.agent.xHandle,
                  `${formatAge(pick.calledAt, nowMs)} ago`,
                  pick.post.views === null ? null : `${formatInteger(pick.post.views)} views`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                {pick.post.url && (
                  <>
                    {" · "}
                    <a href={pick.post.url} target="_blank" rel="noopener noreferrer">
                      open
                    </a>
                  </>
                )}
              </p>
            </section>
          )}
          {chain.length > 0 && (
            <section className={`${styles.panel} ${styles.sideCard}`} aria-labelledby="chain-title">
              <h2 id="chain-title" className={styles.label}>
                ON CHAIN
              </h2>
              <dl style={{ margin: 0 }}>
                {chain.map(([label, value]) => (
                  <div key={label} className={`${styles.keyValue} ${styles.keyValueText}`}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function ReceiptItem({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string | undefined;
}) {
  return (
    <div className={styles.receiptItem}>
      <dt>{label}</dt>
      <dd className={className}>{value}</dd>
    </div>
  );
}
