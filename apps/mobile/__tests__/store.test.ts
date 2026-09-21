import {
  afterSigninState, backState, bootState, CAN_BACK, canBackFor, COMING_SOON, GATED, headerFor, heldActionFor, INITIAL,
  isComingSoonTab, marketEntryTab, navState, refreshOk, requireAccountState, resetState, ROOT_OF, screenHasData, SHOW_TABS, signedOutState, updatedLabel,
} from "../src/store";

test("nav pushes the current screen and applies the patch", () => {
  const s = navState(INITIAL, "market", { perpsMarketId: 64, perpsSide: "short" });
  expect(s.screen).toBe("market");
  expect(s.stack).toEqual(["wallet"]);
  expect(s).toMatchObject({ perpsMarketId: 64, perpsSide: "short" });
  expect(navState(INITIAL, "perpsFunds", { fundsMode: "withdraw" }).fundsMode).toBe("withdraw");
});

test("the back-stack keeps only the last 8 screens", () => {
  let s = INITIAL;
  for (let i = 0; i < 10; i++) s = navState(s, i % 2 ? "markets" : "activity");
  expect(s.stack).toHaveLength(8);
});

test("back pops the stack and falls back to wallet when empty", () => {
  const s = navState(navState(INITIAL, "markets"), "market");
  expect(backState(s).screen).toBe("markets");
  expect(backState(INITIAL).screen).toBe("wallet");
  expect(backState(INITIAL).stack).toEqual([]);
});

test("without an account, gated screens ask for access and remember where to go", () => {
  for (const target of GATED) {
    const s = requireAccountState(INITIAL, false, target, { fundsMode: "add" });
    expect(s.screen).toBe("signin");
    expect(s.next).toBe(target);
    expect(s.nextPatch).toEqual({ fundsMode: "add" });
  }
});

test("with an account the gate navigates straight to the target", () => {
  const s = requireAccountState(INITIAL, true, "markets");
  expect(s.screen).toBe("markets");
  expect(s.next).toBeUndefined();
});

test("coming-soon tabs never ask for an account", () => {
  for (const target of COMING_SOON) expect(requireAccountState(INITIAL, false, target).screen).toBe(target);
});

test("after sign-in the app lands on next without leaving signin in the stack", () => {
  const s = afterSigninState(requireAccountState(INITIAL, false, "markets"));
  expect(s.screen).toBe("markets");
  expect(s.stack).toEqual(["wallet"]);
  expect(s.next).toBeUndefined();
  expect(s.nextPatch).toBeUndefined();
});

test("the held action names what the gate kept, and is null when it kept nothing", () => {
  expect(heldActionFor(undefined)).toBeNull();
  expect(heldActionFor("wallet")).toBeNull();
  expect(heldActionFor("markets")).toBe("Trading on Perpl");
  expect(heldActionFor("market")).toBe("Trading on Perpl");
  expect(heldActionFor("perpsFunds")).toBe("Moving trading funds");
  expect(heldActionFor("deposit")).toBe("A deposit");
  expect(heldActionFor("withdraw")).toBe("A withdrawal");
});

test("the screen sets of D5 are exactly the spec's", () => {
  expect([...COMING_SOON]).toEqual(["launchpad", "activity", "portfolio"]);
  expect([...GATED]).toEqual(["markets", "market", "perpsFunds", "wallet", "deposit", "withdraw"]);
  expect([...CAN_BACK]).toEqual(["market", "perpsFunds", "deposit", "withdraw", "signin"]);
  expect([...SHOW_TABS]).toEqual(["markets", "launchpad", "activity", "portfolio", "wallet"]);
});

test("every screen maps to the tab it lights up", () => {
  expect(ROOT_OF.market).toBe("markets");
  expect(ROOT_OF.perpsFunds).toBe("markets");
  expect(ROOT_OF.deposit).toBe("wallet");
  expect(ROOT_OF.withdraw).toBe("wallet");
  expect(ROOT_OF.signin).toBe("wallet");
  for (const tab of SHOW_TABS) expect(ROOT_OF[tab]).toBe(tab);
});

test("headers", () => {
  expect(headerFor("markets")).toEqual(["Markets", "Perps on Perpl · Monad"]);
  expect(headerFor("market", "MON")).toEqual(["MON Perp", "Perpl · isolated margin · market order"]);
  expect(headerFor("market")).toEqual(["Perp", "Perpl · isolated margin · market order"]);
  expect(headerFor("perpsFunds")).toEqual(["Trading funds", "Between wallet and trading"]);
  expect(headerFor("wallet")).toEqual(["Wallet", "AUSD available and movements"]);
  expect(headerFor("deposit")).toEqual(["Deposit AUSD", "Monad network"]);
  expect(headerFor("withdraw")).toEqual(["Withdraw AUSD", "To an external address"]);
  expect(headerFor("signin")).toEqual(["Wallet access", "Passkey on this device"]);
  for (const screen of COMING_SOON) expect(headerFor(screen)[1]).toBe("Coming soon");
  expect(headerFor("launchpad")[0]).toBe("Launchpad");
});

test("the app starts on Wallet; boot keeps it with an account and goes through Sign in without one", () => {
  expect(INITIAL.screen).toBe("wallet");
  expect(bootState(INITIAL, true)).toBe(INITIAL);
  const s = bootState(INITIAL, false);
  expect(s).toMatchObject({ screen: "signin", stack: [], next: "wallet" });
  expect(s.nextPatch).toBeUndefined();
  expect(afterSigninState(s).screen).toBe("wallet");
});

test("canBackFor requires both a CAN_BACK screen and a non-empty stack", () => {
  expect(canBackFor("signin", [])).toBe(false);
  expect(canBackFor("signin", ["wallet"])).toBe(true);
  expect(canBackFor("wallet", ["markets"])).toBe(false);
  const booted = bootState(INITIAL, false);
  expect(canBackFor(booted.screen, booted.stack)).toBe(false);
});

test("reset clears the stack and any pending gate", () => {
  const dirty = { ...navState(INITIAL, "market"), next: "markets" as const };
  expect(resetState(dirty, "markets")).toMatchObject({ screen: "markets", stack: [], next: undefined, nextPatch: undefined });
});

test("sign out lands on Sign in and comes back to Wallet after logging in", () => {
  const dirty = navState(navState(INITIAL, "markets"), "market", { perpsMarketId: 64 });
  const s = signedOutState(dirty);
  expect(s).toMatchObject({ screen: "signin", stack: [], next: "wallet" });
  expect(canBackFor(s.screen, s.stack)).toBe(false);
  expect(afterSigninState(s).screen).toBe("wallet");
});

test("isComingSoonTab is the type guard behind comingSoon, exactly the COMING_SOON set", () => {
  for (const s of COMING_SOON) expect(isComingSoonTab(s)).toBe(true);
  for (const s of ["markets", "market", "perpsFunds", "wallet", "deposit", "withdraw", "signin"] as const) expect(isComingSoonTab(s)).toBe(false);
});

test("Ask state: New read by default, a cell, an agent and a focused read travel in the patch (D13)", () => {
  expect(INITIAL.askView).toBe("new");
  expect(INITIAL.askCell).toBeUndefined();
  const s = navState(INITIAL, "market", { perpsMarketId: 16, marketTab: "ask", askView: "mine", askFocusReadId: "r1", askAgentId: "drift", askCell: { levelBps: 100, horizonMin: 240 } });
  expect(s).toMatchObject({ marketTab: "ask", askView: "mine", askFocusReadId: "r1", askAgentId: "drift", askCell: { levelBps: 100, horizonMin: 240 } });
  expect(navState(INITIAL, "market", { tradeLevel: { marketId: 16, levelBps: 100, horizonMin: 240, target: 770181, expiresAt: "2026-09-20T07:35:06.712Z" } }).tradeLevel?.target).toBe(770181);
});

test("the Market header subtitle follows the pill (D13)", () => {
  expect(headerFor("market", "BTC", "trade")).toEqual(["BTC Perp", "Perpl · isolated margin · market order"]);
  expect(headerFor("market", "BTC", "ask")).toEqual(["BTC Perp", "Ask an agent · simulated credits"]);
  expect(headerFor("market", "BTC", "agents")).toEqual(["BTC Perp", "Who reads this market"]);
  expect(headerFor("market", undefined)).toEqual(["Perp", "Perpl · isolated margin · market order"]);
});

test("sign out lands on Sign in and clears the Ask state", () => {
  const s = signedOutState(navState(INITIAL, "market", {
    askView: "mine", askFocusReadId: "r1", askAgentId: "drift",
    askCell: { levelBps: 100, horizonMin: 240 },
    tradeLevel: { marketId: 16, levelBps: 100, horizonMin: 240, target: 770181, expiresAt: "2026-09-20T07:35:06.712Z" },
  }));
  expect(s.screen).toBe("signin");
  expect(s.stack).toEqual([]);
  expect(s.next).toBe("wallet");
  expect(s.askView).toBe("new");
  expect(s.askCell).toBeUndefined();
  expect(s.askAgentId).toBeUndefined();
  expect(s.askFocusReadId).toBeUndefined();
  expect(s.tradeLevel).toBeUndefined();
});

test("a market opens on Trade with a trading key and on Ask without one (gate)", () => {
  expect(marketEntryTab(true)).toBe("trade");
  expect(marketEntryTab(false)).toBe("ask");
});

test("updatedLabel formats a local 24h timestamp", () => {
  const ts = new Date(2026, 8, 21, 8, 5, 9).getTime(); // local time on purpose: the label is what the user sees
  expect(updatedLabel(ts)).toBe("UPDATED 08:05:09");
  expect(updatedLabel(new Date(2026, 8, 21, 23, 59, 0).getTime())).toBe("UPDATED 23:59:00");
});

test("refreshOk needs at least one source of the screen to succeed", () => {
  const ok = { rpcError: "", movementsError: "", contextError: "", listError: "" };
  expect(refreshOk("wallet", ok)).toBe(true);
  expect(refreshOk("wallet", { ...ok, rpcError: "x" })).toBe(true); // movements still refreshed
  expect(refreshOk("wallet", { ...ok, rpcError: "x", movementsError: "y" })).toBe(false);
  expect(refreshOk("markets", ok)).toBe(true);
  expect(refreshOk("markets", { ...ok, contextError: "x" })).toBe(false);
  expect(refreshOk("market", { ...ok, contextError: "x" })).toBe(true); // reads still refreshed
  expect(refreshOk("market", { ...ok, contextError: "x", listError: "y" })).toBe(false);
  expect(refreshOk("signin", ok)).toBe(false); // not refreshable
});

test("screenHasData follows the null contract of the hooks", () => {
  expect(screenHasData("wallet", { balances: null, context: null })).toBe(false);
  expect(screenHasData("wallet", { balances: {}, context: null })).toBe(true);
  expect(screenHasData("markets", { balances: {}, context: null })).toBe(false);
  expect(screenHasData("market", { balances: null, context: {} })).toBe(true);
  expect(screenHasData("signin", { balances: {}, context: {} })).toBe(false);
});
