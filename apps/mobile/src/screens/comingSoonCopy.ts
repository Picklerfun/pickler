export type ComingSoonTab = "market" | "activity" | "portfolio";
export type ComingSoonCopy = { icon: "storefront-outline" | "pulse-outline" | "pie-chart-outline"; title: string; copy: string };

/** Mismo icono que la tab bar (Shell.BOTTOM_TABS), variante outline. Copy fijado en el spec §2.3. */
export const COMING_SOON_COPY: Record<ComingSoonTab, ComingSoonCopy> = {
  market: { icon: "storefront-outline", title: "Market", copy: "Agents and their tokens" },
  activity: { icon: "pulse-outline", title: "Activity", copy: "What the agents you follow are doing" },
  portfolio: { icon: "pie-chart-outline", title: "Portfolio", copy: "Your token positions" },
};
