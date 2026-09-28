import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { accountAddress, type AccountState } from "../account";
import { PUSH_MODE, READS_URL } from "../config/reads";
import type { Side } from "../perpl/orders";
import { describeReadsError, fetchAgents, fetchRead, fetchReads, isSessionError, postReminders, requestRead } from "../reads/api";
import { READS_POLL_MS } from "../reads/constants";
import type { ReminderKind } from "../reads/level";
import { createSession, type ReadsSession, sessionFor } from "../reads/session";
import type { Agent, Read } from "../reads/types";
import { clearReadsSession, loadReadsSession, saveReadsSession } from "../storage/reads";
import type { AskCell, TradeLevel } from "../store";
import { describeError, type Wallet } from "../wallet/wallet";
import type { Notifications } from "./useNotifications";
import { useUnlock } from "./useUnlock";

export type ReadsSessionStatus = "none" | "signing" | "ready";
export type RequestState =
  | { step: "idle" }
  | { step: "pending"; cell: AskCell; agentId: string }
  | { step: "done"; read: Read }
  | { step: "failed"; text: string };

export type RemindersOutcome = { ok: true; kinds: ReminderKind[] } | { ok: false; text: string };

export type Reads = {
  session: ReadsSessionStatus;
  sessionError: string;
  credits: number | null;
  /** Todas tus reads, más recientes primero (máx. 50, D26). */
  /** `null` = todavía no se pidió (sin sesión o en vuelo); `[]` = pedido y vacío. */
  reads: Read[] | null;
  listError: string;
  agents: Agent[] | null;
  agentsError: string;
  request: RequestState;
  /** Firma la sesión si hace falta (Face ID si la wallet está bloqueada). true si quedó lista. */
  ensureSession: () => Promise<boolean>;
  /** agents-list + reads-list del mercado activo (pull-to-refresh). */
  refresh: () => Promise<void>;
  ask: (cell: AskCell, agentId: string) => Promise<void>;
  /** Una read por id (pantalla Read abierta desde un push, D14): primero la lista; si no está, read-get. */
  fetchOne: (id: string) => Promise<Read | null>;
  resetRequest: () => void;
  /** «Trade this level» tras una orden filled/open (D12, P7–P8): reminder-set con el nivel y el lado; local además con PUSH_MODE local. */
  setReminders: (symbol: string, level: TradeLevel, side: Side) => Promise<RemindersOutcome>;
  setActive: (active: boolean) => void;
};

const upsert = (list: Read[], read: Read): Read[] => [read, ...list.filter((r) => r.id !== read.id)];

export function useReads(account: AccountState, onUnlock: (w: Wallet) => void, notifications: Notifications, marketId: number | undefined): Reads {
  const address = accountAddress(account);
  const openWallet = useUnlock(account, onUnlock);
  const [status, setStatus] = useState<ReadsSessionStatus>("none");
  const [sessionError, setSessionError] = useState("");
  const [credits, setCredits] = useState<number | null>(null);
  const [reads, setReads] = useState<Read[] | null>(null);
  const [listError, setListError] = useState("");
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [agentsError, setAgentsError] = useState("");
  const [request, setRequest] = useState<RequestState>({ step: "idle" });
  const [active, setActive] = useState(false);
  const sessionRef = useRef<ReadsSession | null>(null);
  // Actualizados en cada render (no en un efecto) para que el trabajo async en vuelo pueda comparar
  // contra el valor vivo, no contra el que tenía cuando arrancó (Findings #2 y #4).
  const addressRef = useRef(address);
  addressRef.current = address;
  // true tras un 401 hasta que el usuario pulsa "Unlock" (ensureSession de nuevo): evita el bucle
  // firma → 401 → firma silenciosa cada 15 s (Finding #1, D6/P2).
  const droppedRef = useRef(false);
  // Promesa de firma en vuelo: una segunda llamada concurrente la reutiliza en vez de abrir Face ID dos veces (Finding #3).
  const signingRef = useRef<Promise<boolean> | null>(null);
  const { ensurePermission, scheduleLocal, scheduleLocalReminders } = notifications; // el objeto cambia por render; las funciones son estables

  const dropSession = useCallback(async () => {
    sessionRef.current = null;
    droppedRef.current = true;
    setStatus("none");
    setCredits(null);
    setReads(null);
    await clearReadsSession().catch(() => {});
  }, []);

  // Arranque y cambio de cuenta: la sesión guardada vale sólo para su dirección y mientras sea usable (P2).
  useEffect(() => {
    let stale = false;
    sessionRef.current = null;
    droppedRef.current = false;
    setStatus("none");
    setCredits(null);
    setReads(null);
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

  const ensureSession = useCallback((): Promise<boolean> => {
    if (signingRef.current) return signingRef.current; // ya hay una firma en vuelo: no abrir Face ID otra vez (Finding #3)
    const run = async (): Promise<boolean> => {
      droppedRef.current = false; // el usuario (o ask()) pidió sesión explícitamente: se puede volver a intentar
      if (!address) return false;
      if (sessionRef.current && sessionFor(sessionRef.current, address)) return true;
      setStatus("signing");
      setSessionError("");
      try {
        const wallet = await openWallet();
        const s = await createSession((m) => wallet.account.signMessage({ message: m }), wallet.address);
        // La cuenta pudo cambiar mientras se firmaba: si ya no coincide, no se persiste nada (Finding #4).
        const current = addressRef.current;
        if (
          current === null ||
          current.toLowerCase() !== address.toLowerCase() ||
          wallet.address.toLowerCase() !== address.toLowerCase()
        ) {
          setStatus("none");
          return false;
        }
        await saveReadsSession(s);
        sessionRef.current = s;
        setStatus("ready");
        return true;
      } catch (e) {
        setStatus("none");
        setSessionError(describeError(e)); // "" si canceló Face ID
        // sin gesto del usuario no se reintenta: evita signing → none → signing si la firma falla por algo que no es 401
        droppedRef.current = true;
        return false;
      }
    };
    const p = run().finally(() => { signingRef.current = null; });
    signingRef.current = p;
    return p;
  }, [address, openWallet]);

  // Con la wallet ya abierta no hay prompt: se firma sola al activar Ask (P3), pero nunca tras un 401
  // sin que el usuario toque el botón "Unlock" del gate (Finding #1, D6/P2).
  useEffect(() => {
    if (active && status === "none" && account.status === "unlocked" && !droppedRef.current) void ensureSession();
  }, [active, status, account.status, ensureSession]);

  // Al cambiar de mercado, la card done/failed no debe seguir pintada en el Ask de otro mercado (revisión final F2, Minor 4).
  useEffect(() => { setRequest({ step: "idle" }); }, [marketId]);

  const loadAgents = useCallback(async () => {
    try { setAgents(await fetchAgents(READS_URL)); setAgentsError(""); }
    catch (e) { setAgentsError(describeReadsError(e)); }
  }, []);

  const loadReads = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      const r = await fetchReads(READS_URL, s); // todas tus reads (máx. 50); el board filtra por mercado (D26)
      setReads(r.reads);
      setCredits(r.credits);
      setListError("");
    } catch (e) {
      if (isSessionError(e)) { await dropSession(); return; }
      setListError(describeReadsError(e));
    }
  }, [dropSession]);

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
      setReads((list) => upsert(list ?? [], read));
      if (read.status === "failed") { setRequest({ step: "failed", text: "The agent couldn't answer. Refunded 1 credit." }); return; }
      setRequest({ step: "done", read });
      if (PUSH_MODE === "local") void scheduleLocal(read);
    } catch (e) {
      if (isSessionError(e)) await dropSession();
      setRequest({ step: "failed", text: describeReadsError(e) });
      void loadReads(); // la read puede haber quedado open o failed aunque el POST no volviera (P4)
    }
  }, [marketId, ensureSession, ensurePermission, scheduleLocal, dropSession, loadReads]);

  /** Una read por id (pantalla Read abierta desde un push, D14): primero la lista; si no está, read-get. */
  const fetchOne = useCallback(async (id: string): Promise<Read | null> => {
    if (!(await ensureSession())) return null;
    try {
      const read = await fetchRead(READS_URL, sessionRef.current!, id);
      setReads((list) => upsert(list ?? [], read));
      return read;
    } catch (e) {
      if (isSessionError(e)) await dropSession();
      return null;
    }
  }, [ensureSession, dropSession]);

  const resetRequest = useCallback(() => setRequest({ step: "idle" }), []);

  const setReminders = useCallback(async (symbol: string, level: TradeLevel, side: Side): Promise<RemindersOutcome> => {
    if (!(await ensureSession())) return { ok: false, text: "Unlock Ask to set reminders." };
    const s = sessionRef.current!;
    const device = PUSH_MODE === "apns" ? await ensurePermission() : null; // misma política que ask(): el permiso se pide cuando algo lo necesita (P6 de F2)
    try {
      const rows = await postReminders(READS_URL, s, {
        marketId: level.marketId, levelBps: level.levelBps, horizonMin: level.horizonMin, target: level.target, expiresAt: level.expiresAt, side,
        ...(level.readId ? { readId: level.readId } : {}),
        ...(device ? { pushToken: device.token, pushEnv: device.env } : {}),
      });
      if (PUSH_MODE === "local") void scheduleLocalReminders(symbol, level);
      return { ok: true, kinds: rows.map((r) => r.kind) };
    } catch (e) {
      if (isSessionError(e)) await dropSession();
      return { ok: false, text: describeReadsError(e) };
    }
  }, [ensureSession, ensurePermission, scheduleLocalReminders, dropSession]);

  return { session: status, sessionError, credits, reads, listError, agents, agentsError, request, ensureSession, refresh, ask, fetchOne, resetRequest, setReminders, setActive };
}
