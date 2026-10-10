"use client";
import { useStudioMemory } from "../routing/memory";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { AdvicePriceUpdateDto, IdentityUpdateDto, SetupUpdateDto } from "@pickler/api-schema";
import {
  StudioError,
  saveDraftSetup,
  saveAdvicePrice as putAdvicePrice,
  saveIdentity as putIdentity,
  studioWallets,
  walletLedger,
  xAuthorize,
  xPosts,
  xDisconnect,
  xState,
  type Agent,
  type LedgerEntry,
  type StudioWallets,
  type XState,
} from "../api";

/** What a staged or preview studio says when anything on it tries to write. */
export const PREVIEW_NOTE = "Preview · fixture data, nothing is saved.";

/** What an agent's studio reads, draft or live, beyond the agent the shell already holds. */
export interface AgentStudioData {
  /** `GET /wallets`: the master wallet and the agent wallets; null until read. */
  wallets: StudioWallets | null;
  /** `GET /agents/:id/x`: OAuth connection state and availability; null until read. */
  x: XState | null;
  /** `GET /wallets/ledger`, read the first time Master wallet asks (`readLedger`); null until then. */
  ledger: LedgerEntry[] | null;
  /** The last failed read, in words, or "". Writes throw to their caller instead. */
  error: string;
  /** A fixture drew the studio: nothing is read, and every write throws `PREVIEW_NOTE`. */
  preview: boolean;
}

/** The reads again, and the writes both studios make, each one call. */
export interface UseAgentStudio extends AgentStudioData {
  /**
   * Wallets, the studio's own reads and X again (after a transfer, or a "Refresh"), and the ledger
   * once Master wallet has read it.
   */
  refresh(): Promise<void>;
  /** The wallets alone; answers them, or null when the read failed. */
  readWallets(): Promise<StudioWallets | null>;
  /** The ledger, for Master wallet. */
  readLedger(): Promise<void>;
  /** The agent again in the shell: after a save refused as stale (409 CONFLICT). Rejects. */
  refreshAgent(): Promise<void>;
  /**
   * `PUT /setup` at the agent's current version: brief, sources, caps and/or voice. Answers the
   * agent and reloads it in the shell. A 409 CONFLICT throws before any reload: the caller
   * reloads (`refreshAgent`) and says so.
   *
   * Every write below resolves once the write itself landed: a reload that fails after it does
   * not reject the write, it says so in `error` ("Saved. Could not reload the agent.").
   */
  saveSetup(patch: Omit<SetupUpdateDto, "expectedVersion">): Promise<Agent>;
  /** `PUT /identity`: name and/or avatar; reloads the agent. */
  saveIdentity(body: IdentityUpdateDto): Promise<Agent>;
  /** `PUT /advice-price`: the AUSD price of one analysis, or null for not for sale; reloads. */
  saveAdvicePrice(body: AdvicePriceUpdateDto): Promise<void>;
  /** `POST /x/authorize`: opens consent without unmounting the current form. */
  connectX(section?: "overview" | "identity"): Promise<void>;
  readPosts(cursor?: string): ReturnType<typeof xPosts>;

  /** `DELETE /x`, private or public; re-reads X and the agent. */
  disconnectX(section?: "overview" | "identity"): Promise<void>;
}

/**
 * What a studio's own reads and writes are built from (`use-draft.ts`'s activity, interval and
 * publish; the live studio's versions, markets and pause), so each keeps the contract of the ones
 * above without restating it.
 */
export interface StudioTools {
  agentId: string;
  /** A staged or preview studio: nothing touches the API. */
  offline: boolean;
  /** False once the studio moved to another agent, or closed: answers that land after are dropped. */
  alive: RefObject<boolean>;
  /** Throws the PREVIEW error on a staged or preview studio; every write starts with it. */
  guard(): void;
  /** Say a failed read in `error`, in the caught error's words or the fallback's. */
  fail(caught: unknown, fallback: string): void;
  /** The bare reload, for a caller that handles its failure (a stale save says "Reloaded."). */
  reloadAgent(): Promise<void>;
  /** The reload after a write that landed: a failure says so, and does not fail the write. */
  reloadAfterWrite(): Promise<void>;
}

/** The reads a `?stage=` fixture carries in place of the API's. */
export interface StagedStudio {
  wallets: StudioWallets;
  x: XState;
  ledger: LedgerEntry[];
}

const message = (caught: unknown, fallback: string) =>
  caught instanceof Error ? caught.message : fallback;

/**
 * The data both studios of an agent share: one read each of the wallets and the X state when the
 * agent opens, the ledger only when Master wallet asks, and the writes, which reload the agent in
 * the shell (`onRefreshAgent`) when they change it. `readMore` is the studio's own reads, run with
 * the first read and with every `refresh`. With `staged` (a `?stage=` fixture) or `preview` nothing
 * touches the API: the reads come from the fixture, and the writes throw.
 */
export function useAgentStudio({
  agent,
  staged,
  preview,
  onRefreshAgent,
  readMore,
}: {
  agent: Agent;
  staged: StagedStudio | null;
  preview: boolean;
  onRefreshAgent(): Promise<void>;
  /**
   * The studio's own reads. Held in a ref, so a reader that changes identity between renders does
   * not read again: the latest one runs with the first read and with every `refresh`.
   */
  readMore?(tools: StudioTools): Promise<unknown>;
}): { studio: UseAgentStudio; tools: StudioTools } {
  const memory = useStudioMemory();
  const offline = preview || staged !== null;
  const agentId = agent.productId ?? agent.id;
  const [wallets, setWallets] = useState<StudioWallets | null>(staged?.wallets ?? null);
  const [x, setX] = useState<XState | null>(staged?.x ?? null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(staged?.ledger ?? null);
  const [error, setError] = useState("");

  /* The latest agent and refresh, so a write started before a reload saves at the version after
     it, and the callbacks below stay stable across renders. */
  const version = useRef(agent.version);
  const refreshAgent = useRef(onRefreshAgent);
  const readMoreRef = useRef(readMore);
  useEffect(() => {
    version.current = agent.version;
    refreshAgent.current = onRefreshAgent;
    readMoreRef.current = readMore;
  }, [agent.version, onRefreshAgent, readMore]);
  /* Answers that land after the studio moved to another agent, or closed, are dropped. */
  const alive = useRef(true);
  /* Whether Master wallet has read the ledger, so `refresh` keeps it current from then on. */
  const ledgerRead = useRef(false);
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

  const fail = useCallback((caught: unknown, fallback: string) => {
    if (alive.current) {
      setError(message(caught, fallback));
    }
  }, []);

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
      fail(caught, "Could not read your wallets.");
      return null;
    }
  }, [offline, staged, fail]);

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
      fail(caught, "Could not read its X account.");
    }
  }, [offline, agentId, fail]);

  const readLedger = useCallback(async () => {
    if (offline) {
      return;
    }
    ledgerRead.current = true;
    try {
      const read = await walletLedger();
      if (alive.current) {
        setLedger(read.entries);
      }
    } catch (caught) {
      fail(caught, "Could not read your transfers.");
    }
  }, [offline, fail]);

  const reloadAgent = useCallback(() => refreshAgent.current(), []);

  const reloadAfterWrite = useCallback(
    () =>
      refreshAgent.current().catch((caught: unknown) => {
        fail(caught, "Saved. Could not reload the agent.");
      }),
    [fail],
  );

  const tools = useMemo<StudioTools>(
    () => ({ agentId, offline, alive, guard, fail, reloadAgent, reloadAfterWrite }),
    [agentId, offline, guard, fail, reloadAgent, reloadAfterWrite],
  );

  const more = useCallback(async () => {
    if (!offline) {
      await readMoreRef.current?.(tools);
    }
  }, [offline, tools]);

  const refresh = useCallback(async () => {
    setError("");
    await Promise.all([
      readWallets(),
      more(),
      readX(),
      ledgerRead.current ? readLedger() : undefined,
    ]);
  }, [readWallets, more, readX, readLedger]);

  /* Once per agent (the shell keys the studio by agent): the reads run side by side, and each
     failure only says so. */
  useEffect(() => {
    if (offline) {
      return;
    }
    /* The readers set state only once their answers land; starting them from a callback says so
       to the effect rule, which cannot see past their `await`. */
    void Promise.resolve().then(() => Promise.all([readWallets(), more(), readX()]));
  }, [offline, readWallets, more, readX]);

  const saveSetup = useCallback(
    async (patch: Omit<SetupUpdateDto, "expectedVersion">) => {
      guard();
      const saved = await saveDraftSetup(agentId, { ...patch, expectedVersion: version.current });
      version.current = saved.version;
      await reloadAfterWrite();
      return saved;
    },
    [guard, agentId, reloadAfterWrite],
  );

  const saveIdentity = useCallback(
    async (body: IdentityUpdateDto) => {
      guard();
      const saved = await putIdentity(agentId, body);
      await reloadAfterWrite();
      return saved;
    },
    [guard, agentId, reloadAfterWrite],
  );

  const saveAdvicePrice = useCallback(
    async (body: AdvicePriceUpdateDto) => {
      guard();
      await putAdvicePrice(agentId, body);
      await reloadAfterWrite();
    },
    [guard, agentId, reloadAfterWrite],
  );

  const connectionPopup = useRef<Window | null>(null);
  const connectionChannel = useRef<BroadcastChannel | null>(null);
  const connectionFlow = useRef<string | null>(null);
  const completeConnection = useCallback(
    (outcome: string) => {
      if (outcome !== "connected") {
        const messages: Record<string, string> = {
          cancelled: "X connection was cancelled. Try again when ready.",
          x_account_mismatch: "Disconnect the previous X account before changing it.",
          x_handle_taken: "That X account is already connected to another agent.",
          x_revocation_pending: "Finish disconnecting before reconnecting.",
        };
        fail(
          new Error(messages[outcome] ?? "Could not connect X. Please try again."),
          "Could not connect X.",
        );
      }
      void Promise.all([readX(), reloadAfterWrite()]);
    },
    [fail, readX, reloadAfterWrite],
  );
  useEffect(
    () => () => {
      connectionChannel.current?.close();
      connectionChannel.current = null;
      connectionFlow.current = null;
      connectionPopup.current?.close();
      connectionPopup.current = null;
    },
    [agentId],
  );
  const connectX = useCallback(
    async (section: "overview" | "identity" = "identity") => {
      guard();
      if (connectionPopup.current && !connectionPopup.current.closed) {
        connectionPopup.current.focus();
        return;
      }
      const popup = window.open("about:blank", "pickler-x-connect", "popup,width=640,height=720");
      connectionPopup.current = popup;
      if (!popup) {
        throw new Error("Allow popups to connect X without leaving your setup.");
      }
      try {
        const path = window.location.pathname === "/" ? "/" : "/studio";
        const result = await xAuthorize(
          agentId,
          `${path}?agent=${encodeURIComponent(agentId)}&resume=${encodeURIComponent(section)}`,
        );
        const flow = new URL(result.authorizationUrl).searchParams.get("state");
        if (!flow || !/^[A-Za-z0-9_-]{43}$/.test(flow)) {
          throw new Error("Could not start X authorization.");
        }
        connectionFlow.current = flow;
        connectionChannel.current?.close();
        if (typeof BroadcastChannel !== "undefined") {
          const channel = new BroadcastChannel(`pickler-x-${flow}`);
          connectionChannel.current = channel;
          channel.onmessage = (event) => {
            if (
              event.data?.type !== "pickler-x-oauth" ||
              event.data?.flow !== flow ||
              (event.data?.agentId && event.data.agentId !== agentId)
            ) {
              return;
            }
            channel.postMessage({ type: "received", flow });
            channel.onmessage = null;
            connectionFlow.current = null;
            completeConnection(event.data.outcome);
          };
        }
        popup.location.href = result.authorizationUrl;
      } catch (error) {
        popup.close();
        throw error;
      }
    },
    [guard, agentId, completeConnection],
  );

  const readPosts = useCallback(
    async (cursor?: string) => {
      guard();
      const scope = `${agentId}:x-preview:${x?.account?.handle ?? "disconnected"}:${x?.account?.verifiedAt ?? ""}`;
      if (memory.outcome(scope, false)) {
        throw new Error(
          "This session already requested an X preview. Open the account on X to view more posts.",
        );
      }
      memory.setOutcome(scope, true);
      return xPosts(agentId, cursor);
    },
    [guard, agentId, memory, x?.account?.handle, x?.account?.verifiedAt],
  );

  useEffect(() => {
    if (offline) {
      return;
    }
    const complete = (event: MessageEvent) => {
      if (
        event.source !== connectionPopup.current ||
        event.origin !== window.location.origin ||
        event.data?.type !== "pickler-x-oauth" ||
        (event.data?.agentId && event.data.agentId !== agentId) ||
        event.data?.flow !== connectionFlow.current
      ) {
        return;
      }
      connectionFlow.current = null;
      completeConnection(event.data.outcome);
    };
    window.addEventListener("message", complete);
    return () => window.removeEventListener("message", complete);
  }, [agentId, offline, completeConnection]);

  const disconnectX = useCallback(async () => {
    guard();
    await xDisconnect(agentId);
    await Promise.all([readX(), reloadAfterWrite()]);
  }, [guard, agentId, readX, reloadAfterWrite]);

  return {
    studio: {
      wallets,
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
      saveAdvicePrice,
      connectX,
      readPosts,
      disconnectX,
    },
    tools,
  };
}
