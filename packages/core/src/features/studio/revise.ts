/**
 * Editing a Perpl agent's config from its studio, draft or public
 * (docs/specs/studio-draft-dashboard-v1.md D10, docs/specs/studio-live-v1.md L11–L13): the same
 * rules `prepareDraft` applies at creation, applied to a config that already exists.
 */
import {
  PilotError,
  VOICE_KEYS,
  assertBrief,
  assertConfig,
  assertEntrySetting,
  assertMaxLeverage,
  assertRiskLimits,
  assertSpendLimits,
  effectiveRisk,
  normalizeBrief,
  type AgentConfig,
  type EntrySetting,
  type WebMode,
} from "../research/types.js";
import { copyWeb, webDerived, type VoiceKey } from "./create.js";

/** What the setup screens can change; an absent field is left as it is. */
export interface SetupPatch {
  brief?: {
    thesis: string;
    entersWhen: readonly string[];
    exitsWhen: readonly string[];
    never: readonly string[];
  };
  sources?: { web: { mode: WebMode; sites: readonly string[] } | null };
  /**
   * The three caps every save states, and the two risk limits (L12). A risk limit left out stays
   * as it is, so the draft studio, which draws three caps, never writes `risk`.
   */
  caps?: {
    perTradeAusd: number;
    perDayAusd: number;
    maxLeverage: number;
    maxOpenPositions?: number | undefined;
    dayLossStopAusd?: number | undefined;
  };
  voice?: VoiceKey;
  /** How it enters (L13), stored as sent: `auto` keeps its `meanwhile` and `smallAusd`. */
  entry?: EntrySetting;
}

/**
 * The config with the patch applied, normalized and checked like create's. Brief problems are
 * `BriefError`; caps, risk, entry, voice and sources are `PilotError("INVALID_INPUT")`. It touches
 * only the patched fields (so never `marketScope`) and the tools and plugins the web source
 * decides.
 *
 * It serves any Perpl agent's setup, draft or public. A sources patch replaces `tools` and
 * `plugins` with a Perpl agent's (`webDerived`), so it must never be called for a config without
 * `perpl`: the caller refuses those first.
 */
export function reviseSetup(config: AgentConfig, patch: SetupPatch): AgentConfig {
  const next = structuredClone(config);
  if (patch.brief) {
    const brief = normalizeBrief({
      thesis: patch.brief.thesis,
      reads: [],
      entersWhen: [...patch.brief.entersWhen],
      exitsWhen: [...patch.brief.exitsWhen],
      never: [...patch.brief.never],
    });
    assertBrief(brief);
    next.brief = brief;
  }
  if (patch.caps) {
    const spend = { perCallAusd: patch.caps.perTradeAusd, perDayAusd: patch.caps.perDayAusd };
    assertSpendLimits(spend);
    assertMaxLeverage(patch.caps.maxLeverage);
    next.spend = spend;
    next.maxLeverage = patch.caps.maxLeverage;
    const { maxOpenPositions, dayLossStopAusd } = patch.caps;
    if (maxOpenPositions !== undefined || dayLossStopAusd !== undefined) {
      const risk = effectiveRisk(next);
      const revised = {
        maxOpenPositions: maxOpenPositions ?? risk.maxOpenPositions,
        dayLossStopAusd: dayLossStopAusd ?? risk.dayLossStopAusd,
      };
      assertRiskLimits(revised);
      next.risk = revised;
    }
  }
  if (patch.entry) {
    // Judged against the per-trade cap as this same patch leaves it.
    assertEntrySetting(patch.entry, next.spend?.perCallAusd);
    next.entry = {
      mode: patch.entry.mode,
      meanwhile: patch.entry.meanwhile,
      smallAusd: patch.entry.smallAusd,
    };
  }
  if (patch.sources) {
    const { tools, plugins } = webDerived(patch.sources.web);
    next.tools = tools;
    next.plugins = plugins;
    next.sources = { web: copyWeb(patch.sources.web), books: next.sources?.books ?? [] };
  }
  if (patch.voice !== undefined) {
    if (!(VOICE_KEYS as readonly string[]).includes(patch.voice)) {
      throw new PilotError("INVALID_INPUT", "Unknown voice");
    }
    next.voice = patch.voice;
  }
  assertConfig(next);
  return next;
}
