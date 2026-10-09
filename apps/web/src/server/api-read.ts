import type { AnalyticsRangeDto, PlatformAnalyticsDto } from "@pickler/api-schema";

/* A public board reads data anyone may see, and the API it reads can be behind the web: the web
   deploys from main on every merge, the API does not. A route the API does not have yet (404) or a
   dependency that is down (5xx) is then the board's launch-day empty screen with one line saying it
   is catching up, not an error page. Anything else (400, 401, 403) is a real fault and still throws.
   Private screens never read through here: an empty portfolio shown to a signed-in person would be
   a lie about their money. */

export interface Degradable<T> {
  data: T;
  /** True when the API could not answer and `data` is the empty value. */
  degraded: boolean;
}

const degradedBy = (status: number) => status === 404 || status >= 500;

const logDegraded = (path: string, status: number) =>
  console.warn(JSON.stringify({ event: "api_degraded", path, status }));

/** A list or a board: on 404 or 5xx, the empty value and `degraded: true`. */
export async function readOrEmpty<T>(
  response: Response,
  path: string,
  empty: T,
): Promise<Degradable<T>> {
  if (response.ok) {
    return { data: (await response.json()) as T, degraded: false };
  }
  if (degradedBy(response.status)) {
    logDegraded(path, response.status);
    return { data: empty, degraded: true };
  }
  throw new Error(`Pickler API request failed (${response.status})`);
}

/** One item: 404 is "not found" (the page's own not-found path), 5xx the same, logged. */
export async function readOrNull<T>(response: Response, path: string): Promise<T | null> {
  if (response.ok) {
    return (await response.json()) as T | null;
  }
  if (degradedBy(response.status)) {
    if (response.status !== 404) {
      logDegraded(path, response.status);
    }
    return null;
  }
  throw new Error(`Pickler API request failed (${response.status})`);
}

/**
 * One item that is read from a venue: 503 means the venue could not be read, which is not "not
 * found". It throws, so the page shows the error screen instead of telling someone that a market
 * that exists does not. Everything else is `readOrNull`.
 */
export async function readVenueItemOrNull<T>(response: Response, path: string): Promise<T | null> {
  if (response.status === 503) {
    logDegraded(path, response.status);
    throw new Error("Market data is temporarily unavailable (503)");
  }
  return readOrNull<T>(response, path);
}

const RANGES: readonly AnalyticsRangeDto[] = ["7d", "30d", "90d"];

/** Analytics with nothing in them, for the range that was asked. */
export const emptyAnalytics = (range?: string): PlatformAnalyticsDto => ({
  range: RANGES.find((known) => known === range) ?? "30d",
  settledVolumeAllTime: 0,
  groups: [],
  predictionsShare: 0,
  splitNote: "",
  series: [],
  log: [],
  table: [],
});
