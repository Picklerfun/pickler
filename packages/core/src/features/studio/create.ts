/**
 * Creating an agent on one screen (docs/specs/studio-create-simplified-v1.md): the voices, the
 * avatar patterns, the starter caps, the minimums a wallet must hold, the brief a new agent starts
 * with, and the one path from what the screen sent to the draft's config and profile.
 */
import { ACCENTS, type Accent } from "../landing/domain/landing.js";
import { PERP_TOOLS } from "../perps/types.js";
import {
  DEFAULT_CONFIG,
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

export type VoiceKey = (typeof VOICE_KEYS)[number];

/** The canvas's six voices and the first post each would write. */
export const VOICES: readonly { key: VoiceKey; name: string; sample: string }[] = [
  {
    key: "analyst",
    name: "Analyst",
    sample: "Long BTC at 3×, 25 AUSD. Headline first, price second. Out by the close.",
  },
  {
    key: "contrarian",
    name: "Contrarian",
    sample: "Everyone is long and paying for it. That is the whole reason I am short.",
  },
  {
    key: "trash_talker",
    name: "Trash talker",
    sample: "You saw the headline a minute after me. I was already filled.",
  },
  { key: "deadpan", name: "Deadpan", sample: "Long BTC. 25 AUSD. 3×. That is the post." },
  { key: "hype", name: "Hype", sample: "WE ARE LONG. Full clip. Let it run." },
  {
    key: "professor",
    name: "Professor",
    sample: "Funding at 0.09% with OI up 22% is a crowded trade by any definition. Fading it.",
  },
];

/** The avatar picker's six 4×4 patterns, row by row; "1" is a filled cell. */
export const AVATAR_PATTERNS = [
  "1001011001101001",
  "1111100110011111",
  "0110100110010110",
  "1010010110100101",
  "1100110000110011",
  "0000011001100000",
] as const;

/** Small on purpose for a first agent (D10). */
export const STARTER_CAPS = { perTradeAusd: 5, perDayAusd: 20, maxLeverage: 1 } as const;

/** What the agent's wallet must hold before it can be created (D4): 10 AUSD and 0.5 MON. */
export const MIN_START_MICRO_AUSD = 10_000_000n;
export const MIN_START_MON_WEI = 500_000_000_000_000_000n;

/** The working brief a new agent starts with: the canvas's Wire. */
export const DEFAULT_BRIEF = {
  thesis:
    "Headlines move BTC and ETH before the order book does. The edge is the 30 to 90 seconds between a credible headline and the first big print.",
  entersWhen: [
    "Two of my sources carry the same headline within 60s",
    "Price has moved less than 0.3% since the headline",
    "Funding is not already leaning my way by more than 0.05%",
  ],
  exitsWhen: [
    "+2% take profit or −1% stop, whichever comes first",
    "Four hours after entry, no matter what",
    "A second headline contradicts the first",
  ],
  never: [
    "Trade a headline from a single source",
    "Hold through a funding print",
    "Add to a losing position",
  ],
} as const;

export interface CreateDraftInput {
  name: string;
  handle: string;
  voice: VoiceKey;
  avatar: { accent: Accent; pattern: number };
  sources: { web: { mode: WebMode; sites: string[] } | null };
  brief: {
    thesis: string;
    entersWhen: readonly string[];
    exitsWhen: readonly string[];
    never: readonly string[];
  };
  caps: { perTradeAusd: number; perDayAusd: number; maxLeverage: number };
  walletId: string;
}

/** What the draft's profile row gets: the avatar and the voice's name. */
export interface DraftProfile {
  accent: Accent;
  avatarPattern: number;
  voice: string;
}

/**
 * Normalize, check, and build. Brief problems are `BriefError` (400 naming the section); caps,
 * voice, avatar and sources are `PilotError("INVALID_INPUT")`.
 */
export function prepareDraft(input: CreateDraftInput): {
  config: AgentConfig;
  profile: DraftProfile;
} {
  const voice = VOICES.find((candidate) => candidate.key === input.voice);
  if (!voice) {
    throw new PilotError("INVALID_INPUT", "Unknown voice");
  }
  if (!(ACCENTS as readonly string[]).includes(input.avatar.accent)) {
    throw new PilotError("INVALID_INPUT", "Unknown accent");
  }
  if (
    !Number.isInteger(input.avatar.pattern) ||
    input.avatar.pattern < 0 ||
    input.avatar.pattern >= AVATAR_PATTERNS.length
  ) {
    throw new PilotError("INVALID_INPUT", "Unknown avatar pattern");
  }
  const brief = normalizeBrief({
    thesis: input.brief.thesis,
    reads: [],
    entersWhen: [...input.brief.entersWhen],
    exitsWhen: [...input.brief.exitsWhen],
    never: [...input.brief.never],
  });
  assertBrief(brief);
  const spend = { perCallAusd: input.caps.perTradeAusd, perDayAusd: input.caps.perDayAusd };
  assertSpendLimits(spend);
  assertMaxLeverage(input.caps.maxLeverage);
  const web = input.sources.web;
  const config: AgentConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    tools: [...PERP_TOOLS, ...(web ? (["searchWeb", "readPage"] as const) : [])],
    perpl: { version: 1, network: "testnet", markets: ["BTC", "ETH"] },
    perpsPaper: { version: 1, policy: "conservative-1x-v1" },
    plugins: { version: 1, enabled: ["perpl", "perps-paper", ...(web ? (["exa"] as const) : [])] },
    sources: { web: web ? { mode: web.mode, sites: [...web.sites] } : null, books: [] },
    skills: [],
    brief,
    spend,
    maxLeverage: input.caps.maxLeverage,
    voice: input.voice,
  };
  assertConfig(config);
  return {
    config,
    profile: {
      accent: input.avatar.accent,
      avatarPattern: input.avatar.pattern,
      voice: voice.name,
    },
  };
}

/** Balances as base-unit strings, and the minimums, for 409 WALLET_UNDERFUNDED's detail. */
export interface FundingShortfall {
  ausdMicro: string | null;
  monWei: string | null;
  minAusdMicro: string;
  minMonWei: string;
}

/** Null when both minimums are met. An unread balance (null) is never enough. */
export function fundingShortfall(balances: {
  ausdMicro: bigint | null;
  monWei: bigint | null;
}): FundingShortfall | null {
  const enough =
    balances.ausdMicro !== null &&
    balances.monWei !== null &&
    balances.ausdMicro >= MIN_START_MICRO_AUSD &&
    balances.monWei >= MIN_START_MON_WEI;
  if (enough) {
    return null;
  }
  return {
    ausdMicro: balances.ausdMicro === null ? null : balances.ausdMicro.toString(),
    monWei: balances.monWei === null ? null : balances.monWei.toString(),
    minAusdMicro: MIN_START_MICRO_AUSD.toString(),
    minMonWei: MIN_START_MON_WEI.toString(),
  };
}

/** 409: the agent's wallet does not hold the minimums to start. */
export class WalletUnderfundedError extends PilotError {
  constructor(public readonly detail: FundingShortfall) {
    super("WALLET_UNDERFUNDED", "Fund its wallet with at least 10 AUSD and 0.5 MON first");
  }
}
