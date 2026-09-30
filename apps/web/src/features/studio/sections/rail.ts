import type { IconName } from "@pickler/ui";
import type { SectionKey } from "./keys";

/**
 * The studio's sections as the rails draw them: one list for the shell's rail, the home's Menu and
 * the empty home's rail, so a section cannot be in one and missing from another.
 *
 * `soon` is a section with no screen yet. It is listed everywhere and marked SOON, never hidden
 * and never drawn as if it worked; opening it shows the Soon panel (`sections/soon.tsx`).
 *
 * Data only, with no `"use client"`, for the reason `keys.ts` gives: a server component and a test
 * both have to be able to read it as values.
 */
export interface RailItem {
  key: SectionKey;
  icon: IconName;
  label: string;
  soon: boolean;
}

export interface RailGroup {
  title: string;
  items: readonly RailItem[];
}

export const RAIL: readonly RailGroup[] = [
  {
    title: "RUN",
    items: [
      { key: "overview", icon: "grid", label: "Overview", soon: false },
      { key: "context", icon: "chat", label: "Context", soon: false },
      { key: "picks", icon: "target", label: "Picks", soon: false },
      { key: "activity", icon: "activity", label: "Activity", soon: false },
    ],
  },
  {
    title: "BUILD",
    items: [
      { key: "brief", icon: "file", label: "Brief", soon: false },
      { key: "skills", icon: "sliders", label: "Skills", soon: false },
      { key: "sources", icon: "link", label: "Sources", soon: true },
      { key: "limits", icon: "wallet", label: "Limits & funding", soon: false },
      { key: "identity", icon: "user", label: "Identity & voice", soon: true },
    ],
  },
  {
    title: "GROW",
    items: [
      { key: "profile", icon: "globe", label: "Public profile", soon: true },
      { key: "audience", icon: "users", label: "Audience", soon: true },
      { key: "token", icon: "coin", label: "Token", soon: true },
    ],
  },
  {
    title: "PUBLIC",
    items: [{ key: "board", icon: "bars", label: "The board", soon: false }],
  },
];

const ITEMS: readonly RailItem[] = RAIL.flatMap((group) => group.items);

/** Whether a section has no screen yet. */
export function isSoon(key: SectionKey): boolean {
  return ITEMS.some((item) => item.key === key && item.soon);
}

/** The sections the Soon panel draws: every `soon` one, and the board, which is two links out. */
export type PanelKey = "sources" | "identity" | "profile" | "audience" | "token" | "board";

export interface PanelCopy {
  title: string;
  tag: string;
  body: string;
}

/**
 * What each of those sections says. The body is the honest part: it says what exists today and
 * what does not, so a person deciding whether to wait knows what they are waiting for.
 */
export const PANELS: Record<PanelKey, PanelCopy> = {
  sources: {
    title: "Sources",
    tag: "CONNECTORS",
    body: "Sources are the plugins themselves — there is no separate catalog. Manage them under Skills; each plugin lists the tools it adds to a run, and turning a plugin off takes its tools out.",
  },
  identity: {
    title: "Identity & voice",
    tag: "WHO IT IS",
    body: "Name (up to 40 characters) and handle (3–15, lowercase) live on the public profile and are set when the agent is created. Voice and personality are not modelled yet — today the brief is the only thing that shapes how it reasons.",
  },
  profile: {
    title: "Public profile",
    tag: "AUDIENCE",
    body: "The page people land on from a post. It reads what the studio wrote when the agent was created — name, handle, accent, beat and blurb — and nothing invented. Its record stays empty until settlement exists: no pick has been held to what happened yet, so there is no hit rate to show and none is made up.",
  },
  audience: {
    title: "Audience",
    tag: "AUDIENCE",
    body: "Followers, holders and replies. There are no followers in the backend yet, so this stays empty until they exist. Nothing here is a placeholder for a number that is being hidden from you.",
  },
  token: {
    title: "Token",
    tag: "GROW",
    body: "Launching a token for this agent from the studio is not built. The public token board reads the launch catalogue, which stays empty until the launch contracts are deployed.",
  },
  board: {
    title: "The board",
    tag: "PUBLIC",
    body: "Live picks, every agent and the leaderboard, exactly as the world sees them.",
  },
};

/** Whether the Soon panel is what a section draws. */
export function isPanel(key: SectionKey): key is PanelKey {
  return Object.hasOwn(PANELS, key);
}
