import {
  afterSigninState,
  backState,
  CAN_BACK,
  deriveBalance,
  deriveTradeHolds,
  deriveUser,
  GATED,
  headerFor,
  INITIAL,
  navState,
  requireAccountState,
  resetState,
  SHOW_TABS,
} from "../src/store";
import { AGENTS, POSTS } from "../src/mock/data";

test("nav pushes the current screen and applies the patch", () => {
  const s = navState(INITIAL, "agent", { agentId: "hld", tab: "about" });
  expect(s.screen).toBe("agent");
  expect(s.stack).toEqual(["market"]);
  expect(s.agentId).toBe("hld");
  expect(s.tab).toBe("about");
});

test("the back-stack keeps only the last 8 screens", () => {
  let s = INITIAL;
  for (let i = 0; i < 10; i++) s = navState(s, i % 2 ? "market" : "activity");
  expect(s.stack).toHaveLength(8);
});

test("back pops the stack and falls back to market when empty", () => {
  const s = navState(navState(INITIAL, "agent"), "trade");
  expect(backState(s).screen).toBe("agent");
  expect(backState(INITIAL).screen).toBe("market");
  expect(backState(INITIAL).stack).toEqual([]);
});

test("without an account, Wallet asks for access and remembers where to go", () => {
  const s = requireAccountState(INITIAL, false, "wallet");
  expect(s.screen).toBe("signin");
  expect(s.resume).toBe(false);
  expect(s.next).toBe("wallet");
  expect(s.nextPatch).toEqual({});
});

test("without an account, Buy holds the purchase and resumes in Deposit", () => {
  const s = requireAccountState(INITIAL, false, "trade", { mode: "buy", phase: "insufficient" });
  expect(s.screen).toBe("signin");
  expect(s.resume).toBe(true);
  expect(s.next).toBe("deposit");
  expect(s.nextPatch).toEqual({ mode: "buy", phase: "insufficient", resume: true });
});

test("with an account the gate navigates straight to the target", () => {
  const s = requireAccountState(INITIAL, true, "wallet");
  expect(s.screen).toBe("wallet");
  expect(s.next).toBeUndefined();
});

test("reading screens never ask for an account", () => {
  for (const target of ["market", "search", "agent", "activity", "post", "ask"] as const) {
    expect(requireAccountState(INITIAL, false, target).screen).toBe(target);
  }
});

test("after sign-in the app lands on next without leaving signin in the stack", () => {
  const s = afterSigninState(requireAccountState(INITIAL, false, "wallet"));
  expect(s.screen).toBe("wallet");
  expect(s.stack).toEqual(["market"]);
  expect(s.next).toBeUndefined();
  expect(s.nextPatch).toBeUndefined();
});

test("after sign-in from Buy the deposit screen resumes the purchase", () => {
  const s = afterSigninState(requireAccountState(INITIAL, false, "trade", { mode: "buy", phase: "insufficient" }));
  expect(s.screen).toBe("deposit");
  expect(s.resume).toBe(true);
  expect(s.phase).toBe("insufficient");
});

test("user is new without an account even when the dev panel marks holder", () => {
  expect(deriveUser(false, true)).toBe("new");
  expect(deriveUser(true, false)).toBe("funded");
  expect(deriveUser(true, true)).toBe("holder");
});

test("reset clears the stack, resume and the mock holder flag", () => {
  const dirty = { ...navState(INITIAL, "agent"), resume: true, mockHolder: true };
  const s = resetState(dirty, "market");
  expect(s).toMatchObject({ screen: "market", stack: [], resume: false, mockHolder: false });
});

test("a completed buy never counts as holding without an account", () => {
  expect(deriveTradeHolds(false, false, "done", "buy")).toBe(false);
  expect(deriveTradeHolds(false, true, "done", "buy")).toBe(false);
  expect(deriveTradeHolds(true, false, "done", "buy")).toBe(true);
  expect(deriveTradeHolds(true, true, "quote", "buy")).toBe(true);
  expect(deriveTradeHolds(true, false, "done", "sell")).toBe(false);
});

test("balance is 0 without an account even if AUSD was read", () => {
  expect(deriveBalance(false, 1240)).toBe(0);
  expect(deriveBalance(true, 1240)).toBe(1240);
});

test("the three Perpl screens need an account; only the tab shows the tab bar; subscreens can go back", () => {
  for (const s of ["perps", "perpsMarket", "perpsFunds"] as const) expect(GATED).toContain(s);
  expect(SHOW_TABS).toContain("perps");
  expect(SHOW_TABS).not.toContain("perpsMarket");
  expect(SHOW_TABS).not.toContain("perpsFunds");
  expect(CAN_BACK).toContain("perpsMarket");
  expect(CAN_BACK).toContain("perpsFunds");
  expect(CAN_BACK).not.toContain("perps");
});

test("without an account the Trade tab asks for access and comes back to it", () => {
  const s = afterSigninState(requireAccountState(INITIAL, false, "perps"));
  expect(s.screen).toBe("perps");
});

test("headers of the Perpl screens", () => {
  const agent = AGENTS.pkl, post = POSTS[0];
  expect(headerFor("perps", agent, post, "buy", 0)).toEqual(["Trade", "Perps on Perpl · Monad"]);
  expect(headerFor("perpsMarket", agent, post, "buy", 0, "MON")).toEqual(["MON Perp", "Market order"]);
  expect(headerFor("perpsMarket", agent, post, "buy", 0)).toEqual(["Perp", "Market order"]);
  expect(headerFor("perpsFunds", agent, post, "buy", 0)).toEqual(["Trading funds", "Between wallet and trading"]);
});

test("nav to a market keeps the chosen market and side in the state", () => {
  const s = navState(INITIAL, "perpsMarket", { perpsMarketId: 64, perpsSide: "short" });
  expect(s).toMatchObject({ screen: "perpsMarket", perpsMarketId: 64, perpsSide: "short" });
  expect(navState(INITIAL, "perpsFunds", { fundsMode: "withdraw" }).fundsMode).toBe("withdraw");
});
