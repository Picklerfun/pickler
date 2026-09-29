/**
 * `?stage=live|researching|decided`: the three moments of the "Pickler Studio v5" canvas's first
 * run, so the design harness can put each one on the home without a runner or a database, and
 * `?stage=empty`: the home of a person with no agents yet, drawn with no fixture at all.
 * `?stage=brief-running|brief-done|brief-stale`: the brief home with its paper run in each state,
 * and `?stage=draft`: the draft's home right after create.
 *
 * Outside production only, and pure, like `sectionFromSearch`: `nodeEnv` is an argument so the
 * guard can be pinned in both positions. It is gated on the build alone, the way the creation
 * flow's `?step=` sample is, rather than on `previewAllowed`, because that also needs Supabase to be
 * unconfigured — and the local server these checks run against has it configured. The home says
 * it is a preview on its face, and nothing on it can write while it is one.
 *
 * Deliberately not in a client module, so `/studio`'s server page can read it as a value.
 */
export const STAGES = ["live", "researching", "decided"] as const;

export type HomeStage = (typeof STAGES)[number];

/** The brief home with its paper run live, done, and stale after an edit (studio-brief-v1 §10). */
export const BRIEF_STAGES = ["brief-running", "brief-done", "brief-stale"] as const;

export type BriefStage = (typeof BRIEF_STAGES)[number];

/** A run stage, a brief stage, the draft home after create, or the empty home. */
export type StudioStage = HomeStage | BriefStage | "draft" | "empty";

export const isHomeStage = (stage: StudioStage | undefined): stage is HomeStage =>
  (STAGES as readonly string[]).includes(stage ?? "");

export const isBriefStage = (stage: StudioStage | undefined): stage is BriefStage =>
  (BRIEF_STAGES as readonly string[]).includes(stage ?? "");

export function stageFromSearch(
  nodeEnv: string | undefined,
  asked: string | string[] | undefined,
): StudioStage | undefined {
  if (nodeEnv === "production") {
    return undefined;
  }
  const value = Array.isArray(asked) ? asked[0] : asked;
  if (value === "empty" || value === "draft") {
    return value;
  }
  const brief = BRIEF_STAGES.find((stage) => stage === value);
  if (brief) {
    return brief;
  }
  return STAGES.find((stage): stage is HomeStage => stage === value);
}
