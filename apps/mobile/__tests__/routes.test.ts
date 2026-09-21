import { GATED, ROOT_OF, SHOW_TABS, type Screen } from "../src/store";
import { gateTarget, SCREENS_ALL, screenOfRoute, TAB_OF, TAB_ORDER, TAB_ROOT } from "../src/navigation/routes";

test("every screen except signin belongs to exactly one tab, and each tab has a root that lights it up (D1)", () => {
  const screens = SCREENS_ALL.filter((s) => s !== "signin");
  expect(screens).toHaveLength(9);
  for (const s of screens) {
    const tab = TAB_OF[s as Exclude<Screen, "signin">];
    expect(TAB_ORDER).toContain(tab);
    expect(ROOT_OF[s]).toBe(TAB_ROOT[tab]); // el tab que se ilumina es la raíz de la pila
  }
  expect(TAB_ORDER).toEqual(["MarketsTab", "LaunchpadTab", "ActivityTab", "PortfolioTab", "WalletTab"]);
  expect(TAB_ORDER.map((t) => TAB_ROOT[t])).toEqual(SHOW_TABS);
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
  for (const s of GATED) expect(gateTarget(false, s).screen).toBe("signin");
});
