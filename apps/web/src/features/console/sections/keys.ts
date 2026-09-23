/**
 * Every section the rail can reach, in the rail's own order.
 *
 * Deliberately not in `stub.tsx`, which is a client module: a `"use client"` file's exports reach a
 * server component as client references rather than as values, so `/console`'s page could import
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
