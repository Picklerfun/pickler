import { GATED, ROOT_OF, type Screen } from "../src/store";
import { ALL_TABS, gateTarget, SCREENS_ALL, screenOfRoute, TAB_OF, TAB_ORDER, TAB_ROOT } from "../src/navigation/routes";

test("every screen except signin belongs to exactly one tab; only four tabs are visible (D1)", () => {
  const screens = SCREENS_ALL.filter((s) => s !== "signin");
  expect(screens).toHaveLength(12);
  for (const s of screens) {
    const tab = TAB_OF[s as Exclude<Screen, "signin">];
    expect(ALL_TABS).toContain(tab);
    expect(ROOT_OF[s]).toBe(TAB_ROOT[tab]);
  }
  expect(TAB_ORDER).toEqual(["MarketsTab", "AgentsTab", "PortfolioTab", "WalletTab"]);
  expect(ALL_TABS).toEqual(["MarketsTab", "AgentsTab", "PortfolioTab", "WalletTab", "LaunchpadTab", "ActivityTab"]);
  expect(TAB_OF.perpsFunds).toBe("WalletTab");
  expect(TAB_OF.read).toBe("PortfolioTab");
  expect(TAB_OF.agent).toBe("AgentsTab");
});

test("screenOfRoute maps route names back to screens and ignores navigator names", () => {
  expect(screenOfRoute("market")).toBe("market");
  expect(screenOfRoute("signin")).toBe("signin");
  expect(screenOfRoute("Tabs")).toBeNull();
  expect(screenOfRoute("MarketsTab")).toBeNull();
  expect(screenOfRoute(undefined)).toBeNull();
});

test("gateTarget sends gated screens to signin without an account and remembers where to go (D5)", () => {
  expect(gateTarget(false, "markets")).toEqual({ screen: "signin", next: "markets" });
  expect(gateTarget(true, "markets")).toEqual({ screen: "markets" });
  expect(gateTarget(false, "launchpad")).toEqual({ screen: "launchpad" }); // coming soon never asks
  expect(gateTarget(false, "agents")).toEqual({ screen: "agents" }); // la lista es pública (D23)
  expect(gateTarget(false, "agent")).toEqual({ screen: "signin", next: "agent" });
  for (const s of GATED) expect(gateTarget(false, s).screen).toBe("signin");
});
