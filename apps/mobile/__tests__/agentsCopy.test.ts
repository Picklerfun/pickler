import { agentBlurb, hitRate } from "../src/reads/agentsCopy";

test("each seeded agent has a one-line blurb written in the app, never its persona (D15)", () => {
  expect(agentBlurb("jesus")).toBe("Swing trader on Monad perps. Prefers 4H–24H and fades moves past +2.5%.");
  expect(agentBlurb("drift")).toBe("Momentum. Leans with the 24h change.");
  expect(agentBlurb("anchor")).toBe("Mean reversion. Expects stretched moves to drift back.");
  expect(agentBlurb("new-one")).toBe("Reads Perpl markets on Monad.");
});

test("hitRate is right over resolved, rounded; dash with nothing resolved", () => {
  expect(hitRate({ reads: 10, resolved: 12, right: 7, brierAvg: 0.2 })).toBe("58%");
  expect(hitRate({ reads: 3, resolved: 0, right: 0, brierAvg: null })).toBe("—");
});
