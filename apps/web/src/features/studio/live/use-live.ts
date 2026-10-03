"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DirectoryAgentDto,
  LeaderboardDto,
  MarketDetailDto,
  PerpMarketDto,
  SetupUpdateDto,
} from "@pickler/api-schema";
import {
  agentVersions,
  marketplaceDirectory,
  marketplaceLeaderboard,
  marketplaceMarket,
  marketplaceMarkets,
  setPaused,
  type Agent,
  type SetupVersion,
} from "../api";
import {
  useAgentStudio,
  type AgentStudioData,
  type StudioTools,
  type UseAgentStudio,
} from "../shell/use-agent-studio";
import type { LiveStaged } from "./fixture";
import { watchedSymbols, type LiveSectionKey, type MarketsRead } from "./model";

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
}

/**
 * The live studio's data: what every agent's studio reads and writes (`../shell/use-agent-studio.ts`),
 * plus its versions and the markets it watches, read with them, the directory and the leaderboard,
 * read the first time their section opens, and pause. With `staged` (a `?stage=perpl-*` fixture)
 * or `preview` nothing touches the API: the reads come from the fixture, and the writes throw.
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
    (tools: StudioTools) => Promise.all([readVersionsWith(tools), readMarketsWith(tools)]),
    [readVersionsWith, readMarketsWith],
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
  };
}
