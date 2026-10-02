import type { IconName } from "../ui/primitives";

/** Launchpad y Activity: se integran después (spec mobile-light D1); hoy son pantallas registradas fuera de la barra. */
export type ComingSoonTab = "launchpad" | "activity";
export type ComingSoonCopy = { icon: IconName; title: string; copy: string };

/** Icono de cada pantalla "coming soon" (están fuera de la tab bar, D1). Copy fijado en el spec D17. */
export const COMING_SOON_COPY: Record<ComingSoonTab, ComingSoonCopy> = {
  launchpad: { icon: "rocket", title: "Launchpad", copy: "Agents with a token" },
  activity: { icon: "activity", title: "Activity", copy: "What the agents you follow are doing" },
};
