import type { PtsResearchGeometry } from "./research-types.js";

export interface RetainedResearchSetup {
  geometry: PtsResearchGeometry;
  admittedAt: number;
}

function compareId(a: RetainedResearchSetup, b: RetainedResearchSetup) {
  return a.geometry.abcId < b.geometry.abcId ? -1 : a.geometry.abcId > b.geometry.abcId ? 1 : 0;
}

/** Eviction and selection deliberately use different clocks. */
export function researchEvictionOrder(a: RetainedResearchSetup, b: RetainedResearchSetup) {
  return a.geometry.c.confirmedAt - b.geometry.c.confirmedAt || compareId(a, b);
}

export function researchReadinessOrder(a: RetainedResearchSetup, b: RetainedResearchSetup) {
  return a.admittedAt - b.admittedAt || compareId(a, b);
}

export function boundResearchSetups(setups: Map<string, RetainedResearchSetup>) {
  const evicted: string[] = [];
  for (const direction of ["long", "short"] as const) {
    const ordered = [...setups.values()]
      .filter((state) => state.geometry.direction === direction)
      .sort(researchEvictionOrder);
    while (ordered.length > 32) {
      const state = ordered.shift()!;
      setups.delete(state.geometry.abcId);
      evicted.push(state.geometry.abcId);
    }
  }
  return evicted;
}
