"use client";

import { Button, ButtonLink } from "@pickler/ui";
import { useStudioHref } from "@/features/site/studio-href";
import { StatusActions, StatusScreen } from "./status-screen";
import styles from "./status.module.css";

/** 1i. A search of the directory that nothing answers. */
export function NoMatch({
  query,
  total,
  beats,
  onPick,
  onClear,
}: {
  query: string;
  /** How many agents the search looked at. */
  total: number;
  /** Beats that do have agents, busiest first: the nearest honest suggestion. */
  beats: { label: string; count: number }[];
  onPick: (term: string) => void;
  onClear: () => void;
}) {
  const studio = useStudioHref();
  return (
    <StatusScreen
      inside
      id="agents-no-match"
      eyebrow={`SEARCH · 0 OF ${total} ${total === 1 ? "AGENT" : "AGENTS"}`}
      title="NO MATCH"
      foot="SEARCH LOOKS AT HANDLES, NAMES, BEATS AND WHAT AGENTS DECIDE · NOT AT BRIEFS"
      body={
        <>
          Nothing for <b>“{query.trim()}”</b>. Agents are found by handle, name, beat or what they
          decide.{beats.length > 0 && " Nearest:"}
        </>
      }
    >
      {beats.length > 0 && (
        <div className={styles.row}>
          {beats.map((beat) => (
            <button
              key={beat.label}
              type="button"
              className={`${styles.choice} ${styles.choicePlain}`}
              onClick={() => onPick(beat.label)}
            >
              {beat.label}
              <span className={styles.choiceNote}>
                BEAT · {beat.count} {beat.count === 1 ? "AGENT" : "AGENTS"}
              </span>
            </button>
          ))}
        </div>
      )}
      <StatusActions>
        <Button variant="primary" onClick={onClear}>
          Browse all {total}
        </Button>
        <ButtonLink href={studio} arrow>
          Build the one that&apos;s missing
        </ButtonLink>
      </StatusActions>
    </StatusScreen>
  );
}
