import { studioAgentRoute, agentSectionHref } from "../routing/routes";
/** Local Studio navigation only; this value never grants workspace access. */
export interface StudioReturnContext {
  agent?: string | undefined;
  section?: string | undefined;
}

const RETURN_PARAMETERS = ["stage", "agent", "section", "resume", "check"] as const;

/** Attach the current workspace to a profile link without persisting private configuration. */
export function profileFromStudio(
  pathname: string,
  search: string,
  context: StudioReturnContext = {},
): string {
  const routed = studioAgentRoute(pathname);
  const path = routed
    ? agentSectionHref(routed.agentId, routed.section)
    : pathname === "/studio/new"
      ? pathname
      : pathname === "/"
        ? "/"
        : "/studio";
  const source = new URLSearchParams(search);
  const params = new URLSearchParams();
  for (const key of RETURN_PARAMETERS) {
    const value = source.get(key);
    if (value) {
      params.set(key, value);
    }
  }
  if (!routed && context.agent) {
    params.set("agent", context.agent);
  }
  if (!routed && context.section) {
    params.set("resume", context.section);
  }
  const suffix = params.size ? `?${params}` : "";
  const profile = new URLSearchParams({ section: "profile", returnTo: `${path}${suffix}` });
  return `/account?${profile}`;
}

/** Refuse arbitrary destinations, including the marketplace root on a shared host. */
export function studioReturnHref(asked: string | undefined, fallback: string): string {
  if (!asked || !["/", "/studio"].includes(fallback)) {
    return fallback;
  }
  try {
    const url = new URL(asked, "https://studio.invalid");
    if (
      /[\\\u0000-\u001f\u007f]/.test(asked) ||
      /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(asked.split("?")[0]!) ||
      !asked.startsWith("/") ||
      asked.startsWith("//") ||
      url.origin !== "https://studio.invalid" ||
      (url.pathname !== fallback &&
        url.pathname !== "/studio/new" &&
        !studioAgentRoute(url.pathname)) ||
      url.hash
    ) {
      return fallback;
    }
    const params = new URLSearchParams();
    for (const key of RETURN_PARAMETERS) {
      const value = url.searchParams.get(key);
      if (value) {
        params.set(key, value);
      }
    }
    return `${url.pathname}${params.size ? `?${params}` : ""}`;
  } catch {
    return fallback;
  }
}
