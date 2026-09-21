import { useCallback, useState } from "react";
import { COMING_SOON_COPY, type ComingSoonTab } from "./screens/comingSoonCopy";

export type Screen =
  | "markets" | "market" | "perpsFunds"
  | "launchpad" | "activity" | "portfolio"
  | "wallet" | "deposit" | "withdraw" | "signin";
export type MarketTab = "ask" | "trade" | "agents";
export type AskView = "new" | "mine";
export type AskCell = { levelBps: number; horizonMin: number };
/** Nivel elegido para «Trade this level» (D12; lo usa F3). */
export type TradeLevel = { marketId: number; levelBps: number; horizonMin: number; target: number; expiresAt: string; readId?: string };

export type StoreState = {
  screen: Screen;
  stack: Screen[];
  /** A dónde ir al terminar Wallet access, y con qué patch. */
  next?: Screen;
  nextPatch?: Patch;
  /** Trading en Perpl: mercado y lado elegidos, pill activo de Market y modo de la pantalla de fondos. */
  perpsMarketId?: number;
  perpsSide?: "long" | "short";
  marketTab: MarketTab;
  fundsMode?: "add" | "withdraw";
  /** Ask (D13): segmentado New read | My reads, celda armada, agente elegido, read abierta desde la lista o desde un push. */
  askView: AskView;
  askCell?: AskCell;
  askAgentId?: string;
  askFocusReadId?: string;
  tradeLevel?: TradeLevel;
};

export type Patch = Partial<Omit<StoreState, "stack">>;

export const INITIAL: StoreState = { screen: "wallet", stack: [], marketTab: "trade", askView: "new" };

const STACK_MAX = 8;

export function navState(s: StoreState, screen: Screen, patch: Patch = {}): StoreState {
  return { ...s, ...patch, stack: [...s.stack, s.screen].slice(-STACK_MAX), screen };
}

export function backState(s: StoreState): StoreState {
  const stack = [...s.stack];
  const prev = stack.pop() ?? "wallet";
  return { ...s, stack, screen: prev };
}

/** Tabs que todavía no hacen nada real: el Shell renderiza "Coming soon" (D5, D17). */
export const COMING_SOON: readonly ComingSoonTab[] = ["launchpad", "activity", "portfolio"];

export function isComingSoonTab(screen: Screen): screen is ComingSoonTab {
  return (COMING_SOON as readonly Screen[]).includes(screen);
}

/** Pantallas que exigen cuenta. Los coming soon nunca la piden. */
export const GATED: readonly Screen[] = ["markets", "market", "perpsFunds", "wallet", "deposit", "withdraw"];
export const CAN_BACK: readonly Screen[] = ["market", "perpsFunds", "deposit", "withdraw", "signin"];
export const SHOW_TABS: readonly Screen[] = ["markets", "launchpad", "activity", "portfolio", "wallet"];
/** Qué tab se ilumina en cada pantalla (D4). */
export const ROOT_OF: Record<Screen, Screen> = {
  markets: "markets", market: "markets", perpsFunds: "markets",
  launchpad: "launchpad", activity: "activity", portfolio: "portfolio",
  wallet: "wallet", deposit: "wallet", withdraw: "wallet", signin: "wallet",
};

export function requireAccountState(s: StoreState, hasAccount: boolean, target: Screen, patch: Patch = {}): StoreState {
  if (hasAccount || !GATED.includes(target)) return navState(s, target, patch);
  return navState(s, "signin", { next: target, nextPatch: patch });
}

/** Tras el login aterriza en `next` sin dejar `signin` en el stack (como si se hubiera navegado directo). */
export function afterSigninState(s: StoreState): StoreState {
  const { next, nextPatch, ...rest } = s;
  return { ...rest, ...(nextPatch ?? {}), screen: next ?? "wallet" };
}

/** Al resolver la cuenta por primera vez: con cuenta se queda en Wallet; sin cuenta pasa por Sign in y aterriza en Wallet (D7). */
export function bootState(s: StoreState, hasAccount: boolean): StoreState {
  if (hasAccount) return s;
  return { ...s, screen: "signin", stack: [], next: "wallet", nextPatch: undefined };
}

export function resetState(s: StoreState, screen: Screen): StoreState {
  return { ...s, screen, stack: [], next: undefined, nextPatch: undefined };
}

/** Sign out: limpia todo y vuelve a Sign in, que aterriza en Wallet al entrar.
 *  También limpia el estado de Ask (revisión final F2, Minor 3): con otra cuenta no debe
 *  quedar una celda, agente o read enfocada de la sesión anterior. */
export function signedOutState(s: StoreState): StoreState {
  return bootState(
    resetState(
      { ...s, askView: "new", askCell: undefined, askAgentId: undefined, askFocusReadId: undefined, tradeLevel: undefined },
      "signin",
    ),
    false,
  );
}

/** `←` sólo si la pantalla lo permite Y hay algo en el stack al que volver. */
export function canBackFor(screen: Screen, stack: readonly Screen[]): boolean {
  return CAN_BACK.includes(screen) && stack.length > 0;
}

/** Texto de la tarjeta "We kept what you were about to do" de Sign in (D18); null si el gate no retuvo nada. */
export function heldActionFor(next: Screen | undefined): string | null {
  switch (next) {
    case "markets": case "market": return "Trading on Perpl";
    case "perpsFunds": return "Moving trading funds";
    case "deposit": return "A deposit";
    case "withdraw": return "A withdrawal";
    default: return null;
  }
}

/** Pill con el que se abre un mercado desde Markets: Trade con trading key, Ask sin ella (Ask y Agents no la necesitan; fix gate). */
export const marketEntryTab = (hasKey: boolean): MarketTab => (hasKey ? "trade" : "ask");

// ---------------------------------------------------------------------------
// Sello del pull-to-refresh (spec mobile-loading D5). Puros: el Shell los evalúa en un efecto.

/** `UPDATED HH:MM:SS` en hora local, 24 h. */
export function updatedLabel(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `UPDATED ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** `listError: null` = la fuente no se pidió (sin sesión de reads, `reads.refresh()` no toca el error): no cuenta como éxito. */
export type RefreshErrors = { rpcError: string; movementsError: string; contextError: string; listError: string | null };

/** Un jalón «hizo algo» si al menos una de las fuentes pedidas por la pantalla quedó sin error (los hooks tragan errores: `allSettled` no basta). */
export function refreshOk(screen: Screen, e: RefreshErrors): boolean {
  switch (screen) {
    case "wallet": return !e.rpcError || !e.movementsError;
    case "markets": return !e.contextError;
    case "market": return !e.contextError || (e.listError !== null && !e.listError);
    default: return false;
  }
}

export type TradingLineState = "live" | "lastSeen" | "skeleton" | "unknown";

/** Qué pinta la línea/card «AUSD in trading»: `socketActive` = la pantalla tiene el socket de Perpl (PERPL_SCREENS);
 *  en Wallet no, así que `live === null` es «desconocido», no «cargando» (D2: skeleton sólo mientras algo se carga). */
export function tradingLineState(live: { account: unknown } | null, lastBalance: bigint | null, socketActive: boolean): TradingLineState {
  if (live?.account) return "live";
  if (lastBalance !== null) return "lastSeen";
  return socketActive ? "skeleton" : "unknown";
}

/** La pantalla ya tiene su dato principal (contrato `null` = sin dato de los hooks): fija el sello inicial. */
export function screenHasData(screen: Screen, d: { balances: unknown; context: unknown }): boolean {
  switch (screen) {
    case "wallet": return d.balances !== null;
    case "markets":
    case "market": return d.context !== null;
    default: return false;
  }
}

const MARKET_SUBTITLES: Record<MarketTab, string> = {
  trade: "Perpl · isolated margin · market order",
  ask: "Ask an agent · simulated credits",
  agents: "Who reads this market",
};

export function headerFor(screen: Screen, perpsSymbol?: string, marketTab: MarketTab = "trade"): [string, string] {
  switch (screen) {
    case "markets": return ["Markets", "Perps on Perpl · Monad"];
    case "market": return [perpsSymbol ? `${perpsSymbol} Perp` : "Perp", MARKET_SUBTITLES[marketTab]];
    case "perpsFunds": return ["Trading funds", "Between wallet and trading"];
    case "wallet": return ["Wallet", "AUSD available and movements"];
    case "deposit": return ["Deposit AUSD", "Monad network"];
    case "withdraw": return ["Withdraw AUSD", "To an external address"];
    case "signin": return ["Wallet access", "Passkey on this device"];
    case "launchpad": case "activity": case "portfolio": return [COMING_SOON_COPY[screen].title, "Coming soon"];
  }
}

export type StoreInput = {
  /** `account.status !== "none"`. */
  hasAccount: boolean;
  /** Mercados de Perpl disponibles para resolver el símbolo del header. */
  perpsMarkets?: { id: number; symbol: string }[];
};

export type AppStore = {
  S: StoreState;
  set: (patch: Patch) => void;
  nav: (screen: Screen, patch?: Patch) => void;
  back: () => void;
  requireAccount: (target: Screen, patch?: Patch) => void;
  finishSignin: () => void;
  signedOut: () => void;
  boot: (hasAccount: boolean) => void;
  hasAccount: boolean;
  scr: Screen;
  headerTitle: string;
  headerSub: string;
  canBack: boolean;
  showTabs: boolean;
  comingSoon: boolean;
  /** Acción retenida por el gate, para la tarjeta de Sign in. */
  held: string | null;
};

export function useAppStore({ hasAccount, perpsMarkets }: StoreInput): AppStore {
  const [S, setS] = useState<StoreState>(INITIAL);

  const set = useCallback((patch: Patch) => setS((s) => ({ ...s, ...patch })), []);
  const nav = useCallback((screen: Screen, patch?: Patch) => setS((s) => navState(s, screen, patch)), []);
  const back = useCallback(() => setS(backState), []);
  const requireAccount = useCallback(
    (target: Screen, patch?: Patch) => setS((s) => requireAccountState(s, hasAccount, target, patch)),
    [hasAccount],
  );
  const finishSignin = useCallback(() => setS(afterSigninState), []);
  const signedOut = useCallback(() => setS(signedOutState), []);
  const boot = useCallback((has: boolean) => setS((s) => bootState(s, has)), []);

  const perpsSymbol = (perpsMarkets ?? []).find((m) => m.id === S.perpsMarketId)?.symbol;
  const [headerTitle, headerSub] = headerFor(S.screen, perpsSymbol, S.marketTab);

  return {
    S, set, nav, back, requireAccount, finishSignin, signedOut, boot,
    hasAccount, scr: S.screen, headerTitle, headerSub,
    canBack: canBackFor(S.screen, S.stack),
    showTabs: SHOW_TABS.includes(S.screen),
    comingSoon: isComingSoonTab(S.screen),
    held: heldActionFor(S.next),
  };
}
