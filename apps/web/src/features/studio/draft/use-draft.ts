"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublishDto } from "@pickler/api-schema";
import {
  agentActivity,
  publishAgent,
  setIntervalHours,
  type ActivityEvent,
  type Agent,
} from "../api";
import {
  useAgentStudio,
  type AgentStudioData,
  type StudioTools,
  type UseAgentStudio,
} from "../shell/use-agent-studio";
import type { DraftStaged } from "./fixture";
import type { INTERVAL_OPTIONS } from "./run-model";

/**
 * How long Go Public's "{NAME} IS LIVE" stays before the studio reloads the agents, which swaps
 * the draft studio for the live one.
 */
const LIVE_HOLD_MS = 1600;

export type IntervalHours = (typeof INTERVAL_OPTIONS)[number];

/** What the draft studio reads, beyond the agent the shell already holds. */
export interface DraftData extends AgentStudioData {
  /** `GET /agents/:id/activity`, newest first; null until read. */
  activity: ActivityEvent[] | null;
  /** The last activity read failed (Overview says so, with Retry). */
  activityFailed: boolean;
}

/**
 * The reads again, and the draft's writes (studio-draft-dashboard-v1 §4), each one call: the ones
 * both studios make (`UseAgentStudio`: setup, identity, X), and the draft's own below. `refresh`
 * reads the activity too.
 */
export interface UseDraft extends UseAgentStudio, DraftData {
  /** The activity alone (Overview's Retry). */
  readActivity(): Promise<void>;
  /** `PUT /interval`: the schedule's interval (3 / 6 / 12 / 24 h, spec D13); reloads the agent. */
  saveInterval(hours: IntervalHours): Promise<void>;
  /**
   * `POST /publish` (Go Public). Resolves once public; after `LIVE_HOLD_MS` the agent is reloaded,
   * and the studio, seeing it is no longer a draft, opens the live one. A 409 PUBLISH_BLOCKED
   * throws with its blockers in `details.detail.blockers`.
   */
  publish(): Promise<PublishDto>;
}

/**
 * The draft studio's data: what every agent's studio reads and writes (`../shell/use-agent-studio.ts`:
 * the wallets, the X state, the ledger, setup, identity), plus the activity, read with them, the
 * schedule's interval and Go Public. With `staged` (a `?stage=draft*` fixture) or `preview` nothing
 * touches the API: the reads come from the fixture, and the writes throw.
 */
export function useDraft({
  agent,
  staged,
  preview,
  onRefreshAgent,
  onPublished,
}: {
  agent: Agent;
  staged: DraftStaged | null;
  preview: boolean;
  onRefreshAgent(): Promise<void>;
  /** Go Public landed: the shell opens the live studio on its home once the reload swaps it. */
  onPublished?(): void;
}): UseDraft {
  const [activity, setActivity] = useState<ActivityEvent[] | null>(staged?.activity ?? null);
  const [activityFailed, setActivityFailed] = useState(false);

  const readActivityWith = useCallback(async (tools: StudioTools) => {
    if (tools.offline) {
      return;
    }
    try {
      const read = await agentActivity(tools.agentId);
      if (tools.alive.current) {
        setActivity(read.events);
        setActivityFailed(false);
      }
    } catch (caught) {
      if (tools.alive.current) {
        setActivityFailed(true);
      }
      tools.fail(caught, "Could not read its activity.");
    }
  }, []);

  const { studio, tools } = useAgentStudio({
    agent,
    staged,
    preview,
    onRefreshAgent,
    readMore: readActivityWith,
  });
  const { agentId, alive, guard, fail, reloadAgent, reloadAfterWrite } = tools;

  /* The latest `onPublished`, so `publish` stays stable across renders. */
  const published = useRef(onPublished);
  useEffect(() => {
    published.current = onPublished;
  }, [onPublished]);
  /* Go Public's pending reload is cancelled when the studio moves to another agent, or closes. */
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (liveTimer.current !== null) {
        clearTimeout(liveTimer.current);
        liveTimer.current = null;
      }
    },
    [agentId],
  );

  const readActivity = useCallback(() => readActivityWith(tools), [readActivityWith, tools]);

  const saveInterval = useCallback(
    async (hours: IntervalHours) => {
      guard();
      await setIntervalHours(agentId, hours);
      await reloadAfterWrite();
    },
    [guard, agentId, reloadAfterWrite],
  );

  const publish = useCallback(async () => {
    guard();
    const result = await publishAgent(agentId);
    if (!alive.current) {
      return result;
    }
    published.current?.();
    if (liveTimer.current !== null) {
      clearTimeout(liveTimer.current);
    }
    liveTimer.current = setTimeout(() => {
      liveTimer.current = null;
      if (alive.current) {
        void reloadAgent().catch((caught: unknown) => {
          fail(caught, "Could not read the agent.");
        });
      }
    }, LIVE_HOLD_MS);
    return result;
  }, [guard, agentId, alive, reloadAgent, fail]);

  return { ...studio, activity, activityFailed, readActivity, saveInterval, publish };
}
