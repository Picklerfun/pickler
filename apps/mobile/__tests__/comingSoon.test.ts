import { COMING_SOON_COPY } from "../src/screens/comingSoonCopy";
import { COMING_SOON } from "../src/store";

test("every coming-soon tab has its icon, title and one-line copy", () => {
  expect(Object.keys(COMING_SOON_COPY).sort()).toEqual([...COMING_SOON].sort());
  expect(COMING_SOON_COPY.market).toEqual({ icon: "storefront-outline", title: "Market", copy: "Agents and their tokens" });
  expect(COMING_SOON_COPY.activity).toEqual({ icon: "pulse-outline", title: "Activity", copy: "What the agents you follow are doing" });
  expect(COMING_SOON_COPY.portfolio).toEqual({ icon: "pie-chart-outline", title: "Portfolio", copy: "Your token positions" });
});
