import {
  CAN_BACK, COMING_SOON, GATED, headerFor, heldActionFor, INITIAL,
  askMarketId, isComingSoonTab, perplActiveFor, readsActiveFor, refreshOk, ROOT_OF, screenHasData, SHOW_TABS, signedOutState, tradingLineState, updatedLabel,
} from "../src/store";

test("the held action names what the gate kept, and is null when it kept nothing", () => {
  expect(heldActionFor(undefined)).toBeNull();
  expect(heldActionFor("wallet")).toBeNull();
  expect(heldActionFor("markets")).toBe("Trading on Perpl");
  expect(heldActionFor("market")).toBe("Trading on Perpl");
  expect(heldActionFor("perpsFunds")).toBe("Moving trading funds");
  expect(heldActionFor("deposit")).toBe("A deposit");
  expect(heldActionFor("withdraw")).toBe("A withdrawal");
  expect(heldActionFor("portfolio")).toBe("Your portfolio");
  expect(heldActionFor("read")).toBe("A read");
  expect(heldActionFor("agent")).toBe("An agent's record");
});

test("the screen sets of the light redesign (D1, D23)", () => {
  expect([...COMING_SOON]).toEqual(["launchpad", "activity"]);
  expect([...GATED]).toEqual(["markets", "market", "perpsFunds", "wallet", "deposit", "withdraw", "portfolio", "read", "agent"]);
  expect([...CAN_BACK]).toEqual(["market", "perpsFunds", "deposit", "withdraw", "signin", "agent", "read"]);
  expect([...SHOW_TABS]).toEqual(["markets", "agents", "portfolio", "wallet", "launchpad", "activity"]);
});

test("every screen maps to the tab it lights up", () => {
  expect(ROOT_OF.market).toBe("markets");
  expect(ROOT_OF.perpsFunds).toBe("wallet");
  expect(ROOT_OF.read).toBe("portfolio");
  expect(ROOT_OF.agent).toBe("agents");
  expect(ROOT_OF.deposit).toBe("wallet");
  expect(ROOT_OF.withdraw).toBe("wallet");
  expect(ROOT_OF.signin).toBe("wallet");
  for (const tab of SHOW_TABS) expect(ROOT_OF[tab]).toBe(tab);
});

test("headers", () => {
  expect(headerFor("markets")).toEqual(["Markets", ""]);
  expect(headerFor("agents")).toEqual(["Agents", ""]);
  expect(headerFor("portfolio")).toEqual(["Portfolio", ""]);
  expect(headerFor("wallet")).toEqual(["Wallet", ""]);
  expect(headerFor("market", "BTC")).toEqual(["BTC-PERP", "Perpl · isolated margin"]);
  expect(headerFor("market")).toEqual(["PERP", "Perpl · isolated margin"]);
  expect(headerFor("perpsFunds")).toEqual(["Trading funds", "Between wallet and trading"]);
  expect(headerFor("deposit")).toEqual(["Deposit", "AUSD · Monad testnet"]);
  expect(headerFor("withdraw")).toEqual(["Withdraw", "AUSD to an external address"]);
  expect(headerFor("read")).toEqual(["Read", ""]);
  expect(headerFor("agent")).toEqual(["Agent", ""]);
  expect(headerFor("signin")).toEqual(["Pickler", ""]);
  expect(headerFor("onboarding")).toEqual(["Pickler", ""]);
});

test("agent header: the agent's name and owner once agents-list is loaded (D16)", () => {
  expect(headerFor("agent", undefined, { name: "Drift", owner: "pickler" })).toEqual(["Drift", "By pickler"]);
  expect(headerFor("agent")).toEqual(["Agent", ""]);
});

test("isComingSoonTab is the type guard behind comingSoon, exactly the COMING_SOON set", () => {
  for (const s of COMING_SOON) expect(isComingSoonTab(s)).toBe(true);
  for (const s of ["markets", "market", "perpsFunds", "wallet", "deposit", "withdraw", "signin"] as const) expect(isComingSoonTab(s)).toBe(false);
});

test("INITIAL opens Market on Trade; sign out clears Ask and the focused read", () => {
  expect(INITIAL).toEqual({ marketTab: "trade" });
  const s = signedOutState({ marketTab: "ask", askCell: { levelBps: 50, horizonMin: 60 }, askAgentId: "drift", readId: "r1", agentId: "drift" });
  expect(s).toEqual({ marketTab: "ask", askCell: undefined, askAgentId: undefined, readId: undefined, agentId: undefined, tradeLevel: undefined });
});

test("askMarketId keeps the last market, else BTC, else the first listed", () => {
  const mk = [{ id: 7, symbol: "MON" }, { id: 1, symbol: "BTC" }];
  expect(askMarketId(7, mk)).toBe(7);
  expect(askMarketId(99, mk)).toBe(1); // ya no listado → BTC
  expect(askMarketId(undefined, mk)).toBe(1);
  expect(askMarketId(undefined, [{ id: 3, symbol: "ETH" }])).toBe(3);
  expect(askMarketId(undefined, [])).toBeUndefined();
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

test("the Perpl socket runs where trading data is shown, Portfolio included (D26)", () => {
  for (const s of ["markets", "market", "perpsFunds", "portfolio"] as const) expect(perplActiveFor(s)).toBe(true);
  for (const s of ["wallet", "agents", "agent", "read", "signin"] as const) expect(perplActiveFor(s)).toBe(false);
});

test("reads poll on Ask, Portfolio, Agents, the profile, Read and Markets (agent count), not on Trade", () => {
  expect(readsActiveFor("market", "ask")).toBe(true);
  expect(readsActiveFor("market", "trade")).toBe(false);
  for (const s of ["portfolio", "agents", "agent", "read", "markets"] as const) expect(readsActiveFor(s, "trade")).toBe(true);
  expect(readsActiveFor("wallet", "trade")).toBe(false);
});

test("screenHasData follows the null contract of the hooks", () => {
  expect(screenHasData("wallet", { balances: null, context: null })).toBe(false);
  expect(screenHasData("wallet", { balances: {}, context: null })).toBe(true);
  expect(screenHasData("markets", { balances: {}, context: null })).toBe(false);
  expect(screenHasData("market", { balances: null, context: {} })).toBe(true);
  expect(screenHasData("signin", { balances: {}, context: {} })).toBe(false);
});
