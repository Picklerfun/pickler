"use client";
import { Button, Skeleton } from "@pickler/ui";
import type { ReactElement } from "react";
import { TalkSoon } from "../shell/talk-soon";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { CONSOLE_PLACEHOLDER, CONSOLE_STARTERS } from "./run-model";
import styles from "./run.module.css";

/**
 * Console (canvas 326–349, spec L7): one thread with the agent, drawn shut with a Soon tag
 * (`../shell/talk-soon.tsx`): the canvas's intro, its starters and the box, none of which does
 * anything yet.
 */
export const Console: (props: LiveSectionProps) => ReactElement = ({ agent, live, onSection }) => (
  <LiveSection section="console">
    <div className={styles.console}>
      <p>Trading markets: {agent.config.perpl?.markets.join(", ") ?? "Not configured"}</p>
      {live.record === null ? (
        <div role="status" aria-label="Reading runtime availability" aria-busy="true">
          <Skeleton shape="button" />
        </div>
      ) : live.record === "failed" ? (
        <div role="alert">
          <p>Runtime availability could not be read.</p>
          <Button variant="secondary" onClick={() => void live.readRuntime()}>
            Retry runtime
          </Button>
        </div>
      ) : live.record.runtimeEnabled ? (
        <Button variant="secondary" onClick={() => onSection("decisions")}>
          Open decision checks
        </Button>
      ) : (
        <p>
          Runtime disabled · paper checks are unavailable. Position supervision and closing remain
          available.
        </p>
      )}
      <TalkSoon
        idPrefix="live"
        section="console"
        note="Chat is not available. Use decision checks and setup controls; chat does not execute recommendations or modify configuration."
        starters={CONSOLE_STARTERS}
        placeholder={CONSOLE_PLACEHOLDER}
      />
    </div>
  </LiveSection>
);
