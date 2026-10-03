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
import { runtimeErrorText } from "./runtime-model";

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
   * `GET /agents/:id/perps/record`, read first: `runtimeEnabled` decides whether the rest is read
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
  /** The paper actions sent and not yet shown, polled every 2 s until they resolve. */
  pending: PendingAction[];
  /** Said when a queued action has not shown after two minutes, or "". */
  queuedNote: string;
}

/** A write the research worker carries out, polled until it shows (or two minutes pass). */
export type PendingAction =
  | { kind: "check"; checkId: string; since: number }
  | { kind: "approve"; proposalId: string; since: number }
  | { kind: "close"; positionId: string; since: number }
  | { kind: "stop"; since: number };

/** The sections that poll every 30 s while the page is visible. */
const POLLED: readonly LiveSectionKey[] = ["overview", "positions", "decisions"];
const SLOW_MS = 30_000;
const FAST_MS = 2_000;
/** A queued action that has not shown by then stops the fast poll and says so. */
const PENDING_MS = 120_000;
const QUEUED_NOTE = "Still queued. It shows here once the research worker runs it.";

/** A runtime write's refusal in the owner's words, keeping its code. */
function runtimeError(caught: unknown): Error {
  if (caught instanceof StudioError) {
    return new StudioError(caught.code, runtimeErrorText(caught.code, caught.message));
  }
  return caught instanceof Error ? caught : new Error("Something went wrong. Try again.");
}

/** Whether a pending action has shown in what was just read. */
function resolved(
  action: PendingAction,
  read: {
    positions: PerpsPositionsResponseDto | null;
    proposals: PerpsProposalDto[] | null;
    check: PerpsCheckDetailDto | null;
  },
): boolean {
  switch (action.kind) {
    case "check":
      return read.check?.id === action.checkId && read.check.status === "finished";
    case "approve":
      return read.proposals !== null && !read.proposals.some((p) => p.id === action.proposalId);
    case "close":
      return (
        read.positions !== null && !read.positions.open.some((p) => p.id === action.positionId)
      );
    case "stop":
      return read.positions !== null && read.positions.open.length === 0;
  }
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
  /** The record, then (when the runtime is on) the checks, positions and proposals, again. */
  readRuntime(): Promise<void>;
  /** The next older page of checks. */
  readOlderChecks(): Promise<void>;
  /** One check with its steps, kept in `checkDetails`. */
  readCheckDetail(checkId: string): Promise<void>;
  /**
   * The paper runtime's writes. Each throws a `StudioError` in the owner's words (MANUAL_LIMIT,
   * PROPOSAL_EXPIRED, POSITION_CLOSED, ...) and changes nothing; a queued one is polled every 2 s
   * until it shows. `runCheck` keeps its Idempotency-Key until an answer is certain, so a retry
   * after a dropped answer is the same check.
   */
  runCheck(): Promise<void>;
  approve(proposalId: string): Promise<void>;
  skip(proposalId: string): Promise<void>;
  closePosition(positionId: string): Promise<void>;
  /** "Stop · close all": pauses at once and closes every paper position; reloads the agent. */
  stopAll(): Promise<void>;
}

/**
 * The live studio's data: what every agent's studio reads and writes (`../shell/use-agent-studio.ts`),
 * plus its versions and the markets it watches, read with them, the directory and the leaderboard,
 * read the first time their section opens, and pause. The Perpl paper runtime's record is read with
 * them (it says whether the runtime is on); with it on, the checks, positions and proposals too,
 * every 30 s on Overview, Positions and Decisions while the page shows, and every 2 s while a
 * manual check or a queued action is pending. With `staged` (a `?stage=perpl-*` fixture) or
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
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [queuedNote, setQueuedNote] = useState("");
  /* The latest of what the poll compares against, so its reader stays one function. */
  const pendingRef = useRef<PendingAction[]>([]);
  const lastCheckRef = useRef<PerpsCheckDetailDto | null>(null);
  const lastReadAt = useRef(0);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  /*
   * The record first: with the runtime off nothing else is read (and the studio keeps its "runs
   * soon" copy). With it on, the checks, positions and proposals side by side, each failing on its
   * own; then the newest check's steps for the strip, and the pending manual check's, and the
   * pending actions that have shown are dropped.
   */
  const readRuntimeWith = useCallback(async (tools: StudioTools, signal?: AbortSignal) => {
    if (tools.offline) {
      return;
    }
    lastReadAt.current = Date.now();
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
    if (!read.runtimeEnabled) {
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
    const manual = pendingRef.current.find((action) => action.kind === "check");
    let manualDetail = detail;
    if (manual?.kind === "check" && detail?.id !== manual.checkId) {
      const fresh = await quietly(() => perpsCheck(manual.checkId, signal));
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

    const now = Date.now();
    const shown = {
      positions: open === "failed" ? null : open,
      proposals: waiting === "failed" ? null : waiting.proposals,
      check: manualDetail,
    };
    const still = pendingRef.current.filter((action) => !resolved(action, shown));
    const late = still.filter((action) => now - action.since > PENDING_MS);
    if (still.length !== pendingRef.current.length || late.length > 0) {
      const next = still.filter((action) => now - action.since <= PENDING_MS);
      pendingRef.current = next;
      setPending(next);
      setQueuedNote(late.length > 0 ? QUEUED_NOTE : "");
    }
  }, []);

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
   * section, every 2 s while a manual check or a queued action is pending, until it resolves. The
   * first poll is skipped when the mount's read just ran.
   */
  const polled = POLLED.includes(section);
  const fast = pending.length > 0;
  const runtimeOnNow = record !== null && record !== "failed" && record.runtimeEnabled;
  useEffect(() => {
    if (offline || !runtimeOnNow || !(polled || fast)) {
      return;
    }
    return startPolling(
      async (signal) => {
        if (fast || Date.now() - lastReadAt.current > FAST_MS) {
          await readRuntimeWith(tools, signal);
        }
        if (pendingRef.current.length > 0) {
          return FAST_MS;
        }
        return polled ? SLOW_MS : null;
      },
      () => undefined,
    );
  }, [offline, runtimeOnNow, polled, fast, readRuntimeWith, tools]);

  /* A queued write joins the pending list; the 2 s poll (restarted by it) reads at once. */
  const queue = useCallback((action: PendingAction) => {
    const next = [...pendingRef.current, action];
    pendingRef.current = next;
    setPending(next);
    setQueuedNote("");
  }, []);

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
      if (errorCode(caught) && !/^5\d\d$/.test(errorCode(caught))) {
        checkKey.current = null;
      }
      throw runtimeError(caught);
    }
    checkKey.current = null;
    queue({ kind: "check", checkId: started.checkId, since: Date.now() });
  }, [guard, agentId, queue]);

  const approve = useCallback(
    async (proposalId: string) => {
      guard();
      try {
        await approvePerpsProposal(proposalId);
      } catch (caught) {
        void readRuntime();
        throw runtimeError(caught);
      }
      queue({ kind: "approve", proposalId, since: Date.now() });
    },
    [guard, queue, readRuntime],
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
        await closePerpsPosition(positionId);
      } catch (caught) {
        void readRuntime();
        throw runtimeError(caught);
      }
      queue({ kind: "close", positionId, since: Date.now() });
    },
    [guard, queue, readRuntime],
  );

  const stopAll = useCallback(async () => {
    guard();
    try {
      await stopPerps(agentId);
    } catch (caught) {
      throw runtimeError(caught);
    }
    queue({ kind: "stop", since: Date.now() });
    await reloadAfterWrite();
  }, [guard, agentId, queue, reloadAfterWrite]);

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
    pending,
    queuedNote,
    readRuntime,
    readOlderChecks,
    readCheckDetail,
    runCheck,
    approve,
    skip,
    closePosition,
    stopAll,
  };
}
