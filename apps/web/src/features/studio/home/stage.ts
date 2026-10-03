/**
 * `?stage=live|researching|decided`: the three moments of the "Pickler Studio v5" canvas's first
 * run, so the design harness can put each one on the home without a runner or a database, and
 * `?stage=empty`: the home of a person with no agents yet, drawn with no fixture at all.
 * `?stage=create-*`: the create screen at each moment studio-create-simplified-v1 §7 lists, and
 * `?stage=draft*`: the draft studio at each state studio-draft-dashboard-v1 §7 lists, and
 * `?stage=perpl-*`: the live studio of a published Perpl agent at each state studio-live-v1 §7 lists.
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

/**
 * The create screen at each moment of the "Pickler Studio Empty v5" canvas
 * (studio-create-simplified-v1 §7): no wallet, a wallet not funded, funded, the advanced settings
 * open, the web on with sites, the create sheet in each phase (idle, busy, ok, cancelled), the
 * wallet sheet at each of its two steps, the Wallets modal with a transfer open, the AI credits
 * modal and the avatar picker.
 */
export const CREATE_STAGES = [
  "create-empty",
  "create-wallet",
  "create-funded",
  "create-advanced",
  "create-web",
  "create-sheet",
  "create-sheet-busy",
  "create-sheet-ok",
  "create-sheet-cancelled",
  "create-wallet-sheet",
  "create-wallet-sheet-step2",
  "create-wallets",
  "create-credits",
  "create-avatar",
] as const;

export type CreateStage = (typeof CREATE_STAGES)[number];

/**
 * The draft studio (studio-draft-dashboard-v1 §7): the Overview right after create, Connect X at
 * each moment (the row open, the post not found yet, verified, skipped), then each section, and a
 * locked one. `draft/fixture.ts` draws each.
 */
export const DRAFT_STAGES = [
  "draft",
  "draft-x-open",
  "draft-x-miss",
  "draft-x-ok",
  "draft-x-skipped",
  "draft-console",
  "draft-trades",
  "draft-brief",
  "draft-sources",
  "draft-limits",
  "draft-identity",
  "draft-trade",
  "draft-master",
  "draft-locked",
] as const;

export type DraftStage = (typeof DRAFT_STAGES)[number];

/**
 * The live studio of a published Perpl agent (studio-live-v1 §7): the Overview, paused, with the
 * degraded banner, then each section, the brief with edits not applied, and the account's three
 * tabs. `live/fixture.ts` draws each.
 */
export const LIVE_STAGES = [
  "perpl-live",
  "perpl-paused",
  "perpl-warnings",
  "perpl-positions",
  "perpl-record",
  "perpl-decisions",
  "perpl-console",
  "perpl-posts",
  "perpl-brief",
  "perpl-brief-dirty",
  "perpl-sources",
  "perpl-limits",
  "perpl-controls",
  "perpl-identity",
  "perpl-agents",
  "perpl-markets",
  "perpl-leaders",
  "perpl-wallets",
  "perpl-account",
  "perpl-account-profile",
  "perpl-account-notify",
] as const;

export type LiveStage = (typeof LIVE_STAGES)[number];

/** A run stage, a create stage, a draft or live studio stage, or the empty home. */
export type StudioStage = HomeStage | CreateStage | DraftStage | LiveStage | "empty";

export const isHomeStage = (stage: StudioStage | undefined): stage is HomeStage =>
  (STAGES as readonly string[]).includes(stage ?? "");

export const isCreateStage = (stage: StudioStage | undefined): stage is CreateStage =>
  (CREATE_STAGES as readonly string[]).includes(stage ?? "");

export const isDraftStage = (stage: StudioStage | undefined): stage is DraftStage =>
  (DRAFT_STAGES as readonly string[]).includes(stage ?? "");

export const isLiveStage = (stage: StudioStage | undefined): stage is LiveStage =>
  (LIVE_STAGES as readonly string[]).includes(stage ?? "");

export function stageFromSearch(
  nodeEnv: string | undefined,
  asked: string | string[] | undefined,
): StudioStage | undefined {
  if (nodeEnv === "production") {
    return undefined;
  }
  const value = Array.isArray(asked) ? asked[0] : asked;
  if (value === "empty") {
    return value;
  }
  const live = LIVE_STAGES.find((stage) => stage === value);
  if (live) {
    return live;
  }
  const draft = DRAFT_STAGES.find((stage) => stage === value);
  if (draft) {
    return draft;
  }
  const create = CREATE_STAGES.find((stage) => stage === value);
  if (create) {
    return create;
  }
  return STAGES.find((stage): stage is HomeStage => stage === value);
}
