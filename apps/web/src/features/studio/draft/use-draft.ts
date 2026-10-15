"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublishDto } from "@pickler/api-schema";
import {
  StudioError,
  agentActivity,
  perpsCheck,
  perpsChecks,
  perpsPositions,
  perpsRecord,
  publishAgent,
  setIntervalHours,
  startPerpsCheck,
  type ActivityEvent,
  type Agent,
  type PerpsCheckDetailDto,
  type PerpsPositionsResponseDto,
  type PerpsRecordDto,
} from "../api";
import { startPolling } from "../lib/polling";
import {
  useAgentStudio,
  type AgentStudioData,
  type StudioTools,
  type UseAgentStudio,
} from "../shell/use-agent-studio";
import type { DraftStaged } from "./fixture";
import type { INTERVAL_OPTIONS } from "./run-model";
import { CHECK_POLL_MS, checkRunning } from "./runtime-model";

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
  /**
   * `GET /perps/record`: `runtimeEnabled` and today's manual checks; null until read, or when the
   * read failed (Console presents an explicit retry state). Failures are never reported as disabled.
   */
  record: PerpsRecordDto | null;
  runtimeState: "loading" | "ready" | "error";
  readRuntime(): Promise<void>;
  /** `GET /perps/positions`: the paper positions Trades and Overview list; null until read. */
  positions: PerpsPositionsResponseDto | null;
  /** The newest check, polled every 1.5 s while it runs; null before the first. */
  check: PerpsCheckDetailDto | null;
  /** A check is being started or is still running. */
  checking: boolean;
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
  /**
   * `POST /perps/checks` ("Run it on paper", R2): starts a manual check and polls it until it
   * finishes, then reads the positions and the record again. Throws the refusal (`StudioError`:
   * MANUAL_LIMIT, CHECK_RUNNING, RUNTIME_DISABLED, PREVIEW); after CHECK_RUNNING the running
   * check is read and polled instead.
   */
  runCheck(): Promise<void>;
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
  const [runtimeState, setRuntimeState] = useState<"loading" | "ready" | "error">(
    staged ? "ready" : "loading",
  );
  const [record, setRecord] = useState<PerpsRecordDto | null>(staged?.perps.record ?? null);
  const [positions, setPositions] = useState<PerpsPositionsResponseDto | null>(
    staged?.perps.positions ?? null,
  );
  const [check, setCheck] = useState<PerpsCheckDetailDto | null>(staged?.perps.check ?? null);
  /* The check being polled: set by a press or by a running check found on the first read. */
  const [pollId, setPollId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const runtimeRead = useRef(0);
  /* A failed runtime read remains an explicit error; only a successful record establishes availability. */
  const readRuntimeWith = useCallback(async (tools: StudioTools, latest: boolean) => {
    if (tools.offline) {
      return;
    }
    const id = tools.agentId;
    const request = ++runtimeRead.current;
    if (latest) {
      setRuntimeState("loading");
    }
    await Promise.all([
      perpsRecord(id).then(
        (read) => {
          if (tools.alive.current && request === runtimeRead.current) {
            setRecord(read);
            setRuntimeState("ready");
          }
        },
        () => {
          if (tools.alive.current && request === runtimeRead.current) {
            setRuntimeState("error");
          }
        },
      ),
      perpsPositions(id).then(
        (read) => tools.alive.current && setPositions(read),
        () => undefined,
      ),
      latest
        ? perpsChecks(id)
            .then(async (page) => {
              const newest = page.checks[0];
              if (!newest) {
                return;
              }
              const detail = await perpsCheck(newest.id);
              if (tools.alive.current) {
                setCheck(detail);
                if (checkRunning(detail)) {
                  setPollId(detail.id);
                }
              }
            })
            .catch(() => undefined)
        : undefined,
    ]);
  }, []);

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
    readMore: (tools) => Promise.all([readActivityWith(tools), readRuntimeWith(tools, true)]),
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

  /* Poll the check until it finishes, then read the positions and the record again. A new press or
     another agent stops the old poll. */
  useEffect(() => {
    if (pollId === null || tools.offline) {
      return;
    }
    return startPolling(
      async (signal) => {
        const detail = await perpsCheck(pollId, signal);
        if (!alive.current) {
          return null;
        }
        setCheck(detail);
        if (checkRunning(detail)) {
          return CHECK_POLL_MS;
        }
        setPollId(null);
        void readRuntimeWith(tools, false);
        return null;
      },
      () => undefined,
    );
  }, [pollId, tools, alive, readRuntimeWith]);

  const runCheck = useCallback(async () => {
    guard();
    setStarting(true);
    try {
      const { checkId } = await startPerpsCheck(agentId, crypto.randomUUID());
      if (!alive.current) {
        return;
      }
      setCheck(null);
      setPollId(checkId);
      void readRuntimeWith(tools, false);
    } catch (caught) {
      if (caught instanceof StudioError && caught.code === "CHECK_RUNNING") {
        void readRuntimeWith(tools, true);
      } else if (
        caught instanceof StudioError &&
        (caught.code === "MANUAL_LIMIT" || caught.code === "RUNTIME_DISABLED")
      ) {
        void readRuntimeWith(tools, false);
      }
      throw caught;
    } finally {
      if (alive.current) {
        setStarting(false);
      }
    }
  }, [guard, agentId, alive, tools, readRuntimeWith]);

  return {
    ...studio,
    activity,
    activityFailed,
    record,
    runtimeState,
    readRuntime: () => readRuntimeWith(tools, true),
    positions,
    check,
    checking: starting || pollId !== null || checkRunning(check),
    readActivity,
    saveInterval,
    publish,
    runCheck,
  };
}
