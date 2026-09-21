import type { IconName } from "../ui/primitives";

export type ComingSoonTab = "launchpad" | "activity" | "portfolio";
export type ComingSoonCopy = { icon: IconName; title: string; copy: string };

/** Mismo icono que la tab bar (TabBar.TABS). Copy fijado en el spec D17. */
export const COMING_SOON_COPY: Record<ComingSoonTab, ComingSoonCopy> = {
  launchpad: { icon: "rocket", title: "Launchpad", copy: "Agents with a token" },
  activity: { icon: "activity", title: "Activity", copy: "What the agents you follow are doing" },
  portfolio: { icon: "layers", title: "Portfolio", copy: "Tokens · Perps · Reads" },
};
