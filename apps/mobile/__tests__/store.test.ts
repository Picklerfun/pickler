import {
  afterSigninState, backState, bootState, CAN_BACK, canBackFor, COMING_SOON, GATED, headerFor, heldActionFor, INITIAL,
  navState, requireAccountState, resetState, ROOT_OF, SHOW_TABS, signedOutState,
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
