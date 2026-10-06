/** Local Studio navigation only; this value never grants workspace access. */
export interface StudioReturnContext {
  agent?: string | undefined;
  section?: string | undefined;
}

const RETURN_PARAMETERS = ["stage", "agent", "section", "resume"] as const;

/** Attach the current workspace to a profile link without persisting private configuration. */
export function profileFromStudio(
  pathname: string,
  search: string,
  context: StudioReturnContext = {},
): string {
  const path = pathname === "/" ? "/" : "/studio";
  const source = new URLSearchParams(search);
  const params = new URLSearchParams();
  for (const key of RETURN_PARAMETERS) {
    const value = source.get(key);
    if (value) {
      params.set(key, value);
    }
  }
  if (context.agent) {
    params.set("agent", context.agent);
  }
  if (context.section) {
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
      !asked.startsWith("/") ||
      asked.startsWith("//") ||
      url.origin !== "https://studio.invalid" ||
      url.pathname !== fallback ||
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
    return `${fallback}${params.size ? `?${params}` : ""}`;
  } catch {
    return fallback;
  }
}
