"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { IdentityUpdateDto, PublishDto, SetupUpdateDto } from "@pickler/api-schema";
import {
  StudioError,
  agentActivity,
  publishAgent,
  saveDraftSetup,
  saveIdentity as putIdentity,
  setIntervalHours,
  studioWallets,
  walletLedger,
  xChallenge,
  xDisconnect,
  xState,
  xVerify,
  type ActivityEvent,
  type Agent,
  type LedgerEntry,
  type StudioWallets,
  type XChallenge,
  type XState,
  type XVerify,
} from "../api";
import type { DraftStaged } from "./fixture";
import type { INTERVAL_OPTIONS } from "./model";

/** What a staged or preview studio says when anything on it tries to write. */
export const PREVIEW_NOTE = "Preview · fixture data, nothing is saved.";

/**
 * How long Go Public's "{NAME} IS LIVE" stays before the studio reloads the agents, which swaps
 * the draft studio for the live one.
 */
const LIVE_HOLD_MS = 1600;

export type IntervalHours = (typeof INTERVAL_OPTIONS)[number];

/** What the draft studio reads, beyond the agent the shell already holds. */
export interface DraftData {
  /** `GET /wallets`: the master wallet and the agent wallets; null until read. */
  wallets: StudioWallets | null;
  /** `GET /agents/:id/activity`, newest first; null until read. */
  activity: ActivityEvent[] | null;
  /** `GET /agents/:id/x`: the verified account, the live challenge, whether X is open; null until read. */
  x: XState | null;
  /** `GET /wallets/ledger`, read the first time Master wallet asks (`readLedger`); null until then. */
  ledger: LedgerEntry[] | null;
  /** The last failed read, in words, or "". Writes throw to their caller instead. */
  error: string;
  /** A fixture drew the studio: nothing is read, and every write throws `PREVIEW_NOTE`. */
  preview: boolean;
}

/** The reads again, and the draft's writes (studio-draft-dashboard-v1 §4), each one call. */
export interface UseDraft extends DraftData {
  /** Wallets, activity and X again (after a transfer, or the "Refresh" on Limits). */
  refresh(): Promise<void>;
  /** The wallets alone; answers them, or null when the read failed. */
  readWallets(): Promise<StudioWallets | null>;
  /** The ledger, for Master wallet. */
  readLedger(): Promise<void>;
  /** The agent again in the shell: after a save refused as stale (409 CONFLICT). */
  refreshAgent(): Promise<void>;
  /**
   * `PUT /setup` at the agent's current version: brief, sources, caps and/or voice. Answers the
   * agent and reloads it in the shell. A 409 CONFLICT throws: the caller reloads and says so.
   */
  saveSetup(patch: Omit<SetupUpdateDto, "expectedVersion">): Promise<Agent>;
  /** `PUT /identity`: name and/or avatar; reloads the agent. */
  saveIdentity(body: IdentityUpdateDto): Promise<Agent>;
  /** `PUT /interval`: the schedule's interval (3 / 6 / 12 / 24 h, spec D13); reloads the agent. */
  saveInterval(hours: IntervalHours): Promise<void>;
  /** `POST /x/challenge`: the line to post; the X state keeps it as the live challenge. */
  challengeX(handle: string): Promise<XChallenge>;
  /** `POST /x/verify` ("Check again"); found re-reads X and the agent (its `xHandle`). */
  verifyX(): Promise<XVerify>;
  /** `DELETE /x`, while private; re-reads X and the agent. */
  disconnectX(): Promise<void>;
  /**
   * `POST /publish` (Go Public). Resolves once public; after `LIVE_HOLD_MS` the agent is reloaded,
   * and the studio, seeing it is no longer a draft, opens the live one. A 409 PUBLISH_BLOCKED
   * throws with its blockers in `details.detail.blockers`.
   */
  publish(): Promise<PublishDto>;
}

const message = (caught: unknown, fallback: string) =>
  caught instanceof Error ? caught.message : fallback;

/**
 * The draft studio's data: one read each of the wallets, the activity and the X state when the
 * agent opens, the ledger only when Master wallet asks, and the writes, which reload the agent in
 * the shell (`onRefreshAgent`) when they change it. With `staged` (a `?stage=draft*` fixture) or
 * `preview` nothing touches the API: the reads come from the fixture, and the writes throw.
 */
export function useDraft({
  agent,
  staged,
  preview,
  onRefreshAgent,
}: {
  agent: Agent;
  staged: DraftStaged | null;
  preview: boolean;
  onRefreshAgent(): Promise<void>;
}): UseDraft {
  const offline = preview || staged !== null;
  const agentId = agent.productId ?? agent.id;
  const [wallets, setWallets] = useState<StudioWallets | null>(staged?.wallets ?? null);
  const [activity, setActivity] = useState<ActivityEvent[] | null>(staged?.activity ?? null);
  const [x, setX] = useState<XState | null>(staged?.x ?? null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(staged?.ledger ?? null);
  const [error, setError] = useState("");

  /* The latest agent and refresh, so a write started before a reload saves at the version after
     it, and the callbacks below stay stable across renders. */
  const version = useRef(agent.version);
  const refreshAgent = useRef(onRefreshAgent);
  useEffect(() => {
    version.current = agent.version;
    refreshAgent.current = onRefreshAgent;
  }, [agent.version, onRefreshAgent]);
  /* Answers that land after the studio moved to another agent, or closed, are dropped. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, [agentId]);

  const guard = useCallback(() => {
    if (offline) {
      throw new StudioError("PREVIEW", PREVIEW_NOTE);
    }
  }, [offline]);

  const readWallets = useCallback(async () => {
    if (offline) {
      return staged?.wallets ?? null;
    }
    try {
      const read = await studioWallets();
      if (alive.current) {
        setWallets(read);
      }
      return read;
    } catch (caught) {
      if (alive.current) {
        setError(message(caught, "Could not read your wallets."));
      }
      return null;
    }
  }, [offline, staged]);

  const readActivity = useCallback(async () => {
    if (offline) {
      return;
    }
    try {
      const read = await agentActivity(agentId);
      if (alive.current) {
        setActivity(read.events);
      }
    } catch (caught) {
      if (alive.current) {
        setError(message(caught, "Could not read its activity."));
      }
    }
  }, [offline, agentId]);

  const readX = useCallback(async () => {
    if (offline) {
      return;
    }
    try {
      const read = await xState(agentId);
      if (alive.current) {
        setX(read);
      }
    } catch (caught) {
      if (alive.current) {
        setError(message(caught, "Could not read its X account."));
      }
    }
  }, [offline, agentId]);

  const readLedger = useCallback(async () => {
    if (offline) {
      return;
    }
    try {
      const read = await walletLedger();
      if (alive.current) {
        setLedger(read.entries);
      }
    } catch (caught) {
      if (alive.current) {
        setError(message(caught, "Could not read your transfers."));
      }
    }
  }, [offline]);

  const reloadAgent = useCallback(() => refreshAgent.current(), []);

  const refresh = useCallback(async () => {
    setError("");
    await Promise.all([readWallets(), readActivity(), readX()]);
  }, [readWallets, readActivity, readX]);

  /* Once per agent: the reads run side by side, and each failure only says so. */
  useEffect(() => {
    if (offline) {
      return;
    }
    let active = true;
    const fail = (fallback: string) => (caught: unknown) => {
      if (active) {
        setError(message(caught, fallback));
      }
    };
    studioWallets().then((read) => {
      if (active) {
        setWallets(read);
      }
    }, fail("Could not read your wallets."));
    agentActivity(agentId).then((read) => {
      if (active) {
        setActivity(read.events);
      }
    }, fail("Could not read its activity."));
    xState(agentId).then((read) => {
      if (active) {
        setX(read);
      }
    }, fail("Could not read its X account."));
    return () => {
      active = false;
    };
  }, [offline, agentId]);

  const saveSetup = useCallback(
    async (patch: Omit<SetupUpdateDto, "expectedVersion">) => {
      guard();
      const saved = await saveDraftSetup(agentId, { ...patch, expectedVersion: version.current });
      version.current = saved.version;
      await refreshAgent.current();
      return saved;
    },
    [guard, agentId],
  );

  const saveIdentity = useCallback(
    async (body: IdentityUpdateDto) => {
      guard();
      const saved = await putIdentity(agentId, body);
      await refreshAgent.current();
      return saved;
    },
    [guard, agentId],
  );

  const saveInterval = useCallback(
    async (hours: IntervalHours) => {
      guard();
      await setIntervalHours(agentId, hours);
      await refreshAgent.current();
    },
    [guard, agentId],
  );

  const challengeX = useCallback(
    async (handle: string) => {
      guard();
      const challenge = await xChallenge(agentId, handle);
      if (alive.current) {
        setX((current) => ({ account: null, available: true, ...current, challenge }));
      }
      return challenge;
    },
    [guard, agentId],
  );

  const verifyX = useCallback(async () => {
    guard();
    const result = await xVerify(agentId);
    if (result.verified) {
      await Promise.all([readX(), refreshAgent.current()]);
    }
    return result;
  }, [guard, agentId, readX]);

  const disconnectX = useCallback(async () => {
    guard();
    await xDisconnect(agentId);
    await Promise.all([readX(), refreshAgent.current()]);
  }, [guard, agentId, readX]);

  const publish = useCallback(async () => {
    guard();
    const result = await publishAgent(agentId);
    setTimeout(() => {
      if (alive.current) {
        void refreshAgent.current().catch((caught: unknown) => {
          if (alive.current) {
            setError(message(caught, "Could not read the agent."));
          }
        });
      }
    }, LIVE_HOLD_MS);
    return result;
  }, [guard, agentId]);

  return {
    wallets,
    activity,
    x,
    ledger,
    error,
    preview: offline,
    refresh,
    readWallets,
    readLedger,
    refreshAgent: reloadAgent,
    saveSetup,
    saveIdentity,
    saveInterval,
    challengeX,
    verifyX,
    disconnectX,
    publish,
  };
}
