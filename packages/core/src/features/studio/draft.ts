import type { Accent } from "../landing/domain/landing.js";
import type { Skill } from "../research/brief.js";
import type { SportId } from "../research/market-scope.js";
import { policyForStyle, type Style } from "../research/style.js";
import { DEFAULT_CONFIG, PilotError, type AgentConfig } from "../research/types.js";

/** Every venue the studio draws. Only the ones not in SOON_VENUES can run today. */
export const VENUES_ON_MAP = ["polymarket", "perpl"] as const;
export type VenueOnMap = (typeof VENUES_ON_MAP)[number];
export const SOON_VENUES: readonly VenueOnMap[] = ["perpl"];

export interface Beat {
  name: string;
  accent: Accent;
  /** `id` is the runtime's sport id; `null` means the runtime has nothing to research it with. */
  subs: { label: string; id: SportId | null }[];
}

export const BEATS: readonly Beat[] = [
  {
    name: "Sports",
    accent: "lime",
    subs: [
      { label: "NFL", id: "american-football" },
      { label: "NBA", id: "basketball" },
      { label: "Soccer", id: "soccer" },
      { label: "Tennis", id: "tennis" },
    ],
  },
  {
    name: "Crypto",
    accent: "blue",
    subs: [
      { label: "Bitcoin", id: null },
      { label: "Ethereum", id: null },
      { label: "New listings", id: null },
    ],
  },
  {
    name: "Politics",
    accent: "violet",
    subs: [
      { label: "US elections", id: null },
      { label: "Congress", id: null },
      { label: "World", id: null },
    ],
  },
  {
    name: "Economics",
    accent: "amber",
    subs: [
      { label: "Fed", id: null },
      { label: "CPI", id: null },
      { label: "Jobs", id: null },
    ],
  },
  {
    name: "Culture",
    accent: "orange",
    subs: [
      { label: "Awards", id: null },
      { label: "Box office", id: null },
      { label: "Music", id: null },
    ],
  },
  {
    name: "Tech",
    accent: "magenta",
    subs: [
      { label: "AI", id: null },
      { label: "Launches", id: null },
      { label: "Space", id: null },
    ],
  },
];

/** The runtime researches sports only; every other beat is drawn but cannot run yet. */
export const SOON_BEATS: readonly string[] = BEATS.filter((beat) => beat.name !== "Sports").map(
  (beat) => beat.name,
);

/** What a model proposes from one line. Labels, not ids: `draftToConfig` does the mapping. */
export interface AgentDraft {
  name: string;
  handle: string;
  venues: VenueOnMap[];
  beat: string;
  subcategories: string[];
  sites: string[];
  skills: string[];
  edge: string;
  style: Style;
  accent: Accent;
}

export interface AgentDrafter {
  draft(line: string): Promise<AgentDraft>;
}

/** Skills a draft may name, by beat; `other` serves every beat without its own list. */
export const SUGGESTED_SKILLS: Record<string, Skill[]> = {
  Sports: [
    { name: "Injury double-check", prompt: "Only count an injury if two sources confirm it." },
    {
      name: "Weather at kickoff",
      prompt:
        "Check the stadium forecast. Wind over 15 mph lowers the chance of a high-scoring game.",
    },
    {
      name: "Late line moves",
      prompt: "If the line moved more than 2 points in 24 hours, find out why before calling.",
    },
  ],
  other: [
    { name: "Two sources rule", prompt: "Never call on a single source. Find a second one first." },
  ],
};

function suggestedFor(beat: string): Skill[] {
  return SUGGESTED_SKILLS[beat] ?? SUGGESTED_SKILLS.other ?? [];
}

/** Each part of the draft the runtime cannot run yet, as `venue:<x>` or `beat:<x>`. */
export function unsupported(draft: AgentDraft): string[] {
  const reasons: string[] = [];
  for (const venue of draft.venues) {
    if (SOON_VENUES.includes(venue)) {
      reasons.push(`venue:${venue}`);
    }
  }
  if (SOON_BEATS.includes(draft.beat)) {
    reasons.push(`beat:${draft.beat}`);
  }
  return reasons;
}

function sportIds(draft: AgentDraft): SportId[] {
  const beat = BEATS.find((candidate) => candidate.name === draft.beat);
  return draft.subcategories.map((label) => {
    const id = beat?.subs.find((sub) => sub.label === label)?.id;
    if (!id) {
      throw new PilotError("INVALID_INPUT", `Unknown subcategory ${label}`);
    }
    return id;
  });
}

/** The config a supported draft becomes. Refuses a draft that cannot run rather than trimming it. */
export function draftToConfig(draft: AgentDraft): AgentConfig {
  const reasons = unsupported(draft);
  if (reasons.length > 0) {
    throw new PilotError("INVALID_INPUT", `Draft cannot run yet: ${reasons.join(", ")}`);
  }

  const subcategories = sportIds(draft);
  const suggested = suggestedFor(draft.beat);
  const skills = draft.skills
    .map((name) => suggested.find((skill) => skill.name === name))
    .filter((skill): skill is Skill => skill !== undefined)
    .map((skill) => ({ ...skill }));

  // marketScope replaces the legacy category list; assertConfig refuses the two together.
  const defaults = { ...DEFAULT_CONFIG };
  delete defaults.categoryIds;

  return {
    ...defaults,
    tools: [...DEFAULT_CONFIG.tools],
    limits: { ...DEFAULT_CONFIG.limits },
    profile: draft.edge,
    marketScope: { version: 1, category: "sports", subcategories },
    // The draft always turns the web on; the form can turn it off.
    sources: {
      web: { mode: draft.sites.length > 0 ? "prefer" : "anywhere", sites: [...draft.sites] },
      books: [],
    },
    skills,
    uncertaintyPolicy: policyForStyle(draft.style),
    intervalHours: 6,
  };
}
