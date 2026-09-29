/**
 * The first run's trace, one line per event the runtime wrote, in words a person reads while it
 * thinks. Pure, so each event kind's line is pinned in `studio-create-flow.test.ts`.
 *
 * Only events that say something about the call become lines. Token counts and model diagnostics
 * are for the Activity section, which shows every event as it was written.
 */
import type { RunEvent } from "../api";

export type TraceTint = "lime" | "violet" | "amber" | "blue" | "magenta";

export interface TraceLine {
  id: number;
  text: string;
  meta: string;
  tint: TraceTint;
}

const QUIET = new Set(["model_step_usage", "model_usage", "model_diagnostic", "discovery_scan"]);

const field = (data: unknown, key: string): unknown =>
  data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)[key]
    : undefined;

function words(event: RunEvent): { text: string; tint: TraceTint } {
  switch (event.type) {
    case "runtime":
      return { text: "Picked up by a runner", tint: "violet" };
    case "eligible_candidates": {
      const count = Array.isArray(event.data) ? event.data.length : null;
      return {
        text: count === null ? "Found markets it may call" : `Found ${count} markets it may call`,
        tint: "violet",
      };
    }
    case "selection":
      return { text: "Chose the market to call", tint: "violet" };
    case "market_classification":
      return { text: "Read what kind of market it is", tint: "violet" };
    case "plugin_availability":
      return { text: "Checked which sources answer", tint: "blue" };
    case "source":
      return { text: "Read the market rules", tint: "violet" };
    case "search_query": {
      const query = field(event.data, "query");
      return {
        text: typeof query === "string" ? `Searched “${query}”` : "Searched the web",
        tint: "amber",
      };
    }
    case "research_references":
      return { text: "Gathered its sources", tint: "blue" };
    case "sources.fallback":
      return { text: "Went wider than its preferred sites", tint: "amber" };
    case "model_assessment":
      return { text: "Formed its view", tint: "lime" };
    case "policy_evaluation": {
      const action = field(event.data, "finalAction");
      return {
        text: action === "TRADE" ? "Its rules let the call through" : "Its rules held it back",
        tint: "lime",
      };
    }
    case "brief_evaluation": {
      const entries = field(event.data, "entries");
      if (!Array.isArray(entries)) {
        return { text: "Checked its entry rules", tint: "blue" };
      }
      const fired = entries.flatMap((entry, i) => (field(entry, "fired") === true ? [i + 1] : []));
      if (fired.length === 0) {
        const noun = entries.length === 1 ? "entry" : "entries";
        return { text: `Checked ${entries.length} ${noun} · none fired`, tint: "magenta" };
      }
      const held = entries.length - fired.length;
      return {
        text: `Entry ${fired.join(" and ")} fired${held ? ` · ${held} held` : ""}`,
        tint: "blue",
      };
    }
    case "model_failure":
    case "provider_failure":
    case "persistence_failure":
      return { text: "Something failed on the way", tint: "magenta" };
    default:
      return { text: event.type.replace(/[_.]/g, " "), tint: "violet" };
  }
}

/** Seconds from `base`, the run's start (or its creation while still queued). */
export function traceLines(events: readonly RunEvent[], base: number): TraceLine[] {
  return events
    .filter((event) => !QUIET.has(event.type))
    .map((event) => {
      const { text, tint } = words(event);
      const seconds = Math.max(0, (event.createdAt - base) / 1000);
      return { id: event.id, text, meta: `${seconds.toFixed(1)}s`, tint };
    });
}

/** "0x7a3f…91c2": enough of an address to recognise, not to copy. */
export const shortAddress = (address: string): string =>
  address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
