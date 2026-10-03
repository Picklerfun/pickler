"use client";
import type { ReactElement } from "react";
import { TalkSoon } from "../shell/talk-soon";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { CONSOLE_PLACEHOLDER, CONSOLE_STARTERS, consoleIntro } from "./run-model";
import styles from "./run.module.css";

/**
 * Console (canvas 326–349, spec L7): one thread with the agent, drawn shut with a Soon tag
 * (`../shell/talk-soon.tsx`): the canvas's intro, its starters and the box, none of which does
 * anything yet.
 */
export const Console: (props: LiveSectionProps) => ReactElement = ({ agent }) => (
  <LiveSection section="console">
    <div className={styles.console}>
      <TalkSoon
        idPrefix="live"
        section="console"
        note={consoleIntro(agent.name)}
        starters={CONSOLE_STARTERS}
        placeholder={CONSOLE_PLACEHOLDER}
      />
    </div>
  </LiveSection>
);
