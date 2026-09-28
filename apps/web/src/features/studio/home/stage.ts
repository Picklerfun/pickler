/**
 * `?stage=live|researching|decided`: the three moments of the "Pickler Studio v5" canvas's first
 * run, so the design harness can put each one on the home without a runner or a database.
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

export function stageFromSearch(
  nodeEnv: string | undefined,
  asked: string | string[] | undefined,
): HomeStage | undefined {
  if (nodeEnv === "production") {
    return undefined;
  }
  const value = Array.isArray(asked) ? asked[0] : asked;
  return STAGES.find((stage): stage is HomeStage => stage === value);
}
