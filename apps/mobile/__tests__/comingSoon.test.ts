import { COMING_SOON_COPY } from "../src/screens/comingSoonCopy";
import { COMING_SOON } from "../src/store";

test("launchpad and activity stay as coming-soon screens, hidden from the tab bar (D1)", () => {
  expect(Object.keys(COMING_SOON_COPY).sort()).toEqual([...COMING_SOON].sort());
  expect(COMING_SOON_COPY.launchpad).toEqual({ icon: "rocket", title: "Launchpad", copy: "Agents with a token" });
  expect(COMING_SOON_COPY.activity).toEqual({ icon: "activity", title: "Activity", copy: "What the agents you follow are doing" });
  expect((COMING_SOON_COPY as Record<string, unknown>).portfolio).toBeUndefined();
});

test("Ask and Agents are real now: no inline coming-soon copy for Market pills (D13)", () => {
  expect((COMING_SOON_COPY as Record<string, unknown>).ask).toBeUndefined();
  expect((COMING_SOON_COPY as Record<string, unknown>).agents).toBeUndefined();
});
