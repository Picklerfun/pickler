"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DirectoryAgentDto,
  LeaderboardDto,
  MarketDetailDto,
  PerpMarketDto,
  SetupUpdateDto,
} from "@pickler/api-schema";
import {
  StudioError,
  agentVersions,
  approvePerpsProposal,
  closePerpsPosition,
  errorCode,
  marketplaceDirectory,
  marketplaceLeaderboard,
  marketplaceMarket,
  marketplaceMarkets,
  perpsAction,
  perpsCheck,
  perpsChecks,
  perpsChecksBefore,
  perpsPositions,
  perpsProposals,
  perpsRecord,
  setPaused,
  skipPerpsProposal,
  startPerpsCheck,
  stopPerps,
  type Agent,
  type PerpsActionDto,
  type PerpsActionStartedDto,
  type PerpsCheckDetailDto,
  type PerpsCheckSummaryDto,
  type PerpsPositionsResponseDto,
  type PerpsProposalDto,
  type PerpsRecordDto,
  type SetupVersion,
} from "../api";
import { startPolling } from "../lib/polling";
import {
  useAgentStudio,
  type AgentStudioData,
  type StudioTools,
  type UseAgentStudio,
} from "../shell/use-agent-studio";
import type { LiveStaged } from "./fixture";
import { watchedSymbols, type LiveSectionKey, type MarketsRead } from "./model";
import {
  ownerActionView,
  paperShown,
  runtimeErrorText,
  type OwnerActionKind,
} from "./runtime-model";

/** A read the live studio makes on its own: null until read, `failed` when it did not answer. */
export type LiveRead<T> = T | null | "failed";

/** What the live studio reads, beyond the agent the shell already holds. */
export interface LiveData extends AgentStudioData {
  /** `GET /agents/:id/versions`, newest first. Owner-only, so a member's read fails quietly. */
  versions: LiveRead<SetupVersion[]>;
  /** `GET /marketplace/markets`: the board, which WHAT IT WATCHES and Markets both draw (L8, L18). */
  markets: MarketsRead;
  /** `GET /marketplace/markets/:symbol` for each market it watches, keyed by the board's symbol. */
  details: Record<string, MarketDetailDto | null>;
  /** `GET /marketplace/directory`, read the first time Agents opens. */
  directory: LiveRead<DirectoryAgentDto[]>;
  /** `GET /marketplace/leaderboard`, read the first time Leaderboard opens. */
  leaderboard: LiveRead<LeaderboardDto>;
  /**
   * `GET /agents/:id/perps/record`, read first: `runtimeEnabled` and `account` decide whether the
   * rest is read (either one: an agent's paper stays drawn and closable with the runtime off, R3)
   * and whether the studio says what runs (draft spec D19).
   */
  record: LiveRead<PerpsRecordDto>;
  /** `GET /agents/:id/perps/checks`, newest first, with any older pages read since. */
  checks: LiveRead<PerpsCheckSummaryDto[]>;
  /** Whether an older page of checks exists ("Show older"). */
  moreChecks: boolean;
  /** `GET /agents/:id/perps/positions`. */
  positions: LiveRead<PerpsPositionsResponseDto>;
  /** `GET /agents/:id/perps/proposals`: what waits on the owner. */
  proposals: LiveRead<PerpsProposalDto[]>;
  /** The newest check with its steps (`GET /perps/checks/:id`), for the strip. */
  lastCheck: PerpsCheckDetailDto | null;
  /** Checks read with their steps, by id (a Decisions row opened, or "Why this trade"). */
  checkDetails: Record<string, PerpsCheckDetailDto | "failed">;
  /** The manual check "Run a check now" started, polled every 2 s until it has finished, or null. */
  checking: string | null;
  /**
   * The owner's approvals, closes and stops this session, one per thing pressed: each polled every
   * 2 s (`GET /perps/actions/:id`) until done or failed, then its check read for what happened.
   * A settled one stays, so its outcome is said, until the same thing is pressed again.
   */
  actions: OwnerAction[];
}

/**
 * An approve, a close or a stop: a durable action the research worker carries out. `actionId` is
 * null while the POST is out; `action` is its last read; `outcome` is its check once done (null
 * until read, `failed` when it could not be read).
 */
export interface OwnerAction {
  kind: OwnerActionKind;
  /** The proposal, the position, or `all` for a stop. */
  target: string;
  actionId: string | null;
  action: PerpsActionDto | null;
  outcome: PerpsCheckDetailDto | null | "failed";
}

/** The action pressed on `target`, if any. */
export const ownerActionFor = (
  actions: readonly OwnerAction[],
  kind: OwnerActionKind,
  target: string,
): OwnerAction | null =>
  actions.find((action) => action.kind === kind && action.target === target) ?? null;

/** Whether an action still has something to read: its status, or its outcome once done. */
const unsettled = (action: OwnerAction): boolean =>
  action.actionId !== null && !ownerActionView(action).settled;

/** The wire's kind for each thing pressed. */
const WIRE_KINDS: Record<OwnerActionKind, PerpsActionDto["kind"]> = {
  approve: "approve",
  close: "close",
  stop: "stop_all",
};

/** An action Pickler answers 404 for: failed with NOT_FOUND, so the poll stops and says so. */
function lostAction(item: OwnerAction): PerpsActionDto {
  const now = new Date().toISOString();
  return {
    id: item.actionId!,
    kind: WIRE_KINDS[item.kind],
    positionId: item.kind === "close" ? item.target : null,
    proposalId: item.kind === "approve" ? item.target : null,
    attempts: 0,
    checkId: null,
    createdAt: now,
    updatedAt: now,
    ...item.action,
    status: "failed",
    lastError: "NOT_FOUND",
  };
}

/** An answer that may never have reached the API (none, or a 5xx): the press's key is kept. */
const uncertain = (caught: unknown): boolean => {
  const code = errorCode(caught);
  return !code || /^5\d\d$/.test(code);
};

/** The sections that poll every 30 s while the page is visible. */
const POLLED: readonly LiveSectionKey[] = ["overview", "positions", "decisions"];
const SLOW_MS = 30_000;
const FAST_MS = 2_000;

/** A runtime write's refusal in the owner's words, keeping its code. */
function runtimeError(caught: unknown): Error {
  if (caught instanceof StudioError) {
    return new StudioError(caught.code, runtimeErrorText(caught.code, caught.message));
  }
  return caught instanceof Error ? caught : new Error("Something went wrong. Try again.");
}

/**
 * The reads again, and the live studio's writes, each one call: the ones both studios make
 * (`UseAgentStudio`: setup, identity, X) and pause. `refresh` reads the versions and the markets
 * too, and so does every `saveSetup`, whatever it answered: every saved setup is a version row
 * (spec L10), and after a 409 CONFLICT the other writer's save is one. A failed live read says so
 * in its own field (each section draws it with Retry), not in the shell's `error`.
 */
export interface UseLive extends UseAgentStudio, LiveData {
  /** The board and the watched markets' details again (Retry on "Couldn't read Perpl."). */
  readMarkets(): Promise<void>;
  readVersions(): Promise<void>;
  readDirectory(): Promise<void>;
  readLeaderboard(): Promise<void>;
  /**
   * `PUT /pause { paused }` ("Pause entries" / "Resume", spec L4); reloads the agent. Throws to the
   * caller, which says so inline and changes nothing.
   */
  pause(paused: boolean): Promise<void>;
  /**
   * The record, then (when the runtime is on or it has a paper account) the checks, positions and
   * proposals, again.
   */
  readRuntime(): Promise<void>;
  /** The next older page of checks. */
  readOlderChecks(): Promise<void>;
  /** One check with its steps, kept in `checkDetails`. */
  readCheckDetail(checkId: string): Promise<void>;
  /**
   * The paper runtime's writes. Each throws a `StudioError` in the owner's words (MANUAL_LIMIT,
   * PROPOSAL_EXPIRED, POSITION_CLOSED, AGENT_KILLED, ...) and changes nothing. A manual check is
   * polled every 2 s until it has finished; an approve, a close or a stop joins `actions` and is
   * polled until done or failed. Each press has one Idempotency-Key, kept until an answer is
   * certain, so a retry after a dropped answer is the same check or the same action.
   */
  runCheck(): Promise<void>;
  approve(proposalId: string): Promise<void>;
  skip(proposalId: string): Promise<void>;
  closePosition(positionId: string): Promise<void>;
  /** "Stop · close all": pauses at once and closes every paper position; reloads the agent. */
  stopAll(): Promise<void>;
  /** Forgets a settled action's outcome line. */
  dismissAction(kind: OwnerActionKind, target: string): void;
}

/**
 * The live studio's data: what every agent's studio reads and writes (`../shell/use-agent-studio.ts`),
 * plus its versions and the markets it watches, read with them, the directory and the leaderboard,
 * read the first time their section opens, and pause. The Perpl paper runtime's record is read with
 * them (it says whether the runtime is on and whether a paper account exists); with either, the
 * checks, positions and proposals too,
 * every 30 s on Overview, Positions and Decisions while the page shows, and every 2 s while a
 * manual check runs or an owner action is not settled. With `staged` (a `?stage=perpl-*` fixture) or
 * `preview` nothing touches the API: the reads come from the fixture, and the writes throw.
 */
export function useLive({
  agent,
  staged,
  preview,
  section,
  onRefreshAgent,
}: {
  agent: Agent;
  staged: LiveStaged | null;
  preview: boolean;
  /** The open section: Agents and Leaderboard read theirs the first time they open. */
  section: LiveSectionKey;
  onRefreshAgent(): Promise<void>;
}): UseLive {
  const [versions, setVersions] = useState<LiveRead<SetupVersion[]>>(staged?.versions ?? null);
  const [markets, setMarkets] = useState<MarketsRead>(staged?.markets ?? null);
  const [details, setDetails] = useState<Record<string, MarketDetailDto | null>>(
    staged?.details ?? {},
  );
  const [directory, setDirectory] = useState<LiveRead<DirectoryAgentDto[]>>(
    staged?.directory ?? null,
  );
  const [leaderboard, setLeaderboard] = useState<LiveRead<LeaderboardDto>>(
    staged?.leaderboard ?? null,
  );
  const wanted = (agent.config.perpl?.markets ?? []).join(",");
  const stagedRuntime = staged?.runtime ?? null;
  const [record, setRecord] = useState<LiveRead<PerpsRecordDto>>(stagedRuntime?.record ?? null);
  const [firstPage, setFirstPage] = useState<LiveRead<PerpsCheckSummaryDto[]>>(
    stagedRuntime?.checks ?? null,
  );
  const [olderPages, setOlderPages] = useState<PerpsCheckSummaryDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [positions, setPositions] = useState<LiveRead<PerpsPositionsResponseDto>>(
    stagedRuntime?.positions ?? null,
  );
  const [proposals, setProposals] = useState<LiveRead<PerpsProposalDto[]>>(
    stagedRuntime?.proposals ?? null,
  );
  const [checkDetails, setCheckDetails] = useState<Record<string, PerpsCheckDetailDto | "failed">>(
    stagedRuntime?.details ?? {},
  );
  const [lastCheck, setLastCheck] = useState<PerpsCheckDetailDto | null>(() => {
    const newest = stagedRuntime?.checks[0];
    return newest ? (stagedRuntime?.details[newest.id] ?? null) : null;
  });
  const [checking, setChecking] = useState<string | null>(null);
  const [actions, setActions] = useState<OwnerAction[]>(stagedRuntime?.actions ?? []);
  /* The latest of what the poll reads, so its reader stays one function. */
  const checkingRef = useRef<string | null>(null);
  const actionsRef = useRef<OwnerAction[]>(stagedRuntime?.actions ?? []);
  const lastCheckRef = useRef<PerpsCheckDetailDto | null>(null);
  const lastReadAt = useRef(0);

  /* Every change to the actions goes through here, so the poll's ref and the state agree. */
  const updateActions = useCallback((change: (current: OwnerAction[]) => OwnerAction[]) => {
    const next = change(actionsRef.current);
    actionsRef.current = next;
    setActions(next);
  }, []);

  /*
   * Each owner action not settled, read again: its status, and once done its check (what really
   * happened). A request Pickler no longer has (404) fails with NOT_FOUND; any other failed read
   * is tried on the next poll.
   */
  const readActionsWith = useCallback(
    async (tools: StudioTools, signal?: AbortSignal) => {
      const open = actionsRef.current.filter(unsettled);
      if (open.length === 0) {
        return;
      }
      const read = await Promise.all(
        open.map(async (item): Promise<OwnerAction> => {
          let action: PerpsActionDto;
          try {
            action = await perpsAction(item.actionId!, signal);
          } catch (caught) {
            const code = errorCode(caught);
            if (code === "NOT_FOUND" || code === "404") {
              return { ...item, action: lostAction(item) };
            }
            return item;
          }
          let outcome = item.outcome;
          if (action.status === "done" && action.checkId) {
            try {
              outcome = await perpsCheck(action.checkId, signal);
            } catch {
              outcome = "failed";
            }
          }
          return { ...item, action, outcome };
        }),
      );
      if (!tools.alive.current || signal?.aborted) {
        return;
      }
      updateActions((current) =>
        current.map(
          (item) =>
            read.find(
              (fresh) =>
                fresh.actionId === item.actionId &&
                fresh.kind === item.kind &&
                fresh.target === item.target,
            ) ?? item,
        ),
      );
    },
    [updateActions],
  );

  /*
   * The owner actions first, so what they did is in the reads that follow. Then the record: with
   * the runtime off and no paper account nothing else is read (and the studio keeps its "runs
   * soon" copy). With it on, or a paper account (its positions still exit and close with the
   * runtime off), the checks, positions and proposals side by side, each failing on its own; then
   * the newest check's steps for the strip, and the manual check's while it runs.
   */
  const readRuntimeWith = useCallback(
    async (tools: StudioTools, signal?: AbortSignal) => {
      if (tools.offline) {
        return;
      }
      lastReadAt.current = Date.now();
      await readActionsWith(tools, signal);
      if (!tools.alive.current || signal?.aborted) {
        return;
      }
      let read: PerpsRecordDto;
      try {
        read = await perpsRecord(tools.agentId, signal);
      } catch {
        if (tools.alive.current && !signal?.aborted) {
          setRecord("failed");
        }
        return;
      }
      if (!tools.alive.current || signal?.aborted) {
        return;
      }
      setRecord(read);
      if (!paperShown(read)) {
        return;
      }

      const quietly = async <T>(call: () => Promise<T>): Promise<T | "failed"> => {
        try {
          return await call();
        } catch {
          return "failed";
        }
      };
      const [page, open, waiting] = await Promise.all([
        quietly(() => perpsChecks(tools.agentId, signal)),
        quietly(() => perpsPositions(tools.agentId, signal)),
        quietly(() => perpsProposals(tools.agentId, signal)),
      ]);
      if (!tools.alive.current || signal?.aborted) {
        return;
      }
      setFirstPage(page === "failed" ? "failed" : page.checks);
      if (page !== "failed") {
        setCursor((current) => current ?? page.nextCursor);
      }
      setPositions(open);
      setProposals(waiting === "failed" ? "failed" : waiting.proposals);

      /* The newest check's steps, read again while it runs or once a newer one lands. */
      const newest = page === "failed" ? null : (page.checks[0] ?? null);
      let detail = lastCheckRef.current;
      if (newest && (detail?.id !== newest.id || detail.status !== "finished")) {
        const fresh = await quietly(() => perpsCheck(newest.id, signal));
        if (fresh !== "failed") {
          detail = fresh;
        }
      }
      /* A manual check that is not the newest any more is read on its own. */
      const manual = checkingRef.current;
      let manualDetail = detail;
      if (manual && detail?.id !== manual) {
        const fresh = await quietly(() => perpsCheck(manual, signal));
        manualDetail = fresh === "failed" ? null : fresh;
      }
      if (!tools.alive.current || signal?.aborted) {
        return;
      }
      if (detail) {
        lastCheckRef.current = detail;
        setLastCheck(detail);
        setCheckDetails((current) => ({ ...current, [detail.id]: detail }));
      }

      if (manual && manualDetail?.id === manual && manualDetail.status === "finished") {
        checkingRef.current = null;
        setChecking(null);
      }
    },
    [readActionsWith],
  );

  const readVersionsWith = useCallback(async (tools: StudioTools) => {
    if (tools.offline) {
      return;
    }
    try {
      const read = await agentVersions(tools.agentId);
      if (tools.alive.current) {
        setVersions(read.versions);
      }
    } catch {
      if (tools.alive.current) {
        setVersions("failed");
      }
    }
  }, []);

  const readMarketsWith = useCallback(
    async (tools: StudioTools) => {
      if (tools.offline) {
        return;
      }
      let board: PerpMarketDto[];
      try {
        board = await marketplaceMarkets();
      } catch {
        if (tools.alive.current) {
          setMarkets("failed");
        }
        return;
      }
      if (!tools.alive.current) {
        return;
      }
      setMarkets(board);
      /* One detail per watched market, for its trail; a detail that fails only loses the line. */
      const symbols = watchedSymbols(board, wanted ? wanted.split(",") : []);
      const read = await Promise.all(
        symbols.map(async (symbol) => {
          try {
            return [symbol, await marketplaceMarket(symbol)] as const;
          } catch {
            return [symbol, null] as const;
          }
        }),
      );
      if (tools.alive.current) {
        setDetails(Object.fromEntries(read));
      }
    },
    [wanted],
  );

  const readMore = useCallback(
    (tools: StudioTools) =>
      Promise.all([readVersionsWith(tools), readMarketsWith(tools), readRuntimeWith(tools)]),
    [readVersionsWith, readMarketsWith, readRuntimeWith],
  );

  const { studio, tools } = useAgentStudio({ agent, staged, preview, onRefreshAgent, readMore });
  const { agentId, offline, alive, guard, reloadAfterWrite } = tools;

  const readVersions = useCallback(() => readVersionsWith(tools), [readVersionsWith, tools]);
  const readMarkets = useCallback(() => readMarketsWith(tools), [readMarketsWith, tools]);

  /* VERSIONS is read again after every save, a refused one included (CONFLICT moved the version). */
  const { saveSetup: saveSetupOnce } = studio;
  const saveSetup = useCallback(
    async (patch: Omit<SetupUpdateDto, "expectedVersion">) => {
      try {
        return await saveSetupOnce(patch);
      } finally {
        void readVersions();
      }
    },
    [saveSetupOnce, readVersions],
  );

  const readDirectory = useCallback(async () => {
    if (offline) {
      return;
    }
    try {
      const read = await marketplaceDirectory();
      if (alive.current) {
        setDirectory(read);
      }
    } catch {
      if (alive.current) {
        setDirectory("failed");
      }
    }
  }, [offline, alive]);

  const readLeaderboard = useCallback(async () => {
    if (offline) {
      return;
    }
    try {
      const read = await marketplaceLeaderboard();
      if (alive.current) {
        setLeaderboard(read);
      }
    } catch {
      if (alive.current) {
        setLeaderboard("failed");
      }
    }
  }, [offline, alive]);

  /* The marketplace's directory and leaderboard are read once, the first time their section opens. */
  const lazyRead = useRef({ agents: false, leaders: false });
  useEffect(() => {
    if (offline) {
      return;
    }
    if (section === "agents" && !lazyRead.current.agents) {
      lazyRead.current.agents = true;
      void Promise.resolve().then(readDirectory);
    }
    if (section === "leaders" && !lazyRead.current.leaders) {
      lazyRead.current.leaders = true;
      void Promise.resolve().then(readLeaderboard);
    }
  }, [offline, section, readDirectory, readLeaderboard]);

  const pause = useCallback(
    async (paused: boolean) => {
      guard();
      await setPaused(agentId, paused);
      await reloadAfterWrite();
    },
    [guard, agentId, reloadAfterWrite],
  );

  const readRuntime = useCallback(() => readRuntimeWith(tools), [readRuntimeWith, tools]);

  /*
   * Overview, Positions and Decisions read the runtime again every 30 s while the page shows; any
   * section, every 2 s while a manual check runs or an owner action is not settled. The first poll
   * is skipped when the mount's read just ran.
   */
  const polled = POLLED.includes(section);
  const busy = () => checkingRef.current !== null || actionsRef.current.some(unsettled);
  const fast = checking !== null || actions.some(unsettled);
  /* With the runtime off its paper is still polled: exits close positions, and the owner's closes
     and stops run (R3). */
  const paperNow = paperShown(record);
  useEffect(() => {
    if (offline || !paperNow || !(polled || fast)) {
      return;
    }
    return startPolling(
      async (signal) => {
        if (fast || Date.now() - lastReadAt.current > FAST_MS) {
          await readRuntimeWith(tools, signal);
        }
        if (busy()) {
          return FAST_MS;
        }
        return polled ? SLOW_MS : null;
      },
      () => undefined,
    );
  }, [offline, paperNow, polled, fast, readRuntimeWith, tools]);

  /* The manual check started is polled; the 2 s poll (restarted by it) reads at once. */
  const watchCheck = useCallback((checkId: string) => {
    checkingRef.current = checkId;
    setChecking(checkId);
  }, []);

  /*
   * One owner action: drawn as sending at once, then posted with the press's Idempotency-Key. The
   * key is kept while the answer is uncertain, so pressing again is the same action; a refusal
   * drops the line and throws in the owner's words.
   */
  const actionKeys = useRef(new Map<string, string>());
  const sendAction = useCallback(
    async (
      kind: OwnerActionKind,
      target: string,
      post: (key: string) => Promise<PerpsActionStartedDto>,
    ): Promise<void> => {
      const slot = `${kind}:${target}`;
      const key = actionKeys.current.get(slot) ?? crypto.randomUUID();
      actionKeys.current.set(slot, key);
      const others = (current: OwnerAction[]) =>
        current.filter((item) => item.kind !== kind || item.target !== target);
      updateActions((current) => [
        ...others(current),
        { kind, target, actionId: null, action: null, outcome: null },
      ]);
      let started: PerpsActionStartedDto;
      try {
        started = await post(key);
      } catch (caught) {
        if (!uncertain(caught)) {
          actionKeys.current.delete(slot);
        }
        updateActions(others);
        throw runtimeError(caught);
      }
      actionKeys.current.delete(slot);
      updateActions((current) =>
        current.map((item) =>
          item.kind === kind && item.target === target && item.actionId === null
            ? { ...item, actionId: started.actionId }
            : item,
        ),
      );
    },
    [updateActions],
  );

  const dismissAction = useCallback(
    (kind: OwnerActionKind, target: string) =>
      updateActions((current) =>
        current.filter((item) => item.kind !== kind || item.target !== target),
      ),
    [updateActions],
  );

  const readOlderChecks = useCallback(async () => {
    if (offline || !cursor) {
      return;
    }
    try {
      const page = await perpsChecksBefore(agentId, cursor);
      if (alive.current) {
        setOlderPages((current) => [...current, ...page.checks]);
        setCursor(page.nextCursor ?? "");
      }
    } catch {
      /* The button stays; pressing it again tries again. */
    }
  }, [offline, cursor, agentId, alive]);

  const readCheckDetail = useCallback(
    async (checkId: string) => {
      if (offline) {
        return;
      }
      try {
        const detail = await perpsCheck(checkId);
        if (alive.current) {
          setCheckDetails((current) => ({ ...current, [checkId]: detail }));
        }
      } catch {
        if (alive.current) {
          setCheckDetails((current) => ({ ...current, [checkId]: "failed" }));
        }
      }
    },
    [offline, alive],
  );

  /* One key per press, kept until the answer is certain: a dropped answer retried is the same check. */
  const checkKey = useRef<string | null>(null);
  const runCheck = useCallback(async () => {
    guard();
    checkKey.current ??= crypto.randomUUID();
    let started: { checkId: string };
    try {
      started = await startPerpsCheck(agentId, checkKey.current);
    } catch (caught) {
      if (!uncertain(caught)) {
        checkKey.current = null;
      }
      throw runtimeError(caught);
    }
    checkKey.current = null;
    watchCheck(started.checkId);
  }, [guard, agentId, watchCheck]);

  const approve = useCallback(
    async (proposalId: string) => {
      guard();
      try {
        await sendAction("approve", proposalId, (key) => approvePerpsProposal(proposalId, key));
      } catch (caught) {
        void readRuntime();
        throw caught;
      }
    },
    [guard, sendAction, readRuntime],
  );

  const skip = useCallback(
    async (proposalId: string) => {
      guard();
      try {
        await skipPerpsProposal(proposalId);
      } catch (caught) {
        throw runtimeError(caught);
      } finally {
        void readRuntime();
      }
    },
    [guard, readRuntime],
  );

  const closePosition = useCallback(
    async (positionId: string) => {
      guard();
      try {
        await sendAction("close", positionId, (key) => closePerpsPosition(positionId, key));
      } catch (caught) {
        void readRuntime();
        throw caught;
      }
    },
    [guard, sendAction, readRuntime],
  );

  const stopAll = useCallback(async () => {
    guard();
    await sendAction("stop", "all", (key) => stopPerps(agentId, key));
    await reloadAfterWrite();
  }, [guard, agentId, sendAction, reloadAfterWrite]);

  /* The feed: the newest page as polled, then the older pages read since, each check once. */
  const checks = useMemo<LiveRead<PerpsCheckSummaryDto[]>>(() => {
    if (firstPage === null || firstPage === "failed") {
      return firstPage;
    }
    const seen = new Set(firstPage.map((check) => check.id));
    return [...firstPage, ...olderPages.filter((check) => !seen.has(check.id))];
  }, [firstPage, olderPages]);

  return {
    ...studio,
    saveSetup,
    versions,
    markets,
    details,
    directory,
    leaderboard,
    readMarkets,
    readVersions,
    readDirectory,
    readLeaderboard,
    pause,
    record,
    checks,
    moreChecks: Boolean(cursor),
    positions,
    proposals,
    lastCheck,
    checkDetails,
    checking,
    actions,
    readRuntime,
    readOlderChecks,
    readCheckDetail,
    runCheck,
    approve,
    skip,
    closePosition,
    stopAll,
    dismissAction,
  };
}
