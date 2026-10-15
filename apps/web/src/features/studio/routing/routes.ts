/** URL contracts for private Studio; these values never grant access to an agent. */
export const STUDIO_ROUTE_SECTIONS = [
  "overview",
  "console",
  "picks",
  "activity",
  "brief",
  "skills",
  "limits",
  "identity",
  "profile",
  "trade",
  "master",
  "positions",
  "record",
  "decisions",
  "posts",
  "controls",
  "agents",
  "markets",
  "leaders",
  "account",
  "context",
  "sources",
  "audience",
  "token",
  "board",
] as const;
export type StudioRouteSection = (typeof STUDIO_ROUTE_SECTIONS)[number];
export function isStudioRouteSection(value: string): value is StudioRouteSection {
  return STUDIO_ROUTE_SECTIONS.some((section) => section === value);
}
export function validAgentSegment(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
export function agentSectionHref(
  agentId: string,
  section: string,
  search = "",
  check?: string | null,
): string {
  if (!validAgentSegment(agentId) || !isStudioRouteSection(section)) {
    throw new Error("Invalid Studio destination.");
  }
  const query = new URLSearchParams();
  const stage = new URLSearchParams(search).get("stage");
  if (process.env.NODE_ENV !== "production" && stage) {
    query.set("stage", stage);
  }
  if (check && validAgentSegment(check)) {
    query.set("check", check);
  }
  return `/studio/agents/${agentId}/${section}${query.size ? `?${query}` : ""}`;
}
export function studioAgentRoute(
  pathname: string,
): { agentId: string; section: StudioRouteSection } | null {
  const match = /^\/studio\/agents\/([A-Za-z0-9_-]{1,128})\/([a-z]+)\/?$/.exec(pathname);
  if (!match || !isStudioRouteSection(match[2]!)) {
    return null;
  }
  return { agentId: match[1]!, section: match[2] };
}
