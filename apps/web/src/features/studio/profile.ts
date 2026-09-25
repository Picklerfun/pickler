import type { agentProfileInputSchema } from "@pickler/api-schema";

/**
 * The public profile the API writes with the agent. Every field travels; the API fills none in.
 *
 * Its own module, with no transport in it, because `create/draft.ts` is the rules of the creation
 * flow and is tested in Node without a browser: `api.ts` re-exports both for the client code.
 */
export type Profile = ReturnType<typeof agentProfileInputSchema.parse>;

/** What a profile is before anyone has answered. */
export const DEFAULT_PROFILE: Profile = {
  accent: "lime",
  blurb: "",
  venue: "predictions",
  vibe: "",
  voice: "",
  decides: "",
  wrong: "",
  xHandle: null,
};
