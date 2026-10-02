/**
 * Editing a draft agent's config from its studio (docs/specs/studio-draft-dashboard-v1.md, D10):
 * the same rules `prepareDraft` applies at creation, applied to a config that already exists.
 */
import {
  PilotError,
  VOICE_KEYS,
  assertBrief,
  assertConfig,
  assertMaxLeverage,
  assertSpendLimits,
  normalizeBrief,
  type AgentConfig,
  type WebMode,
} from "../research/types.js";
import { copyWeb, webDerived, type VoiceKey } from "./create.js";

/** What a draft's setup screens can change; an absent field is left as it is. */
export interface DraftPatch {
  brief?: {
    thesis: string;
    entersWhen: readonly string[];
    exitsWhen: readonly string[];
    never: readonly string[];
  };
  sources?: { web: { mode: WebMode; sites: readonly string[] } | null };
  caps?: { perTradeAusd: number; perDayAusd: number; maxLeverage: number };
  voice?: VoiceKey;
}

/**
 * The config with the patch applied, normalized and checked like create's. Brief problems are
 * `BriefError`; caps, voice and sources are `PilotError("INVALID_INPUT")`. It touches only the
 * patched fields (so never `marketScope`) and the tools and plugins the web source decides.
 */
export function reviseDraft(config: AgentConfig, patch: DraftPatch): AgentConfig {
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
