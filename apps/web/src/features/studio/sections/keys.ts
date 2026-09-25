/**
 * Every section the rail can reach, in the rail's own order.
 *
 * Deliberately not in `stub.tsx`, which is a client module: a `"use client"` file's exports reach a
 * server component as client references rather than as values, so `/studio`'s page could import
 * this list and typecheck cleanly while `SECTIONS.find` threw at request time. The list is data, so
 * it lives where both sides can read it.
 */
export const SECTIONS = [
  "overview",
  "console",
  "picks",
  "activity",
  "brief",
  "skills",
  "sources",
  "limits",
  "identity",
  "profile",
  "audience",
  "token",
  "board",
] as const;

export type SectionKey = (typeof SECTIONS)[number];

/**
 * Which section a link asked the studio to open on, or undefined to open where it always has.
 *
 * Outside production only. Deep-linking a section is a verification affordance — every design check
 * opens on the overview, so without this they measure one section and report on the screen — and
 * not a feature: the studio keeps its section in state and has no routing story to rely on.
 *
 * `nodeEnv` is an argument rather than a read so the guard can be pinned in both positions.
 */
/** The empty studio's two phases. The canvas has a `startPhase` prop for the same reason. */
export const PHASES = ["create", "draft"] as const;
export type Phase = (typeof PHASES)[number];

/**
 * Which phase the empty studio opens in. `draft` is the second half of that screen — the checklist
 * between a draft agent and a public one — and it is only reachable by finishing the first half,
 * so without this no check ever sees it. Outside production only, as with the section.
 */
export function phaseFromSearch(
  nodeEnv: string | undefined,
  asked: string | string[] | undefined,
): Phase | undefined {
  if (nodeEnv === "production") {
    return undefined;
  }
  const value = Array.isArray(asked) ? asked[0] : asked;
  return PHASES.find((key): key is Phase => key === value);
}

export function sectionFromSearch(
  nodeEnv: string | undefined,
  asked: string | string[] | undefined,
): SectionKey | undefined {
  if (nodeEnv === "production") {
    return undefined;
  }
  const value = Array.isArray(asked) ? asked[0] : asked;
  return SECTIONS.find((key): key is SectionKey => key === value);
}
