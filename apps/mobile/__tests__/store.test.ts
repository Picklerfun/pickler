import {
  CAN_BACK, COMING_SOON, GATED, headerFor, heldActionFor, INITIAL,
  isComingSoonTab, marketEntryTab, refreshOk, ROOT_OF, screenHasData, SHOW_TABS, signedOutState, tradingLineState, updatedLabel,
} from "../src/store";

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

test("isComingSoonTab is the type guard behind comingSoon, exactly the COMING_SOON set", () => {
  for (const s of COMING_SOON) expect(isComingSoonTab(s)).toBe(true);
  for (const s of ["markets", "market", "perpsFunds", "wallet", "deposit", "withdraw", "signin"] as const) expect(isComingSoonTab(s)).toBe(false);
});

test("Ask state: New read by default, a cell, an agent and a focused read travel in the patch (D13)", () => {
  expect(INITIAL.askView).toBe("new");
  expect(INITIAL.askCell).toBeUndefined();
  const patch = { perpsMarketId: 16, marketTab: "ask" as const, askView: "mine" as const, askFocusReadId: "r1", askAgentId: "drift", askCell: { levelBps: 100, horizonMin: 240 } };
  const s = { ...INITIAL, ...patch };
  expect(s).toMatchObject({ marketTab: "ask", askView: "mine", askFocusReadId: "r1", askAgentId: "drift", askCell: { levelBps: 100, horizonMin: 240 } });
  expect({ ...INITIAL, tradeLevel: { marketId: 16, levelBps: 100, horizonMin: 240, target: 770181, expiresAt: "2026-09-20T07:35:06.712Z" } }.tradeLevel?.target).toBe(770181);
});

test("the Market header subtitle follows the pill (D13)", () => {
  expect(headerFor("market", "BTC", "trade")).toEqual(["BTC Perp", "Perpl · isolated margin · market order"]);
  expect(headerFor("market", "BTC", "ask")).toEqual(["BTC Perp", "Ask an agent · simulated credits"]);
  expect(headerFor("market", "BTC", "agents")).toEqual(["BTC Perp", "Who reads this market"]);
  expect(headerFor("market", undefined)).toEqual(["Perp", "Perpl · isolated margin · market order"]);
});

test("signedOutState clears the Ask state (the stack is react-navigation's now)", () => {
  const s = { ...INITIAL, askView: "mine" as const, askCell: { levelBps: 100, horizonMin: 240 }, askAgentId: "a", askFocusReadId: "r", tradeLevel: { marketId: 1, levelBps: 100, horizonMin: 240, target: 1, expiresAt: "x" } };
  expect(signedOutState(s)).toEqual({ ...INITIAL });
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

test("refreshOk ignores a source that was not requested (listError null: no reads session)", () => {
  const noReads = { rpcError: "", movementsError: "", contextError: "", listError: null };
  expect(refreshOk("market", { ...noReads, contextError: "x" })).toBe(false); // Perpl failed and reads were never asked
  expect(refreshOk("market", noReads)).toBe(true); // Perpl ok
});

test("tradingLineState: live, last seen, skeleton only while the socket is active, unknown otherwise", () => {
  const acc = { account: { b: 1n } };
  expect(tradingLineState(acc, null, true)).toBe("live");
  expect(tradingLineState(acc, 5n, false)).toBe("live");
  expect(tradingLineState({ account: null }, 5n, true)).toBe("lastSeen");
  expect(tradingLineState(null, 5n, false)).toBe("lastSeen");
  expect(tradingLineState(null, null, true)).toBe("skeleton"); // Markets connecting
  expect(tradingLineState({ account: null }, null, true)).toBe("skeleton"); // socket open, no account frame yet
  expect(tradingLineState(null, null, false)).toBe("unknown"); // Wallet: no socket, nothing seen
  expect(tradingLineState({ account: null, keyRejected: true, status: "closed" }, null, true)).toBe("unknown"); // key rejected: terminal, not skeleton (R2)
  expect(tradingLineState({ account: null, keyRejected: false, status: "closed" }, null, true)).toBe("unknown"); // socket closed for good: terminal, not skeleton (R2)
  expect(tradingLineState({ account: null, keyRejected: false, status: "connecting" }, null, true)).toBe("skeleton"); // still connecting: skeleton stands
});

test("screenHasData follows the null contract of the hooks", () => {
  expect(screenHasData("wallet", { balances: null, context: null })).toBe(false);
  expect(screenHasData("wallet", { balances: {}, context: null })).toBe(true);
  expect(screenHasData("markets", { balances: {}, context: null })).toBe(false);
  expect(screenHasData("market", { balances: null, context: {} })).toBe(true);
  expect(screenHasData("signin", { balances: {}, context: {} })).toBe(false);
});
