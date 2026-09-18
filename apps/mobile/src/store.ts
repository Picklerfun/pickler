import { useCallback, useState } from "react";
import { AGENTS, type Agent, type AgentId, POSTS, type Post } from "./mock/data";
import { money } from "./mock/helpers";

export type Screen =
  | "market" | "search" | "agent"
  | "trade" | "signin"
  | "activity" | "post" | "ask"
  | "portfolio" | "position" | "wallet" | "deposit" | "withdraw"
  | "perps" | "perpsMarket" | "perpsFunds";
export type Phase = "quoting" | "quote" | "insufficient" | "expired" | "confirm" | "sent" | "done" | "failed" | "unknown";
export type Mode = "buy" | "sell";
export type UserKind = "new" | "funded" | "holder";
export type DataCase = "normal" | "loading" | "empty" | "stale";
export type Sort = "trending" | "volume" | "new";
export type AgentTab = "token" | "activity" | "about";

export type StoreState = {
  screen: Screen;
  stack: Screen[];
  agentId: AgentId;
  tab: AgentTab;
  postId: string;
  mode: Mode;
  phase: Phase;
  amount: number;
  sort: Sort;
  sellPct: number;
  following: boolean;
  resume: boolean;
  askCtx: string;
  dataCase: DataCase;
  /** Solo el panel de dev lo enciende: activa las posiciones de ejemplo. Nunca gobierna cuenta ni saldo. */
  mockHolder: boolean;
  /** A dónde ir al terminar Wallet access, y con qué patch. */
  next?: Screen;
  nextPatch?: Patch;
  /** Pestaña Trade (Perpl): mercado y lado elegidos, y modo de la pantalla de fondos. */
  perpsMarketId?: number;
  perpsSide?: "long" | "short";
  fundsMode?: "add" | "withdraw";
};

export type Patch = Partial<Omit<StoreState, "stack">>;

export const INITIAL: StoreState = {
  screen: "wallet", stack: [], dataCase: "normal",
  agentId: "pkl", tab: "token", postId: "p1",
  mode: "buy", phase: "quote", amount: 250, sort: "trending", sellPct: 50,
  following: true, resume: false, askCtx: "Pickle", mockHolder: false,
};

const STACK_MAX = 8;

export function navState(s: StoreState, screen: Screen, patch: Patch = {}): StoreState {
  return { ...s, ...patch, stack: [...s.stack, s.screen].slice(-STACK_MAX), screen };
}

export function backState(s: StoreState): StoreState {
  const stack = [...s.stack];
  const prev = stack.pop() ?? "wallet";
  return { ...s, stack, screen: prev };
}

/** Pantallas que exigen cuenta. Leer, seguir y preguntar nunca la piden. */
export const GATED: readonly Screen[] = ["wallet", "portfolio", "position", "deposit", "withdraw", "trade", "perps", "perpsMarket", "perpsFunds"];

/** Tabs que todavía muestran el mock: el Shell renderiza "Coming soon" en vez de la pantalla (D1/D2). */
export const COMING_SOON: readonly Screen[] = ["market", "activity", "portfolio"];

export function requireAccountState(s: StoreState, hasAccount: boolean, target: Screen, patch: Patch = {}): StoreState {
  if (hasAccount || !GATED.includes(target)) return navState(s, target, patch);
  const buying = target === "trade";
  return navState(s, "signin", {
    resume: buying,
    next: buying ? "deposit" : target,
    nextPatch: buying ? { ...patch, resume: true } : patch,
  });
}

/** Tras el login aterriza en `next` sin dejar `signin` en el stack (como si se hubiera navegado directo). */
export function afterSigninState(s: StoreState): StoreState {
  const { next, nextPatch, ...rest } = s;
  return { ...rest, ...(nextPatch ?? {}), screen: next ?? "wallet" };
}

/** Al resolver la cuenta por primera vez: con cuenta se queda en Wallet; sin cuenta pasa por Sign in y aterriza en Wallet (D3). */
export function bootState(s: StoreState, hasAccount: boolean): StoreState {
  if (hasAccount) return s;
  return { ...s, screen: "signin", stack: [], next: "wallet", nextPatch: undefined, resume: false };
}

export function resetState(s: StoreState, screen: Screen): StoreState {
  return { ...s, screen, stack: [], resume: false, mockHolder: false, next: undefined, nextPatch: undefined };
}

/** Sign out: limpia todo y vuelve a Sign in, que aterriza en Wallet al entrar (mismo camino que el arranque sin cuenta). */
export function signedOutState(s: StoreState): StoreState {
  return bootState(resetState(s, "signin"), false);
}

export function deriveUser(hasAccount: boolean, mockHolder: boolean): UserKind {
  if (!hasAccount) return "new";
  return mockHolder ? "holder" : "funded";
}

export function deriveBalance(hasAccount: boolean, ausd: number): number {
  return hasAccount ? ausd : 0;
}

/** El wireframe trata una compra recién completada como tenencia (para Sell / posición); nunca sin cuenta. */
export function deriveTradeHolds(hasAccount: boolean, mockHolder: boolean, phase: Phase, mode: Mode): boolean {
  if (!hasAccount) return false;
  return deriveUser(hasAccount, mockHolder) === "holder" || (phase === "done" && mode === "buy");
}

export const CAN_BACK: readonly Screen[] = ["agent", "trade", "post", "ask", "position", "deposit", "withdraw", "search", "signin", "perpsMarket", "perpsFunds"];
export const SHOW_TABS: readonly Screen[] = ["market", "activity", "portfolio", "wallet", "search", "position", "perps"];

/** `←` sólo si la pantalla lo permite Y hay algo en el stack al que volver (con bootState el stack arranca vacío). */
export function canBackFor(screen: Screen, stack: readonly Screen[]): boolean {
  return CAN_BACK.includes(screen) && stack.length > 0;
}

export function headerFor(screen: Screen, agent: Agent, post: Post, mode: Mode, balance: number, perpsSymbol?: string): [string, string] {
  switch (screen) {
    case "market": return ["Market", "Coming soon"];
    case "search": return ["Search", "Name, ticker, specialty"];
    case "agent": return [agent.name, agent.ticker + " · " + agent.what.split(" — ")[0]];
    case "trade": return [(mode === "buy" ? "Buy " : "Sell ") + agent.tickerBare, "Balance " + money(balance) + " AUSD"];
    case "signin": return ["Wallet access", "One step, then back to your purchase"];
    case "activity": return ["Activity", "Coming soon"];
    case "post": return ["Activity", AGENTS[post.agent].name];
    case "ask": return ["Ask " + agent.name, "Questions only — never trades"];
    case "portfolio": return ["Portfolio", "Coming soon"];
    case "position": return ["Your " + agent.tickerBare, "Position detail"];
    case "wallet": return ["Wallet", "AUSD available and movements"];
    case "deposit": return ["Deposit AUSD", "Monad network"];
    case "withdraw": return ["Withdraw AUSD", "To an external address"];
    case "perps": return ["Trade", "Perps on Perpl · Monad"];
    case "perpsMarket": return [perpsSymbol ? `${perpsSymbol} Perp` : "Perp", "Market order"];
    case "perpsFunds": return ["Trading funds", "Between wallet and trading"];
  }
}

export type StoreInput = {
  /** `account.status !== "none"`. */
  hasAccount: boolean;
  /** AUSD real como número; 0 si no cargó. */
  ausd: number;
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
  resetTo: (screen: Screen) => void;
  signedOut: () => void;
  boot: (hasAccount: boolean) => void;
  hasAccount: boolean;
  user: UserKind;
  agent: Agent;
  balance: number;
  holds: boolean;
  tradeHolds: boolean;
  scr: Screen;
  buying: boolean;
  post: Post;
  headerTitle: string;
  headerSub: string;
  canBack: boolean;
  showTabs: boolean;
  showAgentBar: boolean;
  comingSoon: boolean;
};

export function useAppStore({ hasAccount, ausd, perpsMarkets }: StoreInput): AppStore {
  const [S, setS] = useState<StoreState>(INITIAL);

  const set = useCallback((patch: Patch) => setS((s) => ({ ...s, ...patch })), []);
  const nav = useCallback((screen: Screen, patch?: Patch) => setS((s) => navState(s, screen, patch)), []);
  const back = useCallback(() => setS(backState), []);
  const requireAccount = useCallback(
    (target: Screen, patch?: Patch) => setS((s) => requireAccountState(s, hasAccount, target, patch)),
    [hasAccount],
  );
  const finishSignin = useCallback(() => setS(afterSigninState), []);
  const resetTo = useCallback((screen: Screen) => setS((s) => resetState(s, screen)), []);
  const signedOut = useCallback(() => setS(signedOutState), []);
  const boot = useCallback((has: boolean) => setS((s) => bootState(s, has)), []);

  const agent = AGENTS[S.agentId];
  const user = deriveUser(hasAccount, S.mockHolder);
  const balance = deriveBalance(hasAccount, ausd);
  const holds = user === "holder";
  const tradeHolds = deriveTradeHolds(hasAccount, S.mockHolder, S.phase, S.mode);
  const post = POSTS.find((p) => p.id === S.postId) ?? POSTS[0];
  const perpsSymbol = (perpsMarkets ?? []).find((m) => m.id === S.perpsMarketId)?.symbol;
  const [headerTitle, headerSub] = headerFor(S.screen, agent, post, S.mode, balance, perpsSymbol);

  return {
    S, set, nav, back, requireAccount, finishSignin, resetTo, signedOut, boot,
    hasAccount, user, agent, balance, holds, tradeHolds,
    scr: S.screen, buying: S.mode === "buy", post, headerTitle, headerSub,
    canBack: canBackFor(S.screen, S.stack),
    showTabs: SHOW_TABS.includes(S.screen),
    showAgentBar: S.screen === "agent",
    comingSoon: COMING_SOON.includes(S.screen),
  };
}
