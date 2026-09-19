"use client";
import type { Run, RunEvent } from "./api";
import styles from "./console.module.css";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
function sourceLinks(events: RunEvent[]) {
  const sources = new Map<string, { title: string; url: string }>();
  function visit(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const obj = record(value);
    if (typeof obj.url === "string") {
      try {
        const url = new URL(obj.url);
        if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) {
          sources.set(url.href, {
            url: url.href,
            title: typeof obj.title === "string" ? obj.title : url.hostname,
          });
        }
      } catch {
        /* Invalid historical links remain in the evidence details. */
      }
    }
    for (const child of Object.values(obj)) {
      if (child && typeof child === "object") {
        visit(child);
      }
    }
  }
  events
    .filter((e) => ["source", "search", "sports_evidence", "odds_evidence"].includes(e.type))
    .forEach((e) => visit(e.data));
  return [...sources.values()];
}
export function RunDetail({ run, events }: { run: Run; events: RunEvent[] }) {
  const decision = run.decision;
  const seconds =
    run.startedAt && run.finishedAt ? Math.round((run.finishedAt - run.startedAt) / 1000) : null;
  return (
    <section className={styles.panel}>
      <h2>Research result</h2>
      <p>
        {run.status.toUpperCase()}
        {seconds !== null ? ` · ${seconds} seconds` : ""}
      </p>
      {run.error && (
        <p role="alert" className={styles.error}>
          Technical failure: {run.error}. This is not an abstention.
        </p>
      )}
      {decision && (
        <>
          <h3>
            {decision.action === "ABSTAIN" ? "Abstain" : "Trade proposal"} · {decision.outcomeId}
          </h3>
          <p>{decision.thesis}</p>
          {decision.abstentionReason && <p>Reason: {decision.abstentionReason}</p>}
          <p>Contrary evidence: {decision.counterEvidence}</p>
          <p>Uncertainty: {decision.uncertainty}</p>
          {"forecast" in decision && (
            <div>
              <h3>Forecast</h3>
              {decision.forecast.probability ? (
                <p>
                  Estimated probability: {Math.round(decision.forecast.probability.estimate * 100)}%
                  (range {Math.round(decision.forecast.probability.lower * 100)}–
                  {Math.round(decision.forecast.probability.upper * 100)}%).
                </p>
              ) : (
                <p>{decision.forecast.inabilityReason ?? "Not enough evidence to estimate."}</p>
              )}
            </div>
          )}
          {"policyEvaluation" in decision && (
            <p>Policy checks: {decision.policyEvaluation.reasonCodes.join(", ") || "Passed"}</p>
          )}
          <p>A proposal does not place an order. Results remain private.</p>
        </>
      )}
      <h3>Sources</h3>
      <ul className={styles.sources}>
        {sourceLinks(events).map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.title}
            </a>
          </li>
        ))}
      </ul>
      {events
        .filter((e) => e.type === "model_usage" || e.type === "selection")
        .map((e) => (
          <details key={e.id}>
            <summary>
              {e.type === "selection"
                ? "Market selection and reported usage"
                : "Reported model usage"}
            </summary>
            <pre className={styles.details}>{JSON.stringify(e.data, null, 2)}</pre>
          </details>
        ))}
      <details>
        <summary>Decision, coverage and policy details</summary>
        <pre className={styles.details}>{JSON.stringify(decision, null, 2)}</pre>
      </details>
      <details>
        <summary>Evidence and execution events ({events.length})</summary>
        <pre className={styles.details}>{JSON.stringify(events, null, 2)}</pre>
      </details>
    </section>
  );
}
