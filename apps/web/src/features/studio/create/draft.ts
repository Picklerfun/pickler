/**
 * The draft an agent is before it exists, for the "Pickler Create First Agent v2" flow.
 *
 * The screen is a Describe step, one line, that either fills in an auto set-up from
 * `POST /v1/studio/agents/draft` or hands the person seven manual steps: name, trades, looks,
 * reads, skills, decides, review. This module is those steps' rules and nothing else — no React,
 * no transport — so each one can be pinned on its own rather than through a rendered step.
 *
 * The web cannot be turned off in this plan: a run without any source fails, so there is no
 * `webOn` field here — only which of the web's three modes it runs in. Perpl and every beat but
 * Sports are drawn because the canvas draws them, but `soonRows` blocks Review until neither is
 * chosen, exactly the way `SOON_VENUES`/`SOON_BEATS` block a draft from becoming a config in core.
 *
 * Every value below that also lives in `@pickler/api-schema` (`SOON_VENUES`, `SOON_BEATS`,
 * `SPORT_SUB_IDS`, `STYLE_POLICIES`, `SUGGESTED_SKILLS` in `packages/api-schema/src/studio.ts`) is
 * a literal copy, not an import: `apps/web` is CommonJS to node's module resolver and
 * `@pickler/api-schema` publishes only an "import" condition, so a module that reads its values at
 * load time cannot be required by a node:test here — see
 * `apps/web/src/features/wallet/lib/handles.ts` for the same note on the same constraint. Only
 * types are imported, which cost nothing because they are erased before this ever runs. Core stays
 * the one authority; api-schema's copies are pinned against it by
 * `workers/api/test/accent-venue-mirror.test.ts`, and this file's copies are kept equal to
 * api-schema's by the module comment and by matching the draft body the pin test itself checks.
 */
import type { AccentDto, AgentDraftDto, StyleDto, VenueDto } from "@pickler/api-schema";
import type { Config, Options } from "../api";
import type { Profile } from "../profile";

export const ORDER = ["name", "trades", "looks", "reads", "skills", "decides", "review"] as const;
export type OrderStep = (typeof ORDER)[number];
export type Step = "start" | "reading" | OrderStep | "run";

export type VenueOnMap = "polymarket" | "perpl";
export type WebMode = "anywhere" | "prefer" | "only";

type SportId = "american-football" | "basketball" | "soccer" | "tennis";

/** Mirrors `SOON_VENUES` in `@pickler/api-schema` — see the module comment for why it is a copy. */
const SOON_VENUES: readonly VenueOnMap[] = ["perpl"];

/** Mirrors `SOON_BEATS` in `@pickler/api-schema`. */
const SOON_BEATS: readonly string[] = ["Crypto", "Politics", "Economics", "Culture", "Tech"];

/** Mirrors `SPORT_SUB_IDS` in `@pickler/api-schema`. */
const SPORT_SUB_IDS: Record<string, SportId> = {
  NFL: "american-football",
  NBA: "basketball",
  Soccer: "soccer",
  Tennis: "tennis",
};

/** Mirrors `STYLE_POLICIES` in `@pickler/api-schema`. */
const STYLE_POLICIES: Record<
  StyleDto,
  {
    blockHighUncertainty: boolean;
    requireCompleteInformation: boolean;
    minProbabilityMargin: number;
    maxProbabilityRangeWidth: number;
  }
> = {
  careful: {
    blockHighUncertainty: true,
    requireCompleteInformation: true,
    minProbabilityMargin: 0.08,
    maxProbabilityRangeWidth: 0.15,
  },
  balanced: {
    blockHighUncertainty: true,
    requireCompleteInformation: true,
    minProbabilityMargin: 0.04,
    maxProbabilityRangeWidth: 0.2,
  },
  bold: {
    blockHighUncertainty: true,
    requireCompleteInformation: true,
    minProbabilityMargin: 0.02,
    maxProbabilityRangeWidth: 0.3,
  },
};

export interface CustomSkill {
  name: string;
  prompt: string;
}

export interface Draft {
  /** The one line the Describe step collects. Empty once past it in the manual flow. */
  prompt: string;
  name: string;
  handle: string;
  /** `null` is "not checked yet"; only `true` lets the name step move on. */
  handleAvailable: boolean | null;
  venues: VenueOnMap[];
  beat: string;
  subs: string[];
  /** Perp symbols (e.g. "BTC", "ETH"), chosen only when `perpl` is among `venues`. */
  perps: string[];
  webMode: WebMode;
  /** Bare hostnames, lower case, in the order added. At most 20. */
  sites: string[];
  /** `SPORTSBOOKS` keys, offered only for the NFL subcategory of Sports. */
  books: string[];
  /** Suggested skill names the person kept, from `SUGGESTED_SKILLS[beat]` (or `other`). */
  skills: string[];
  custom: CustomSkill[];
  edge: string;
  style: StyleDto;
  accent: AccentDto;
  xHandle: string | null;
}

export function emptyDraft(): Draft {
  return {
    prompt: "",
    name: "",
    handle: "",
    handleAvailable: null,
    venues: [],
    beat: "",
    subs: [],
    perps: [],
    webMode: "anywhere",
    sites: [],
    books: [],
    skills: [],
    custom: [],
    edge: "",
    style: "balanced",
    accent: "lime",
    xHandle: null,
  };
}

const HANDLE_RE = /^[a-z0-9_]{3,15}$/;

/** Whether this Sports subcategory is the only one with real market data today. */
export function isNfl(d: Draft): boolean {
  return d.beat === "Sports" && d.subs.includes("NFL");
}

/** Whether a step has what it needs to move on. One rule per step, and no step skips another. */
export function ready(step: Step, d: Draft): boolean {
  switch (step) {
    case "start":
      return d.prompt.trim().length > 0;
    case "reading":
    case "run":
      return true;
    case "name":
      return (
        d.name.trim().length > 0 &&
        d.name.trim().length <= 40 &&
        HANDLE_RE.test(d.handle) &&
        d.handleAvailable === true
      );
    case "trades":
      return d.venues.length > 0;
    case "looks": {
      const polymarketOk = !d.venues.includes("polymarket") || (d.beat !== "" && d.subs.length > 0);
      const perplOk = !d.venues.includes("perpl") || d.perps.length > 0;
      return polymarketOk && perplOk;
    }
    case "reads":
      return d.webMode === "anywhere" || d.sites.length > 0;
    case "skills":
      return true;
    case "decides":
      return d.edge.trim().length > 0;
    case "review":
      return (
        ORDER.filter((s): s is Exclude<OrderStep, "review"> => s !== "review").every((s) =>
          ready(s, d),
        ) && soonRows(d).length === 0
      );
  }
}

const VENUE_LABELS: Record<VenueOnMap, string> = { polymarket: "Polymarket", perpl: "Perpl" };

export interface SoonRow {
  label: "TRADES ON" | "CALLS";
  reason: string;
}

/** Rows the review step shows, and blocks creation over, for a Soon venue or beat. */
export function soonRows(d: Draft): SoonRow[] {
  const rows: SoonRow[] = [];
  const soonVenue = d.venues.find((venue) => SOON_VENUES.includes(venue));
  if (soonVenue) {
    rows.push({
      label: "TRADES ON",
      reason: `${VENUE_LABELS[soonVenue]} is coming soon.`,
    });
  }
  if (d.beat !== "" && SOON_BEATS.includes(d.beat)) {
    rows.push({ label: "CALLS", reason: `${d.beat} is coming soon.` });
  }
  return rows;
}

export function tradesText(d: Draft): string {
  return d.venues.map((venue) => VENUE_LABELS[venue]).join(" + ");
}

export function callsText(d: Draft): string {
  const parts: string[] = [];
  if (d.venues.includes("polymarket")) {
    parts.push(d.subs.length > 0 ? `${d.beat} · ${d.subs.join(", ")}` : d.beat);
  }
  if (d.venues.includes("perpl")) {
    parts.push(d.perps.length > 0 ? `${d.perps.join(", ")} perps` : "perps");
  }
  return parts.filter((part) => part.length > 0).join(" / ");
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** "Market data, Web · prefer 3 sites, Sports data, 3 books" — the canvas's own segment order. */
export function readsText(d: Draft): string {
  const parts = ["Market data"];
  parts.push(
    d.webMode === "anywhere"
      ? "Web · anywhere"
      : `Web · ${d.webMode} ${plural(d.sites.length, "site")}`,
  );
  if (d.beat === "Sports") {
    parts.push("Sports data");
  }
  if (isNfl(d) && d.books.length > 0) {
    parts.push(plural(d.books.length, "book"));
  }
  return parts.join(", ");
}

export function skillsText(d: Draft): string {
  const names = [...d.skills, ...d.custom.map((skill) => skill.name)];
  return names.length > 0 ? names.join(", ") : "None yet";
}

const STYLE_LABELS: Record<StyleDto, string> = {
  careful: "Careful",
  balanced: "Balanced",
  bold: "Bold",
};

export function decidesText(d: Draft): string {
  return `${STYLE_LABELS[d.style]} · ${d.edge.trim()}`;
}

export interface ReviewRow {
  key: "name" | "tradesOn" | "calls" | "reads" | "skills" | "decides";
  label: string;
  value: string;
}

export function reviewRows(d: Draft): ReviewRow[] {
  return [
    { key: "name", label: "NAME", value: `${d.name} · @${d.handle}` },
    { key: "tradesOn", label: "TRADES ON", value: tradesText(d) },
    { key: "calls", label: "CALLS", value: callsText(d) },
    { key: "reads", label: "READS", value: readsText(d) },
    { key: "skills", label: "SKILLS", value: skillsText(d) },
    { key: "decides", label: "DECIDES", value: decidesText(d) },
  ];
}

/** The API draft, filled into the form. Prefer mode when it proposed sites, anywhere otherwise. */
export function fromApiDraft(dto: AgentDraftDto): Draft {
  return {
    ...emptyDraft(),
    name: dto.name,
    handle: dto.handle,
    venues: [...dto.venues],
    beat: dto.beat,
    subs: [...dto.subcategories],
    sites: [...dto.sites],
    webMode: dto.sites.length > 0 ? "prefer" : "anywhere",
    skills: [...dto.skills],
    edge: dto.edge,
    style: dto.style,
    accent: dto.accent,
  };
}

const HOST_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const SITE_MAX = 20;

/** A site as the person typed it becomes a bare host: scheme and path stripped, lower case. */
function normalizeHost(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  return withoutScheme.split(/[/?#]/)[0] ?? "";
}

/** Adds a normalised, deduplicated site up to the cap; an invalid or duplicate one is a no-op. */
export function addSite(d: Draft, raw: string): Draft {
  const host = normalizeHost(raw);
  if (!HOST_RE.test(host) || d.sites.includes(host) || d.sites.length >= SITE_MAX) {
    return d;
  }
  return { ...d, sites: [...d.sites, host] };
}

/** Adds `value` to `list` if absent, removes it if present. Used by every chip-style toggle. */
export function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** Mirrors `SUGGESTED_SKILLS` in `@pickler/api-schema`; `other` serves every beat without its own list. */
const SUGGESTED_SKILLS: Record<string, CustomSkill[]> = {
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

function suggestedSkills(beat: string): CustomSkill[] {
  return SUGGESTED_SKILLS[beat] ?? SUGGESTED_SKILLS.other ?? [];
}

function resolvedSkills(d: Draft): CustomSkill[] {
  const suggested = suggestedSkills(d.beat);
  const chosen = d.skills
    .map((name) => suggested.find((skill) => skill.name === name))
    .filter((skill): skill is CustomSkill => skill !== undefined);
  return [...chosen, ...d.custom];
}

function sportIds(d: Draft): SportId[] {
  return d.subs
    .map((label) => SPORT_SUB_IDS[label])
    .filter((id): id is SportId => id !== undefined);
}

/** `predictions`/`perps`/`both` from the trades-on venues; `both` when the person picked both. */
function venueFor(venues: readonly VenueOnMap[]): VenueDto {
  if (venues.includes("polymarket") && venues.includes("perpl")) {
    return "both";
  }
  return venues.includes("perpl") ? "perps" : "predictions";
}

export type CreateAgentBody = {
  name: string;
  handle: string;
  config: Config;
  profile: Profile;
  wallet: { walletId: string };
};

/**
 * The `POST /agents` body a ready draft becomes, given the `/options` defaults every screen opens
 * on. `config` keeps the defaults' `limits` and `tools` and overrides everything the steps
 * actually asked about — the same shape core's `draftToConfig` builds, expressed over the form's
 * own fields (web mode, books and custom skills included, none of which a model draft carries).
 */
export function toCreate(
  d: Draft,
  walletId: string,
  defaults: Options["defaults"],
): CreateAgentBody {
  const config: Config = {
    ...defaults,
    profile: d.edge.trim(),
    marketScope: { version: 1, category: "sports", subcategories: sportIds(d) },
    sources: { web: { mode: d.webMode, sites: [...d.sites] }, books: [...d.books] },
    skills: resolvedSkills(d),
    uncertaintyPolicy: STYLE_POLICIES[d.style],
    intervalHours: 6,
  } as Config;

  const profile: Profile = {
    accent: d.accent,
    blurb: d.edge.trim().slice(0, 280),
    venue: venueFor(d.venues),
    vibe: "",
    voice: "",
    decides: "",
    wrong: "",
    xHandle: d.xHandle,
  };

  return {
    name: d.name.trim().slice(0, 40),
    handle: d.handle,
    config,
    profile,
    wallet: { walletId },
  };
}
