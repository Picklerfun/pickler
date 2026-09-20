import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { accountAddress, type AccountState } from "../account";
import { PUSH_MODE, READS_URL } from "../config/reads";
import { describeReadsError, fetchAgents, fetchReads, isSessionError, requestRead } from "../reads/api";
import { READS_POLL_MS } from "../reads/constants";
import { createSession, type ReadsSession, sessionFor } from "../reads/session";
import type { Agent, Read } from "../reads/types";
import { clearReadsSession, loadReadsSession, saveReadsSession } from "../storage/reads";
import type { AskCell } from "../store";
import { describeError, type Wallet } from "../wallet/wallet";
import type { Notifications } from "./useNotifications";
import { useUnlock } from "./useUnlock";

export type ReadsSessionStatus = "none" | "signing" | "ready";
export type RequestState =
  | { step: "idle" }
  | { step: "pending"; cell: AskCell; agentId: string }
  | { step: "done"; read: Read }
  | { step: "failed"; text: string };

export type Reads = {
  session: ReadsSessionStatus;
  sessionError: string;
  credits: number | null;
  /** Reads del mercado activo, más recientes primero (máx. 50, D16). */
  reads: Read[];
  listError: string;
  agents: Agent[] | null;
  agentsError: string;
  request: RequestState;
  /** Firma la sesión si hace falta (Face ID si la wallet está bloqueada). true si quedó lista. */
  ensureSession: () => Promise<boolean>;
  /** agents-list + reads-list del mercado activo (pull-to-refresh). */
  refresh: () => Promise<void>;
  ask: (cell: AskCell, agentId: string) => Promise<void>;
  resetRequest: () => void;
  setActive: (active: boolean) => void;
};

const upsert = (list: Read[], read: Read): Read[] => [read, ...list.filter((r) => r.id !== read.id)];

export function useReads(account: AccountState, onUnlock: (w: Wallet) => void, notifications: Notifications, marketId: number | undefined): Reads {
  const address = accountAddress(account);
  const openWallet = useUnlock(account, onUnlock);
  const [status, setStatus] = useState<ReadsSessionStatus>("none");
  const [sessionError, setSessionError] = useState("");
  const [credits, setCredits] = useState<number | null>(null);
  const [reads, setReads] = useState<Read[]>([]);
  const [listError, setListError] = useState("");
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [agentsError, setAgentsError] = useState("");
  const [request, setRequest] = useState<RequestState>({ step: "idle" });
  const [active, setActive] = useState(false);
  const sessionRef = useRef<ReadsSession | null>(null);
  const { ensurePermission, scheduleLocal } = notifications; // el objeto cambia por render; las funciones son estables

  const dropSession = useCallback(async () => {
    sessionRef.current = null;
    setStatus("none");
    setCredits(null);
    setReads([]);
    await clearReadsSession().catch(() => {});
  }, []);

  // Arranque y cambio de cuenta: la sesión guardada vale sólo para su dirección y mientras sea usable (P2).
  useEffect(() => {
    let stale = false;
    sessionRef.current = null;
    setStatus("none");
    setCredits(null);
    setReads([]);
    setRequest({ step: "idle" });
    if (!address) return;
    loadReadsSession()
      .then((s) => {
        if (stale) return;
        const usable = sessionFor(s, address);
        if (usable) { sessionRef.current = usable; setStatus("ready"); }
      })
      .catch(() => {});
    return () => { stale = true; };
  }, [address]);

  const ensureSession = useCallback(async (): Promise<boolean> => {
    if (!address) return false;
    if (sessionRef.current && sessionFor(sessionRef.current, address)) return true;
    setStatus("signing");
    setSessionError("");
    try {
      const wallet = await openWallet();
      const s = await createSession((m) => wallet.account.signMessage({ message: m }), wallet.address);
      await saveReadsSession(s);
      sessionRef.current = s;
      setStatus("ready");
      return true;
    } catch (e) {
      setStatus("none");
      setSessionError(describeError(e)); // "" si canceló Face ID
      return false;
    }
  }, [address, openWallet]);

  // Con la wallet ya abierta no hay prompt: se firma sola al activar Ask (P3).
  useEffect(() => {
    if (active && status === "none" && account.status === "unlocked") void ensureSession();
  }, [active, status, account.status, ensureSession]);

  const loadAgents = useCallback(async () => {
    try { setAgents(await fetchAgents(READS_URL)); setAgentsError(""); }
    catch (e) { setAgentsError(describeReadsError(e)); }
  }, []);

  const loadReads = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      const r = await fetchReads(READS_URL, s, marketId);
      setReads(r.reads);
      setCredits(r.credits);
      setListError("");
    } catch (e) {
      if (isSessionError(e)) { await dropSession(); return; }
      setListError(describeReadsError(e));
    }
  }, [marketId, dropSession]);

  const refresh = useCallback(async () => { await Promise.allSettled([loadAgents(), loadReads()]); }, [loadAgents, loadReads]);

  // Polling de 15 s mientras Ask/Agents está visible, y refetch al volver al foreground (D16, P11).
  useEffect(() => {
    if (!active) return;
    void loadAgents();
    if (status !== "ready") return;
    void loadReads();
    const timer = setInterval(() => { void loadReads(); }, READS_POLL_MS);
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") void loadReads(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [active, status, loadAgents, loadReads]);

  const ask = useCallback(async (cell: AskCell, agentId: string) => {
    if (marketId === undefined) return;
    if (!(await ensureSession())) return;
    const s = sessionRef.current!;
    const device = PUSH_MODE === "apns" ? await ensurePermission() : null; // primera confirmación → permiso (P6)
    setRequest({ step: "pending", cell, agentId });
    try {
      const { read, credits: left } = await requestRead(READS_URL, s, {
        marketId, levelBps: cell.levelBps, horizonMin: cell.horizonMin, agentId,
        ...(device ? { pushToken: device.token, pushEnv: device.env } : {}),
      });
      setCredits(left);
      setReads((list) => upsert(list, read));
      if (read.status === "failed") { setRequest({ step: "failed", text: "The agent couldn't answer. Refunded 1 credit." }); return; }
      setRequest({ step: "done", read });
      if (PUSH_MODE === "local") void scheduleLocal(read);
    } catch (e) {
      if (isSessionError(e)) await dropSession();
      setRequest({ step: "failed", text: describeReadsError(e) });
      void loadReads(); // la read puede haber quedado open o failed aunque el POST no volviera (P4)
    }
  }, [marketId, ensureSession, ensurePermission, scheduleLocal, dropSession, loadReads]);

  const resetRequest = useCallback(() => setRequest({ step: "idle" }), []);

  return { session: status, sessionError, credits, reads, listError, agents, agentsError, request, ensureSession, refresh, ask, resetRequest, setActive };
}
