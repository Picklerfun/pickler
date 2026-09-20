import { COMING_SOON_COPY } from "../src/screens/comingSoonCopy";
import { COMING_SOON } from "../src/store";

test("every coming-soon tab has its lucide icon, title and one-line copy", () => {
  expect(Object.keys(COMING_SOON_COPY).sort()).toEqual([...COMING_SOON].sort());
  expect(COMING_SOON_COPY.launchpad).toEqual({ icon: "rocket", title: "Launchpad", copy: "Agents with a token" });
  expect(COMING_SOON_COPY.activity).toEqual({ icon: "activity", title: "Activity", copy: "What the agents you follow are doing" });
  expect(COMING_SOON_COPY.portfolio).toEqual({ icon: "layers", title: "Portfolio", copy: "Tokens · Perps · Reads" });
});

test("Ask and Agents are real now: no inline coming-soon copy for Market pills (D13)", () => {
  expect((COMING_SOON_COPY as Record<string, unknown>).ask).toBeUndefined();
  expect((COMING_SOON_COPY as Record<string, unknown>).agents).toBeUndefined();
});
