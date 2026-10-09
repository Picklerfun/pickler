import type {
  AgentActionDto,
  ActivityAgentDto,
  ActivityEventDto,
  AgentReadDto,
  AgentSummaryDto,
  DirectoryAgentDto,
  AgentProfileDto,
  PickDetailDto,
  AgentPersonaDto,
  PlatformAnalyticsDto,
  LeaderboardDto,
  ReadServiceDto,
  AgentCallDto,
} from "./agents.js";
import type { PickTrailStepDto } from "./landing.js";
import type { PerpMarketDto, MarketDetailDto } from "./markets.js";
import type { LaunchDetailDto, TradeDto } from "./launches.js";
import { z } from "zod";
import { ACCENTS } from "./landing.js";
import { VENUES } from "./agents.js";

const text = z.string();
const number = z.number();
const nullableNumber = number.nullable();
const nullableText = text.nullable();
const accent = z.enum(ACCENTS);
const venue = z.enum(VENUES);
const outcome = z.enum(["open", "won", "lost"]);
const stage = z.enum(["pre-graduation", "graduated"]);
export const activityAgentSchema = z.object({
  name: text,
  handle: text,
  ticker: nullableText,
  slug: nullableText,
  accent,
}) satisfies z.ZodType<ActivityAgentDto>;
export const activityEventSchema = z.object({
  id: text,
  agent: activityAgentSchema,
  kind: z.enum(["call", "position", "settlement", "pass", "answer", "perp"]),
  at: text,
  text,
  meta: text,
  amount: text,
  tone: z.enum(["win", "loss", "neutral"]),
}) satisfies z.ZodType<ActivityEventDto>;
export const readServiceSchema = z.object({
  open: z.boolean(),
  closedNote: nullableText,
  price: number,
  markets: z.array(z.object({ name: text, question: text })),
  typical: text,
  sla: text,
  slots: text,
  evaluated: number,
  gap: number,
}) satisfies z.ZodType<ReadServiceDto>;
export const agentReadSchema = z.object({
  id: text,
  agent: activityAgentSchema,
  beat: text,
  venue,
  market: text,
  question: text,
  paid: number,
  when: text,
  delivery: z.enum(["preparing", "delivered", "failed"]),
  evaluation: z.enum(["pending", "happened", "missed", "not_evaluable", "none"]),
  evaluatesIn: nullableText,
  isPublic: z.boolean(),
  answer: z
    .object({
      probability: number,
      summary: text,
      reasons: z.array(text),
      sources: z.array(z.object({ name: text, at: text })),
      limits: text,
      reference: text,
      issuedAt: text,
      evaluatesAt: text,
    })
    .nullable(),
  outcome: z.object({ final: text, observedAt: text }).nullable(),
}) satisfies z.ZodType<AgentReadDto>;
export const agentSummarySchema = z.object({
  slug: nullableText,
  name: text,
  handle: text,
  ticker: nullableText,
  beat: text,
  accent,
  venue,
  createdAt: text,
  resolved: number,
  hitRate: nullableNumber,
  net: number,
  token: z
    .object({
      stage,
      marketCap: number,
      raised: number,
      graduationTarget: number,
      volume24h: number,
      price: number,
      change24h: number,
      address: nullableText,
      chain: text,
    })
    .nullable(),
}) satisfies z.ZodType<AgentSummaryDto>;
export const directoryAgentSchema = z.object({
  agent: activityAgentSchema,
  beat: text,
  venue,
  decides: text,
  score: nullableNumber,
  hitRate: nullableNumber,
  resolved: number,
  net: number,
  service: readServiceSchema.nullable(),
}) satisfies z.ZodType<DirectoryAgentDto>;
export const agentCallSchema = z.object({
  id: text,
  call: text,
  outcome,
  stake: number,
  entryPrice: nullableNumber,
  calledAt: text,
  pnl: nullableNumber,
}) satisfies z.ZodType<AgentCallDto>;
const candle = z.object({ at: text, open: number, high: number, low: number, close: number });
export const agentProfileSchema = agentSummarySchema.extend({
  blurb: text,
  xHandle: nullableText,
  creatorHandle: nullableText,
  openPicks: number,
  market: z
    .object({
      price: number,
      change24h: number,
      holders: number,
      liquidity: nullableNumber,
      buybacks: number,
      candles: z.object({
        "5m": z.array(candle),
        "1h": z.array(candle),
        "4h": z.array(candle),
        "1d": z.array(candle),
      }),
      topHolders: z.array(z.object({ label: text, share: number })),
    })
    .nullable(),
  calls: z.array(agentCallSchema),
}) satisfies z.ZodType<AgentProfileDto>;
export const pickTrailSchema = z.object({
  title: text,
  at: nullableText,
  note: text,
  tone: z.enum(["signal", "agent", "caution", "win", "loss"]),
  figure: z.object({ text, tone: z.enum(["neutral", "caution", "win", "loss"]) }).nullable(),
}) satisfies z.ZodType<PickTrailStepDto>;
export const pickDetailSchema = agentCallSchema.extend({
  agent: z.object({
    slug: nullableText,
    name: text,
    ticker: nullableText,
    beat: text,
    accent,
    xHandle: nullableText,
  }),
  thesis: text,
  maxPrice: nullableNumber,
  settledAt: nullableText,
  post: z.object({ text, url: nullableText, views: nullableNumber }).nullable(),
  steps: z.array(pickTrailSchema),
  chain: z.object({
    positionTx: nullableText,
    settlementTx: nullableText,
    agentWallet: nullableText,
  }),
}) satisfies z.ZodType<PickDetailDto>;
export const agentPersonaSchema = z.object({
  name: text,
  handle: text,
  ticker: nullableText,
  slug: nullableText,
  accent,
  beat: text,
  venue,
  vibe: text,
  voice: text,
  blurb: text,
  xHandle: nullableText,
  creatorHandle: nullableText,
  calibrationGap: nullableNumber,
  resolved: number,
  hitRate: nullableNumber,
  net: number,
  openPicks: number,
  aliveDays: number,
  marketCap: nullableNumber,
  stage: stage.nullable(),
  meters: z.array(z.object({ label: text, value: number })),
  decides: text,
  wrong: text,
  askPrice: nullableText,
  answers: z.array(z.object({ question: text, answer: text, meta: text })),
  decisions: z.array(activityEventSchema),
  score: nullableNumber,
  service: readServiceSchema.nullable(),
  reads: z.array(agentReadSchema),
}) satisfies z.ZodType<AgentPersonaDto>;
export const platformAnalyticsSchema = z.object({
  range: z.enum(["7d", "30d", "90d"]),
  settledVolumeAllTime: number,
  groups: z.array(
    z.object({
      label: text,
      cards: z.array(
        z.object({
          label: text,
          value: text,
          note: text,
          tone: z.enum(["plain", "win", "caution", "open", "quiet"]),
        }),
      ),
    }),
  ),
  predictionsShare: number,
  splitNote: text,
  series: z.array(
    z.object({
      key: z.enum(["settled", "at-risk"]),
      label: text,
      total: text,
      note: text,
      from: text,
      to: text,
      points: z.array(z.object({ value: number, positive: z.boolean() })),
    }),
  ),
  log: z.array(activityEventSchema),
  table: z.array(
    z.object({
      agent: activityAgentSchema,
      beat: text,
      venue,
      form: z.array(z.enum(["won", "lost"]).nullable()),
      hitRate: nullableNumber,
      net: number,
      moving: number,
    }),
  ),
}) satisfies z.ZodType<PlatformAnalyticsDto>;
export const leaderboardSchema = z.object({
  entries: z.array(
    z.object({
      agent: activityAgentSchema,
      beat: text,
      venue,
      score: number,
      calibrationGap: number,
      resolved: number,
      net: number,
    }),
  ),
  weights: z.array(z.object({ label: text, weight: number, note: text })),
  calibration: z.array(
    z.object({
      agent: activityAgentSchema,
      points: z.array(z.object({ said: number, happened: number, sample: number })),
      gap: number,
      settled: number,
    }),
  ),
}) satisfies z.ZodType<LeaderboardDto>;
export const perpMarketDtoSchema = z.object({
  symbol: text,
  base: text,
  accent,
  mark: number,
  change24h: number,
  funding1h: number,
  openInterest: number,
  maxLeverage: number,
  agentsReading: nullableNumber,
  openCalls: nullableNumber,
  lastCall: z.object({ agent: text, when: text }).nullable(),
  note: text,
  hourlyReach: nullableNumber,
  limits: z.object({
    takerFee: number,
    maintenanceMargin: number,
    slippageCap: number,
    minimumAccountOpen: number,
  }),
  source: z.discriminatedUnion("venue", [
    z.object({ venue: z.literal("sample") }),
    z.object({
      venue: z.literal("perpl"),
      network: z.enum(["mainnet", "testnet"]),
      observedAt: text,
      stale: z.boolean(),
    }),
  ]),
}) satisfies z.ZodType<PerpMarketDto>;
export const marketDetailDtoSchema = z.object({
  market: perpMarketDtoSchema,
  readQuestion: text,
  calls: z.array(
    z.object({ level: number, horizon: z.enum(["1H", "4H", "12H", "24H"]), agents: number }),
  ),
  trail: z.array(number),
}) satisfies z.ZodType<MarketDetailDto>;
export const applicationRequestSchema = z.object({
  agentName: text,
  ticker: text,
  xHandle: text,
  category: text,
  personality: text,
  edge: text,
  whyYou: text,
});
export const applicantSchema = z.object({
  email: text,
  position: number,
  referralCode: text,
  referrals: number,
  placesGained: number,
  application: applicationRequestSchema.extend({ submittedAt: text }).nullable(),
});
const launchSummary = z.object({
  id: text,
  chainId: text,
  address: text,
  ticker: text,
  name: text,
  imageUri: nullableText,
  phase: z.enum(["reserved", "launching", "pre_graduation", "graduated", "failed"]),
  agentId: nullableText,
  quote: z.object({ chainId: text, address: text, symbol: nullableText, decimals: number }),
  totalSupply: nullableText,
  launchedAt: nullableText,
  graduatedAt: nullableText,
});
const curve = z.object({
  venue: z.enum(["pickler_curve", "pons", "uniswap_v4"]),
  address: nullableText,
  poolKey: nullableText,
  remainingTokens: nullableText,
  realQuoteReserve: nullableText,
  graduationTarget: nullableText,
  openedAt: text,
  closedAt: nullableText,
});
export const launchDetailSchema = launchSummary.extend({
  curve: curve.nullable(),
  pool: curve.nullable(),
}) satisfies z.ZodType<LaunchDetailDto>;
export const launchTradeSchema = z.object({
  side: z.enum(["buy", "sell"]),
  trader: text,
  tokenAmount: text,
  quoteAmount: text,
  feeAmount: text,
  blockNumber: text,
  txHash: text,
  logIndex: number,
  blockTime: text,
}) satisfies z.ZodType<TradeDto>;
export function freshnessReadSchema<T extends z.ZodType>(data: T) {
  return z.object({
    data,
    asOfBlock: nullableText,
    asOfBlockHash: nullableText,
    indexedAt: nullableText,
    finality: z.enum(["observed", "confirmed", "finalized", "unknown"]),
    stale: z.boolean(),
    nextCursor: text.optional(),
  });
}
export const launchesReadSchema = freshnessReadSchema(z.array(launchSummary));

export const agentActionSchema = z.object({
  id: text,
  at: text,
  agent: activityAgentSchema,
  outcome: z.enum(["entered", "exited", "held", "blocked", "proposed"]),
  outcomeText: nullableText,
  instrument: nullableText,
  call: z.enum(["open-long", "open-short", "close", "hold"]).nullable(),
  probability: nullableNumber,
  horizonHours: nullableNumber,
}) satisfies z.ZodType<AgentActionDto>;
