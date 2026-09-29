import { useCallback, useState } from "react";
import { currentParams, goBackIfCan, navigateTo, resetRootTo, signinIsRoot, switchTab as switchTabRoute } from "./navigation/ref";
import { gateTarget, type TabName, TAB_ROOT } from "./navigation/routes";
import type { Screen } from "./navigation/screens";
import { COMING_SOON_COPY, type ComingSoonTab } from "./screens/comingSoonCopy";

// Pantalla y conjuntos puros viven en navigation/screens.ts (sin ciclo con routes.ts); se re-exportan desde aquí.
export { CAN_BACK, GATED, ROOT_OF, type Screen, SHOW_TABS } from "./navigation/screens";
export type MarketTab = "trade" | "ask";
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
  /** Ask: celda armada y agente elegido. */
  askCell?: AskCell;
  askAgentId?: string;
  /** Read abierta en la pantalla `read` (Portfolio → Reads, récord del perfil o push, D14/D22). */
  readId?: string;
  /** Perfil abierto en `agent` (F2). */
  agentId?: string;
  tradeLevel?: TradeLevel;
};

export type Patch = Partial<StoreState>;

export const INITIAL: StoreState = { marketTab: "trade" };

/** Launchpad y Activity: pantallas coming soon registradas, fuera de la barra (D1). */
export const COMING_SOON: readonly ComingSoonTab[] = ["launchpad", "activity"];

export function isComingSoonTab(screen: Screen): screen is ComingSoonTab {
  return (COMING_SOON as readonly Screen[]).includes(screen);
}

/** Pantallas con pull-to-refresh y sello (mobile-loading D5). */
export const REFRESHABLE: readonly Screen[] = ["wallet", "markets", "market", "portfolio"];

/** Sign out: limpia el estado de Ask (revisión final F2, Minor 3): con otra cuenta no debe
 *  quedar una celda, agente, read o perfil abiertos de la sesión anterior. La pila la resetea el adaptador. */
export function signedOutState(s: StoreState): StoreState {
  return { ...s, askCell: undefined, askAgentId: undefined, readId: undefined, agentId: undefined, tradeLevel: undefined };
}

/** Texto de la tarjeta "We kept what you were about to do" de Sign in (D18); null si el gate no retuvo nada. */
export function heldActionFor(next: Screen | undefined): string | null {
  switch (next) {
    case "markets": case "market": return "Trading on Perpl";
    case "perpsFunds": return "Moving trading funds";
    case "deposit": return "A deposit";
    case "withdraw": return "A withdrawal";
    case "portfolio": return "Your portfolio";
    case "read": return "A read";
    case "agent": return "An agent's record";
    default: return null;
  }
}

/** Mercado en el que "Ask" abre Market (D13): el último usado si sigue listado; si no, BTC; si no, el primero. */
export function askMarketId(current: number | undefined, markets: readonly { id: number; symbol: string }[]): number | undefined {
  if (current !== undefined && markets.some((m) => m.id === current)) return current;
  return (markets.find((m) => m.symbol === "BTC") ?? markets[0])?.id;
}

// ---------------------------------------------------------------------------
// Sello del pull-to-refresh (spec mobile-loading D5). Puros: useRefreshSeal los evalúa en un efecto.

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
    case "market":
    case "portfolio": return !e.contextError || (e.listError !== null && !e.listError);
    default: return false;
  }
}

const PERPL_SCREENS: readonly Screen[] = ["markets", "market", "perpsFunds", "portfolio"];
const READS_SCREENS: readonly Screen[] = ["portfolio", "agents", "agent", "read", "markets"];

/** Pantallas con socket y polling de contexto de Perpl (D26: Portfolio muestra las posiciones). */
export const perplActiveFor = (scr: Screen): boolean => PERPL_SCREENS.includes(scr);
/** Polling de reads y agentes: Ask dentro de Market, más las pantallas que listan reads o agentes (D26). */
export const readsActiveFor = (scr: Screen, marketTab: MarketTab): boolean => (scr === "market" ? marketTab === "ask" : READS_SCREENS.includes(scr));

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
    case "portfolio":
    case "market": return d.context !== null;
    default: return false;
  }
}

export function headerFor(screen: Screen, perpsSymbol?: string, agent?: { name: string; owner: string }): [string, string] {
  switch (screen) {
    case "markets": return ["Markets", ""];
    case "agents": return ["Agents", ""];
    case "portfolio": return ["Portfolio", ""];
    case "wallet": return ["Wallet", ""];
    case "market": return [perpsSymbol ? `${perpsSymbol}-PERP` : "PERP", "Perpl · isolated margin"];
    case "perpsFunds": return ["Trading funds", "Between wallet and trading"];
    case "deposit": return ["Deposit", "AUSD · Monad testnet"];
    case "withdraw": return ["Withdraw", "AUSD to an external address"];
    case "read": return ["Read", ""];
    case "agent": return agent ? [agent.name, `By ${agent.owner}`] : ["Agent", ""];
    case "signin": return ["Pickler", ""];
    case "onboarding": return ["Pickler", ""];
    case "launchpad": case "activity": return [COMING_SOON_COPY[screen].title, "Coming soon"];
  }
}

export type AppStore = {
  S: StoreState;
  set: (patch: Patch) => void;
  nav: (screen: Screen, patch?: Patch) => void;
  back: () => void;
  requireAccount: (target: Screen, patch?: Patch) => void;
  /** Tab bar: enfoca la pestaña conservando su pila; sin cuenta, las pestañas con gate pasan por signin. */
  switchTab: (tab: TabName) => void;
  /** Sign in terminado: vuelve a Tabs y aterriza en el `next` del gate (D5), o en `fallback` si no había uno (D21: el onboarding cierra en Markets salvo acción retenida). */
  finishSignin: (fallback?: Screen) => void;
  /** Sign up recién creado, sin onboarding visto: sale del ctx hacia la ruta `onboarding`, con los mismos params de signin (D21). */
  startOnboarding: () => void;
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
  const switchTab = useCallback((tab: TabName) => {
    const root = TAB_ROOT[tab];
    const g = gateTarget(hasAccount, root);
    if (g.screen === "signin") { navigateTo("signin", { next: g.next }); return; }
    switchTabRoute(tab);
  }, [hasAccount]);
  const finishSignin = useCallback((fallback?: Screen) => {
    const p = currentParams();
    if (signinIsRoot()) resetRootTo("Tabs"); // arranque sin cuenta: no hay Tabs debajo (P3)
    nav(p?.next ?? fallback ?? "wallet", p?.patch); // con Tabs debajo, el `pop: true` del RootStack vuelve a Tabs y saca signin/onboarding
  }, [nav]);
  const startOnboarding = useCallback(() => navigateTo("onboarding", currentParams()), []);
  const signedOut = useCallback(() => { setS(signedOutState); resetRootTo("signin"); }, []);
  return { S, set, nav, back, requireAccount, switchTab, finishSignin, startOnboarding, signedOut, hasAccount, scr, comingSoon: isComingSoonTab(scr) };
}
