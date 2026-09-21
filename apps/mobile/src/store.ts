import { useCallback, useState } from "react";
import { currentParams, goBackIfCan, navigateTo, resetRootTo, signinIsRoot } from "./navigation/ref";
import { gateTarget } from "./navigation/routes";
import type { Screen } from "./navigation/screens";
import { COMING_SOON_COPY, type ComingSoonTab } from "./screens/comingSoonCopy";

// Pantalla y conjuntos puros viven en navigation/screens.ts (sin ciclo con routes.ts); se re-exportan desde aquí.
export { CAN_BACK, GATED, ROOT_OF, type Screen, SHOW_TABS } from "./navigation/screens";
export type MarketTab = "ask" | "trade" | "agents";
export type AskView = "new" | "mine";
export type AskCell = { levelBps: number; horizonMin: number };
/** Nivel elegido para «Trade this level» (D12; lo usa F3). */
export type TradeLevel = { marketId: number; levelBps: number; horizonMin: number; target: number; expiresAt: string; readId?: string };

/** Sólo datos (spec mobile-nav D3): la pila y la pantalla activa viven en react-navigation. */
export type StoreState = {
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

export type Patch = Partial<StoreState>;

export const INITIAL: StoreState = { marketTab: "trade", askView: "new" };

/** Tabs que todavía no hacen nada real: el Shell renderiza "Coming soon" (D5, D17). */
export const COMING_SOON: readonly ComingSoonTab[] = ["launchpad", "activity", "portfolio"];

export function isComingSoonTab(screen: Screen): screen is ComingSoonTab {
  return (COMING_SOON as readonly Screen[]).includes(screen);
}

/** Pantallas con pull-to-refresh y sello (mobile-loading D5). */
export const REFRESHABLE: readonly Screen[] = ["wallet", "markets", "market"];

/** Sign out: limpia el estado de Ask (revisión final F2, Minor 3): con otra cuenta no debe
 *  quedar una celda, agente o read enfocada de la sesión anterior. La pila la resetea el adaptador. */
export function signedOutState(s: StoreState): StoreState {
  return { ...s, askView: "new", askCell: undefined, askAgentId: undefined, askFocusReadId: undefined, tradeLevel: undefined };
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
 *  en Wallet no, así que `live === null` es «desconocido», no «cargando» (D2: skeleton sólo mientras algo se carga);
 *  socket cerrado definitivo o key rechazada = desconocido, no cargando. */
export function tradingLineState(live: { account: unknown; keyRejected?: boolean; status?: string } | null, lastBalance: bigint | null, socketActive: boolean): TradingLineState {
  if (live?.account) return "live";
  if (lastBalance !== null) return "lastSeen";
  if (live !== null && (live.keyRejected || live.status === "closed")) return "unknown";
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

export type AppStore = {
  S: StoreState;
  set: (patch: Patch) => void;
  nav: (screen: Screen, patch?: Patch) => void;
  back: () => void;
  requireAccount: (target: Screen, patch?: Patch) => void;
  /** Sign in terminado: vuelve a Tabs y aterriza en el `next` del gate (D5). */
  finishSignin: () => void;
  signedOut: () => void;
  hasAccount: boolean;
  /** Pantalla enfocada según react-navigation (D4). */
  scr: Screen;
  comingSoon: boolean;
};

export function useAppStore({ hasAccount, scr }: { hasAccount: boolean; scr: Screen }): AppStore {
  const [S, setS] = useState<StoreState>(INITIAL);
  const set = useCallback((patch: Patch) => setS((s) => ({ ...s, ...patch })), []);
  const nav = useCallback((screen: Screen, patch?: Patch) => { if (patch) set(patch); navigateTo(screen); }, [set]);
  const back = useCallback(() => goBackIfCan(), []);
  const requireAccount = useCallback((target: Screen, patch?: Patch) => {
    const g = gateTarget(hasAccount, target);
    if (g.screen === "signin") { navigateTo("signin", { next: g.next, patch }); return; }
    nav(target, patch);
  }, [hasAccount, nav]);
  const finishSignin = useCallback(() => {
    const p = currentParams();
    if (signinIsRoot()) resetRootTo("Tabs"); // arranque sin cuenta: no hay Tabs debajo (P3)
    nav(p?.next ?? "wallet", p?.patch); // con Tabs debajo, navigate vuelve a Tabs y saca signin
  }, [nav]);
  const signedOut = useCallback(() => { setS(signedOutState); resetRootTo("signin"); }, []);
  return { S, set, nav, back, requireAccount, finishSignin, signedOut, hasAccount, scr, comingSoon: isComingSoonTab(scr) };
}
