import { COMING_SOON_COPY, MARKET_COMING_SOON } from "../src/screens/comingSoonCopy";
import { COMING_SOON } from "../src/store";

test("every coming-soon tab has its lucide icon, title and one-line copy", () => {
  expect(Object.keys(COMING_SOON_COPY).sort()).toEqual([...COMING_SOON].sort());
  expect(COMING_SOON_COPY.launchpad).toEqual({ icon: "rocket", title: "Launchpad", copy: "Agents with a token" });
  expect(COMING_SOON_COPY.activity).toEqual({ icon: "activity", title: "Activity", copy: "What the agents you follow are doing" });
  expect(COMING_SOON_COPY.portfolio).toEqual({ icon: "layers", title: "Portfolio", copy: "Tokens · Perps · Reads" });
});

test("the Ask and Agents pills of Market have their inline copy", () => {
  expect(MARKET_COMING_SOON.ask.copy).toBe("Ask an agent for a read on this market");
  expect(MARKET_COMING_SOON.agents.copy).toBe("Who trades and who reads this market");
});
