"use client";
import { useState, type ReactElement } from "react";
import { Button, Chip } from "@pickler/ui";
import { accentVars } from "@/lib/accent";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { READ_WORDS, SHUT, backLabel, backReason, readState } from "./market-model";
import { ReadNote, Shut } from "./market-parts";
import { directoryCards } from "./model";
import styles from "./market.module.css";

/**
 * Marketplace · Agents (canvas 609–643, spec L17): the real directory, read the first time this
 * section opens. Beat filters with their counts and the count tag ("· BY CALIBRATION" only when
 * every entry carries a score); one card per agent with its initials, name, ticker · beat, note,
 * NET and hit rate ("—" without a resolved record). The owner's own agent is tagged YOURS. "Ask"
 * and "Back it" / "Launch its token" are shut with Soon: paid reads are not
 * built. The directory has no token curve, so the canvas's curve line is left out.
 */
export const Agents: (props: LiveSectionProps) => ReactElement = ({ agent, live, onSection }) => {
  const [beat, setBeat] = useState("All");
  const state = readState(live.directory, live.preview, (list) => list.length === 0);
  const view = Array.isArray(live.directory)
    ? directoryCards(live.directory, agent.handle, beat)
    : null;

  return (
    <LiveSection section="agents">
      <div className={styles.stack} id="live-agents" data-state={state}>
        {state !== "ready" && (
          <ReadNote state={state} words={READ_WORDS.agents} onRetry={live.readDirectory} />
        )}

        {state === "ready" && view && (
          <>
            <div className={styles.filters} role="group" aria-label="Beats">
              {view.filters.map((filter) => (
                <Chip key={filter.key} selected={filter.on} onClick={() => setBeat(filter.key)}>
                  {filter.label}
                  <span className={styles.count}>{filter.count}</span>
                </Chip>
              ))}
              <span className={styles.filterTag}>{view.tag}</span>
            </div>

            <ul className={styles.cards}>
              {view.cards.map((card) => (
                <li key={card.key} className={styles.agentCard} data-own={card.own}>
                  <div className={styles.agentHead}>
                    <span
                      className={styles.initials}
                      style={accentVars(card.accent)}
                      aria-hidden="true"
                    >
                      {card.initials}
                    </span>
                    <span className={styles.who}>
                      <span className={styles.name}>{card.name}</span>
                      <span className={styles.sub}>{card.tickerBeat}</span>
                    </span>
                    {card.stage && <span className={styles.stage}>{card.stage}</span>}
                  </div>
                  <p className={styles.agentNote}>{card.note}</p>
                  <div className={styles.stats}>
                    <span className={styles.stat}>
                      <span className={styles.statValue} data-up={card.netUp}>
                        {card.net}
                      </span>
                      <span className={styles.statLabel}>NET · AUSD</span>
                    </span>
                    <span className={styles.stat}>
                      <span className={styles.statValue}>{card.hit}</span>
                      <span className={styles.statLabel}>{card.resolved}</span>
                    </span>
                  </div>
                  <div className={styles.actions}>
                    <Shut tone="ask" label={card.ask} reason={SHUT.ask} />
                    {card.own ? (
                      <Button size="sm" variant="secondary" onClick={() => onSection("token")}>
                        Token
                      </Button>
                    ) : (
                      <Shut label={backLabel(false)} reason={backReason(false)} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </LiveSection>
  );
};
