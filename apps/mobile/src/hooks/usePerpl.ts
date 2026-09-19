import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { accountAddress, type AccountState } from "../account";
import { PERPL_URLS } from "../config/perpl";
import { enrollTradingKey, generateTradingKey } from "../perpl/apiKey";
import { clockSkewMs as measureSkew } from "../perpl/clock";
import { CONTEXT_POLL_MS, PERPL_CHAIN_ID, SOCKET_GRACE_MS } from "../perpl/config";
import { type Context, fetchContext, type Market } from "../perpl/context";
import { EnableError, type EnableStep, runEnable } from "../perpl/enable";
import {
  approveExchange, createExchangeAccount, depositCollateral, enableForwarding, readAccountId, readAllowance, withdrawCollateral,
} from "../perpl/onboarding";
import { closeIntent, openIntent, type Side, sizeFromAusd } from "../perpl/orders";
import { type Account, type OrderOutcome, type Position, type SocketStatus, TradingSocket, type TradingState } from "../perpl/ws";
import { loadTradingKey, saveTradingKey, type TradingKey } from "../storage/perpl";
import { readBalances, waitForReceipt } from "../wallet/chain";
import { describeError, type Wallet } from "../wallet/wallet";
import type { Treasury } from "./useTreasury";
import { useUnlock } from "./useUnlock";

export type PerplState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "onboarding"; step: EnableStep; error?: string }
  | { status: "ready"; key: TradingKey };

export type Live = { status: SocketStatus; account: Account | null; positions: Position[]; head: number; keyRejected: boolean };

export type Perpl = {
  state: PerplState;
  context: Context | null;
  contextError: string;
  live: Live | null;
  lastBalance: bigint | null;
  /** serverTime − Date.now() del último pub/context; null sin header `Date` (D19). Con override de dev, el override. */
  clockSkewMs: number | null;
  /** Cuenta de Perpl de esta wallet mientras no hay key (D21): null = sin sondear, 0n = no existe, >0n = existe. */
  existingAccountId: bigint | null;
  /** Sólo DevControls (__DEV__): fuerza un desfase para ver el aviso en el simulador. */
  setClockSkewOverride: (ms: number | null) => void;
  enable: (amount: bigint) => Promise<void>;
  enableForwardingOnly: () => Promise<void>;
  addFunds: (amount: bigint, onSent: (hash: Hex) => void) => Promise<"success" | "reverted">;
  withdraw: (amount: bigint, onSent: (hash: Hex) => void) => Promise<"success" | "reverted">;
  open: (market: Market, side: Side, ausd: bigint, lv: number) => Promise<OrderOutcome>;
  close: (market: Market, position: Position) => Promise<OrderOutcome>;
  resetKey: () => Promise<void>;
  setActive: (active: boolean) => void;
  refreshContext: () => Promise<void>;
};

const NO_MON = "You need test MON for gas. Get some at the Monad faucet and try again.";
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

function describeTxError(e: unknown): string {
  const msg = describeError(e instanceof EnableError ? e.cause : e);
  // El RPC de Monad devuelve "…rejected…" cuando descarta una tx (nonce/fee); los errores de enroll
  // ("Perpl rejected the enrolment (500).") también dicen "rejected" pero deben mostrarse tal cual.
  return /rejected/i.test(msg) && !/perpl/i.test(msg) ? "Network refused the transaction — try again in a moment." : msg;
}

async function confirm(hash: Hex): Promise<void> {
  if ((await waitForReceipt(hash)) !== "success") throw new Error("The transaction reverted.");
}

function toLive(state: TradingState, status: SocketStatus, keyRejected: boolean): Live {
  return { status, account: state.account, positions: [...state.positions.values()], head: state.head, keyRejected };
}

export function usePerpl(account: AccountState, onUnlock: (w: Wallet) => void, treasury: Treasury): Perpl {
  const address = accountAddress(account);
  const openWallet = useUnlock(account, onUnlock);
  const [state, setState] = useState<PerplState>({ status: "loading" });
  const [context, setContext] = useState<Context | null>(null);
  const [contextError, setContextError] = useState("");
  const [live, setLive] = useState<Live | null>(null);
  const [lastBalance, setLastBalance] = useState<bigint | null>(null);
  const [measuredSkew, setMeasuredSkew] = useState<number | null>(null);
  const [skewOverride, setSkewOverride] = useState<number | null>(null);
  const [existingAccountId, setExistingAccountId] = useState<bigint | null>(null);
  const [active, setActiveState] = useState(false);
  const socketRef = useRef<TradingSocket | null>(null);
  const liveRef = useRef<Live | null>(null);
  const forwardedRef = useRef(false); // paso 3 ya enviado en esta sesión (no hay getter on-chain)
  const graceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  liveRef.current = live;

  // Arranque y cambio de cuenta: la key guardada vale solo para su address.
  useEffect(() => {
    let stale = false;
    forwardedRef.current = false;
    if (!address) {
      setState({ status: "none" });
      setLastBalance(null);
      return;
    }
    setState({ status: "loading" });
    loadTradingKey()
      .then((key) => { if (!stale) setState(key && same(key.address, address) ? { status: "ready", key } : { status: "none" }); })
      .catch(() => { if (!stale) setState({ status: "none" }); });
    return () => { stale = true; };
  }, [address]);

  const refreshContext = useCallback(async () => {
    try {
      const ctx = await fetchContext(PERPL_URLS.rest);
      setMeasuredSkew(measureSkew(ctx.serverTime, Date.now()));
      setContext(ctx);
      setContextError("");
    } catch (e) {
      setContextError(describeError(e) || "Couldn't load markets.");
    }
  }, []);

  // Polling de precios solo con la pestaña activa.
  useEffect(() => {
    if (!active) return;
    void refreshContext();
    const timer = setInterval(() => { void refreshContext(); }, CONTEXT_POLL_MS);
    return () => clearInterval(timer);
  }, [active, refreshContext]);

  // Reconnect trading (D21): sin key, ¿esta wallet ya tiene cuenta en el exchange?
  useEffect(() => {
    if (state.status !== "none" || !address) { setExistingAccountId(null); return; }
    let stale = false;
    readAccountId(address)
      .then((id) => { if (!stale) setExistingAccountId(id); })
      .catch(() => { if (!stale) setExistingAccountId(null); });
    return () => { stale = true; };
  }, [state.status, address, context]);

  // Socket: vive mientras la pestaña está activa y hay key.
  const key = state.status === "ready" ? state.key : null;
  useEffect(() => {
    if (!active || !key) {
      setLive(null);
      return;
    }
    let keyRejected = false;
    const socket = new TradingSocket({
      url: PERPL_URLS.ws, chainId: PERPL_CHAIN_ID, apiKey: key.apiKey, privateKey: key.privateKey,
      onEvent: (e) => {
        if (e.type === "keyRejected") keyRejected = true;
        const next = toLive(socket.state, socket.status, keyRejected);
        setLive(next);
        if (next.account) setLastBalance(next.account.b);
      },
    });
    socketRef.current = socket;
    socket.connect();
    setLive(toLive(socket.state, socket.status, false));
    return () => {
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [active, key]);

  const setClockSkewOverride = useCallback((ms: number | null) => setSkewOverride(ms), []);

  const setActive = useCallback((next: boolean) => {
    if (graceRef.current) { clearTimeout(graceRef.current); graceRef.current = null; }
    if (next) setActiveState(true);
    else graceRef.current = setTimeout(() => { graceRef.current = null; setActiveState(false); }, SOCKET_GRACE_MS);
  }, []);

  const enable = useCallback(async (amount: bigint) => {
    if (!address) return;
    setState({ status: "onboarding", step: 1 });
    try {
      const fresh = await readBalances(address);
      if (fresh.mon === 0n) throw new EnableError(1, new Error(NO_MON));
      const wallet = await openWallet();
      const result = await runEnable({
        readAccountId: () => readAccountId(address),
        walletAusd: async () => (await readBalances(address)).ausd,
        readAllowance: () => readAllowance(address),
        approve: async (a) => confirm(await approveExchange(wallet, a)),
        createAccount: async (a) => confirm(await createExchangeAccount(wallet, a)),
        isForwarding: async () => (forwardedRef.current || liveRef.current?.account?.fw === true ? true : undefined),
        allowForwarding: async () => { await confirm(await enableForwarding(wallet)); forwardedRef.current = true; },
        loadKey: async (id) => {
          const stored = await loadTradingKey();
          return stored && same(stored.address, address) && stored.accountId === id ? stored : undefined;
        },
        enrollKey: async (id) => {
          const pair = generateTradingKey();
          const apiKey = await enrollTradingKey(wallet, pair.publicKeyHex, pair.privateKey, PERPL_URLS.rest);
          const stored: TradingKey = { address, accountId: id, apiKey, privateKey: pair.privateKey };
          await saveTradingKey(stored);
          return stored;
        },
      }, amount, (step) => setState({ status: "onboarding", step }));
      setState({ status: "ready", key: result });
      void treasury.refresh();
    } catch (e) {
      const msg = describeTxError(e);
      if (msg === "") { setState({ status: "none" }); return; } // Face ID cancelado: lo hecho queda on-chain
      setState({ status: "onboarding", step: e instanceof EnableError ? e.step : 1, error: msg });
    }
  }, [address, openWallet, treasury]);

  const enableForwardingOnly = useCallback(async () => {
    const wallet = await openWallet();
    await confirm(await enableForwarding(wallet));
    forwardedRef.current = true;
  }, [openWallet]);

  const move = useCallback(async (kind: "add" | "withdraw", amount: bigint, onSent: (hash: Hex) => void): Promise<"success" | "reverted"> => {
    if (!address) throw new Error("No account.");
    const fresh = await readBalances(address);
    if (fresh.mon === 0n) throw new Error(NO_MON);
    if (kind === "add" && amount > fresh.ausd) throw new Error("That is more than the AUSD in your wallet.");
    const wallet = await openWallet();
    if (kind === "add" && (await readAllowance(address)) < amount) await confirm(await approveExchange(wallet, amount));
    let hash: Hex;
    try {
      hash = kind === "add" ? await depositCollateral(wallet, amount) : await withdrawCollateral(wallet, amount);
    } catch (e) {
      throw new Error(describeTxError(e) || "Couldn't send the transaction.");
    }
    onSent(hash);
    const status = await waitForReceipt(hash);
    void treasury.refresh();
    return status;
  }, [address, openWallet, treasury]);

  const addFunds = useCallback((amount: bigint, onSent: (hash: Hex) => void) => move("add", amount, onSent), [move]);
  const withdraw = useCallback((amount: bigint, onSent: (hash: Hex) => void) => move("withdraw", amount, onSent), [move]);

  const place = useCallback(async (run: (socket: TradingSocket) => Promise<OrderOutcome>): Promise<OrderOutcome> => {
    const socket = socketRef.current;
    if (!socket) return { kind: "failed", text: "Not connected to Perpl. Open the Trade tab and wait for Live." };
    try {
      return await run(socket);
    } catch (e) {
      return { kind: "failed", text: describeError(e) || "Perpl rejected the order." };
    }
  }, []);

  const open = useCallback((market: Market, side: Side, ausd: bigint, lv: number) => place(async (socket) => {
    if (!key) throw new Error("Enable trading first.");
    const size = sizeFromAusd(ausd, lv, market.mark, market.priceDecimals, market.sizeDecimals);
    if (size <= 0) throw new Error("That amount is below one unit of this market.");
    return socket.placeOrder(openIntent(market, Number(key.accountId), side, size, lv));
  }), [key, place]);

  const close = useCallback((market: Market, position: Position) => place(async (socket) => {
    if (!key) throw new Error("Enable trading first.");
    return socket.placeOrder(closeIntent(market, Number(key.accountId), position));
  }), [key, place]);

  const resetKey = useCallback(async () => {
    if (!address || !key) return;
    const wallet = await openWallet();
    const pair = generateTradingKey(); // saveTradingKey sobrescribe: si el enroll falla, la key anterior sigue guardada
    const apiKey = await enrollTradingKey(wallet, pair.publicKeyHex, pair.privateKey, PERPL_URLS.rest);
    const stored: TradingKey = { address, accountId: key.accountId, apiKey, privateKey: pair.privateKey };
    await saveTradingKey(stored);
    setState({ status: "ready", key: stored }); // el efecto del socket lo recrea con la key nueva
  }, [address, key, openWallet]);

  return {
    state, context, contextError, live, lastBalance,
    clockSkewMs: skewOverride ?? measuredSkew, existingAccountId, setClockSkewOverride,
    enable, enableForwardingOnly, addFunds, withdraw, open, close, resetKey, setActive, refreshContext,
  };
}
