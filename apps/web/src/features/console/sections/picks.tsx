"use client";
import { useEffect, useState } from "react";
import { Button, Icon } from "@pickler/ui";
import { consoleApi, type PaperOrder, type Run, type RunEvent } from "../api";
import { clock, decisionView, percent, signed, two, type DecisionView } from "../decision";
import styles from "../studio.module.css";

/**
 * The market as the run saw it. The decision stores an id, not a question, so the human name is
 * recovered from the trace when a tool reported one.
 *
 * The name is only used when the object carrying it also carries this market's id. A run may touch
 * several markets while it discovers one, and a heading that confidently names the wrong game is
 * worse than the id it replaced.
 */
function marketTitle(events: RunEvent[], marketId: string): string {
  let found = "";
  function visit(value: unknown) {
    if (found || !value || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    const belongs = String(record.marketId ?? record.id ?? "") === marketId;
    if (belongs) {
      for (const key of ["question", "title", "name"]) {
        if (typeof record[key] === "string" && (record[key] as string).length > 6) {
          found = record[key] as string;
          return;
        }
      }
    }
    Object.values(record).forEach(visit);
  }
  events
    .filter((event) => /market|selection|rules/i.test(event.type))
    .forEach((event) => visit(event.data));
  return found || `Market ${marketId}`;
}

/** Any source id the trace also gave a URL for becomes a link; the rest stay as plain marks. */
function sourceLinks(events: RunEvent[]): Map<string, string> {
  const links = new Map<string, string>();
  function visit(value: unknown) {
    if (!value || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.id === "string" && typeof record.url === "string") {
      try {
        const url = new URL(record.url);
        if (["http:", "https:"].includes(url.protocol) && !url.username) {
          links.set(record.id, url.href);
        }
      } catch {
        /* A malformed historical link stays out of the list rather than breaking the page. */
      }
    }
    Object.values(record).forEach(visit);
  }
  events.forEach((event) => visit(event.data));
  return links;
}

function Forecast({ view }: { view: DecisionView }) {
  const { probability: band } = view;
  return (
    <section className={styles.card}>
      <div className={styles.detailHead}>
        FORECAST
        {view.uncertaintyLevel && (
          <span className={styles.badge} data-tint={view.uncertaintyTint}>
            UNCERTAINTY {view.uncertaintyLevel}
          </span>
        )}
        <span className={styles.stamp}>width {two(view.width)}</span>
      </div>
      {band ? (
        <>
          <div className={styles.axis}>
            <span className={styles.axisLine} />
            <span
              className={styles.axisBand}
              style={{ left: percent(band.lower), width: percent(band.upper - band.lower) }}
            />
            <span className={styles.axisEstimate} style={{ left: percent(band.estimate) }} />
            {view.observedPrice !== null && (
              <span
                className={styles.axisPrice}
                style={{ left: percent(view.observedPrice) }}
                title="Observed market price"
              />
            )}
            <span className={styles.axisEnd}>0</span>
            <span className={styles.axisEnd} data-side="end">
              1.00
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.key} data-tint="cyan" data-fill="true">
              <span className={styles.keyBand} />
              {two(band.lower)} – {two(band.upper)}
            </span>
            <span className={styles.key} data-tint="cyan">
              <span className={styles.keyTick} />
              estimate {two(band.estimate)}
            </span>
            {view.observedPrice !== null && (
              <span className={styles.key} data-tint="lime">
                <span className={styles.keyDiamond} />
                market {two(view.observedPrice)} · limit {two(view.limitPrice)}
              </span>
            )}
            <span className={styles.key}>
              margin{" "}
              <b className={styles.keyValue} data-ok={view.marginOk}>
                {signed(view.margin)}
              </b>
            </span>
          </div>
        </>
      ) : (
        <p className={styles.empty}>
          No probability returned.{" "}
          {view.inabilityReason || "The model did not say why it could not estimate one."}
        </p>
      )}
      {view.missing.length > 0 && (
        <div>
          <p className={styles.subhead}>WHAT IT DID NOT KNOW</p>
          <ul className={styles.bullets}>
            {view.missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Policy({ view }: { view: DecisionView }) {
  return (
    <section className={styles.card}>
      <div className={styles.detailHead}>
        POLICY
        <span className={styles.policyLine}>
          model said{" "}
          <strong data-tint={view.modelAction === "TRADE" ? "lime" : "grey"}>
            {view.modelAction}
          </strong>{" "}
          · policy said{" "}
          <strong
            data-tint={view.finalAction === "TRADE" ? "lime" : view.overridden ? "magenta" : "grey"}
          >
            {view.finalAction}
          </strong>
        </span>
        {view.policyVersion && (
          <span className={styles.stamp}>
            v{view.policyVersion} · {clock(Date.parse(view.evaluatedAt) || null)}
          </span>
        )}
      </div>
      {view.codes.length > 0 ? (
        <div className={styles.reasons}>
          {view.codes.map((reason) => (
            <div key={reason.code} className={styles.reason} data-tint={reason.tint}>
              <Icon name={reason.code === "MODEL_ABSTAINED" ? "pause" : "shield"} size={13} />
              <code>{reason.code}</code>
              <span>{reason.why}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.passed}>
          <Icon name="check" size={13} />
          No rule fired. The decision stands as the model proposed it.
        </p>
      )}
    </section>
  );
}

export function Picks({
  runs,
  runId,
  events,
  onSelect,
  onTrace,
}: {
  runs: Run[];
  runId: string | null;
  events: RunEvent[];
  onSelect(id: string): void;
  onTrace(id: string): void;
}) {
  const picks = runs.filter((run) => run.decision);
  const selected = picks.find((run) => run.id === runId) ?? picks[0];
  /* The paper order is fetched per run and stored with that run's id, so a slow answer for the
     previous pick can never appear under the one now on screen. */
  const [fetched, setFetched] = useState<{ runId: string; order: PaperOrder | null } | null>(null);
  const selectedId = selected?.id;

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    let active = true;
    void (async () => {
      try {
        const order = await consoleApi<PaperOrder>(`/runs/${selectedId}/paper-order`);
        if (active) {
          setFetched({ runId: selectedId, order });
        }
      } catch {
        /* No order, or paper trading is off for this workspace. Both read the same on screen. */
        if (active) {
          setFetched({ runId: selectedId, order: null });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedId]);

  const paper = fetched && fetched.runId === selectedId ? fetched.order : null;
  const paperState =
    !fetched || fetched.runId !== selectedId ? "loading" : paper ? "ready" : "none";

  if (!picks.length || !selected?.decision) {
    return (
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Picks</h2>
          <p>every decision, with the range, the counter-evidence and who said no</p>
        </div>
        <p className={styles.empty}>
          No decision yet. A run has to finish and return an assessment before there is anything to
          read here — a failed run leaves a trace under Activity instead.
        </p>
      </div>
    );
  }

  const view = decisionView(selected, selected.decision);
  const traceOfSelected = selected.id === runId ? events : [];
  const title = marketTitle(traceOfSelected, view.marketId);
  const links = sourceLinks(traceOfSelected);

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2>Picks</h2>
        <span className={styles.count}>{picks.length} DECISIONS</span>
        <p>every decision, with the range, the counter-evidence and who said no</p>
      </div>
      <div className={styles.picks}>
        <div className={styles.pickList}>
          {picks.map((run) => {
            const item = decisionView(run, run.decision!);
            const band = item.probability;
            return (
              <button
                key={run.id}
                type="button"
                className={styles.pick}
                aria-current={run.id === selected.id}
                onClick={() => onSelect(run.id)}
              >
                <span className={styles.pickMeta}>
                  #{item.shortId} · {clock(run.finishedAt ?? run.createdAt)}
                  <span className={styles.mark} data-tint={item.actionTint}>
                    {item.action}
                  </span>
                </span>
                <b>{item.outcomeId}</b>
                {band && (
                  <>
                    <span className={styles.sparkband}>
                      <i
                        style={{
                          left: percent(band.lower),
                          width: percent(band.upper - band.lower),
                        }}
                      />
                      <b style={{ left: percent(band.estimate) }} />
                    </span>
                    <span className={styles.pickMeta}>
                      {two(band.lower)} – {two(band.upper)} · est {two(band.estimate)} ·{" "}
                      {item.uncertaintyLevel}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        <div className={styles.detail}>
          <section className={styles.card}>
            <div>
              <div className={styles.detailHead}>
                RUN #{view.shortId} · {view.trigger} ·{" "}
                {clock(selected.finishedAt ?? selected.createdAt)}
                <span className={styles.mark} data-tint={view.actionTint}>
                  {view.action}
                </span>
              </div>
              <h3>{title}</h3>
              <p className={styles.mono}>
                {view.outcomeId} · marketId {view.marketId}
              </p>
              {view.overridden && (
                <p className={styles.override}>
                  <Icon name="shield" size={13} />
                  The model wanted to trade. Your policy stopped it.
                </p>
              )}
            </div>
            <div className={styles.row}>
              <Button variant="secondary" size="sm" onClick={() => onTrace(selected.id)}>
                <Icon name="activity" size={13} />
                Open the trace
              </Button>
            </div>
          </section>

          <Forecast view={view} />
          <Policy view={view} />

          <div className={styles.trio}>
            <div>
              <p className={styles.trioLabel} data-tint="lime">
                THESIS
              </p>
              <p>{view.thesis}</p>
            </div>
            <div>
              <p className={styles.trioLabel} data-tint="magenta">
                COUNTER-EVIDENCE
              </p>
              <p>{view.counterEvidence}</p>
            </div>
            <div>
              <p className={styles.trioLabel} data-tint="amber">
                UNCERTAINTY
              </p>
              <p>{view.uncertainty}</p>
              {view.abstentionReason && (
                <p className={styles.abstention}>
                  <em>ABSTENTION · </em>
                  {view.abstentionReason}
                </p>
              )}
            </div>
          </div>

          {paperState === "ready" && paper ? (
            <section className={styles.paper}>
              <span className={styles.paperMark}>
                <Icon name="file" size={16} />
              </span>
              <div>
                <span className={styles.eyebrow} data-tint="violet">
                  PAPER ORDER
                </span>
                <b>
                  {paper.fill
                    ? `${paper.fill.quantity} @ ${paper.fill.averagePrice}`
                    : `Virtual budget ${paper.virtualBudget}`}
                </b>
                <small>
                  {paper.reason ??
                    "Filled against the book at the time of the run. It moves no money and places no order."}
                </small>
              </div>
              <span className={styles.paperStatus}>{paper.status}</span>
            </section>
          ) : paperState === "none" ? (
            <p className={styles.empty}>
              No paper order for this run
              {view.action === "TRADE" ? "." : " — nothing to trade on an abstain."}
            </p>
          ) : null}

          {view.report.length > 0 && (
            <div className={styles.list}>
              <div className={styles.listHead}>
                RESEARCH REPORT
                {view.protocol && <span className={styles.stamp}>{view.protocol}</span>}
                <span className={styles.reportCounts}>
                  <span data-tint="lime">
                    <i />
                    {view.supported} supported
                  </span>
                  <span data-tint="amber">
                    <i />
                    {view.conflicting} conflicting
                  </span>
                  <span data-tint="magenta">
                    <i />
                    {view.missingSections} missing
                  </span>
                </span>
              </div>
              {view.report.map((entry) => (
                <div key={entry.key} className={styles.reportRow} data-tint={entry.tint}>
                  <span className={styles.reportDot} />
                  <span className={styles.reportKey}>{entry.key}</span>
                  <span className={styles.reportText}>{entry.explanation}</span>
                  <span className={styles.reportStatus}>{entry.status}</span>
                  <span className={styles.reportSources}>{entry.sources} src</span>
                </div>
              ))}
            </div>
          )}

          <ul className={styles.sources}>
            <li className={styles.sourcesLabel}>SOURCES {view.sources.length}/20</li>
            {view.sources.map((id) => {
              const href = links.get(id);
              return (
                <li key={id}>
                  {href ? (
                    <a className={styles.source} href={href} target="_blank" rel="noreferrer">
                      {id}
                    </a>
                  ) : (
                    <span className={styles.source}>{id}</span>
                  )}
                </li>
              );
            })}
          </ul>

          <details className={styles.raw}>
            <summary>THE DECISION AS STORED</summary>
            <pre>{JSON.stringify(selected.decision, null, 2)}</pre>
          </details>
        </div>
      </div>
    </div>
  );
}
