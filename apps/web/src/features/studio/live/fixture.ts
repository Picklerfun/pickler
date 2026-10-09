/**
 * The live studio at each `?stage=perpl-*` (`home/stage.ts`, studio-live-v1 §7), as the "Pickler
 * Studio v5 Live" canvas draws it: Halftime, published yesterday, an analyst on BTC and ETH with
 * its own wallet, the caps 25 / 100 / 3× / 3 open / −20, approving every entry. Outside production
 * only; nothing here is anyone's agent, and nothing is sent.
 *
 * Every shape is the API's (`Agent`, `GET /wallets`, `/x`, `/wallets/ledger`, `/versions`, the
 * marketplace's markets, market detail, directory and leaderboard, `GET /v1/signing/passkeys`), so
 * the staged studio goes through the same screens a real one does. Most stages read Perpl's board
 * (testnet); `perpl-markets` reads the labelled sample board, so both of L8's tags are drawn. The
 * clock is fixed, not `Date.now()`: the server renders this first, and a stamp that differs between
 * the server and the browser would rehydrate into a different screen.
 */
import type {
  DirectoryAgentDto,
  LeaderboardDto,
  MarketDetailDto,
  MarketSourceDto,
  PerpMarketDto,
} from "@pickler/api-schema";
import type { PasskeyDto } from "../../auth/lib/custody-api";
import type {
  Agent,
  LedgerEntry,
  PerpsCheckDetailDto,
  PerpsCheckSummaryDto,
  PerpsPositionsResponseDto,
  PerpsProposalDto,
  PerpsRecordDto,
  SetupVersion,
  StudioWallets,
  XState,
} from "../api";
import type { LiveStage } from "../home/stage";
import { previewConfig } from "../preview";
import type { BriefText } from "../shell/build-model";
import type { AccountTab, LiveSectionKey } from "./model";
import type { OwnerAction } from "./use-live";

/** The live studio filled in for the design harness, at one moment. */
export interface LiveStaged {
  /** The fixed clock every time on the screen is read against. */
  now: number;
  agent: Agent;
  section: LiveSectionKey;
  wallets: StudioWallets;
  x: XState;
  ledger: LedgerEntry[];
  versions: SetupVersion[];
  /** `GET /marketplace/markets`. */
  markets: PerpMarketDto[];
  /** `GET /marketplace/markets/:symbol` for each market it watches, keyed by the board's symbol. */
  details: Record<string, MarketDetailDto>;
  directory: DirectoryAgentDto[];
  leaderboard: LeaderboardDto;
  /** The account's passkeys, for Account · Security. */
  passkeys: PasskeyDto[];
  /** The signed-in account's handle. */
  accountHandle: string;
  /** Which of Account's tabs is open. */
  accountTab: AccountTab;
  /** The brief's textareas with edits not applied (`perpl-brief-dirty`), or null. */
  briefDraft: BriefText | null;
  /** The Perpl paper runtime's reads: off on every stage but the four `-active` ones. */
  runtime: LiveRuntimeStaged;
}

/** What the paper runtime's routes answer, staged (perpl-paper-runtime-v1 §4). */
export interface LiveRuntimeStaged {
  record: PerpsRecordDto;
  checks: PerpsCheckSummaryDto[];
  positions: PerpsPositionsResponseDto;
  proposals: PerpsProposalDto[];
  /** `GET /perps/checks/:id` for the checks the screen opens, by id. */
  details: Record<string, PerpsCheckDetailDto>;
  /** The owner's actions already sent, as `GET /perps/actions/:id` last answered them. */
  actions: OwnerAction[];
}

const NOW = Date.UTC(2026, 9, 2, 14, 30, 0);
const MINUTE = 60_000;
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * MINUTE).toISOString();
/** Published yesterday at 09:40 UTC: "PUBLIC SINCE OCT 1 · DAY 2". */
const PUBLISHED_AT = new Date(Date.UTC(2026, 9, 1, 9, 40, 0)).toISOString();

const AGENT_ID = "preview-live";
const WALLET_ID = "wal-preview-live";
const ADDRESS = "0x91bE6f20A3c7D45e81B0F9a2C6d13E7b58Fd4a07";
const MASTER = "0x7f3a9C41e02bB7d5F8a16E3c90D4b27A51f0c21e";
const X_HANDLE = "HalftimeBot";

/** Which section each stage opens on. */
const SECTIONS: Record<LiveStage, LiveSectionKey> = {
  "perpl-live": "overview",
  "perpl-paused": "overview",
  "perpl-warnings": "overview",
  "perpl-positions": "positions",
  "perpl-record": "record",
  "perpl-decisions": "decisions",
  "perpl-console": "console",
  "perpl-posts": "posts",
  "perpl-brief": "brief",
  "perpl-brief-dirty": "brief",
  "perpl-sources": "skills",
  "perpl-limits": "limits",
  "perpl-controls": "controls",
  "perpl-identity": "identity",
  "perpl-agents": "agents",
  "perpl-markets": "markets",
  "perpl-leaders": "leaders",
  "perpl-wallets": "master",
  "perpl-account": "account",
  "perpl-account-profile": "account",
  "perpl-account-notify": "account",
  "perpl-live-active": "overview",
  "perpl-decisions-active": "decisions",
  "perpl-record-active": "record",
  "perpl-positions-active": "positions",
  "perpl-positions-paused": "positions",
};

const brief = {
  thesis:
    "Headlines move BTC and ETH before the order book does. The edge is the 30 to 90 seconds between a credible headline and the first big print.",
  reads: [],
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
};

/** The config `reviseSetup` leaves after the owner set the caps and the entry. */
const config: Agent["config"] = {
  limits: previewConfig.limits,
  profile: "Paper trades BTC and ETH perpetuals on Perpl.",
  categoryIds: [],
  perpl: { version: 1, network: "testnet", markets: ["BTC", "ETH"] },
  perpsPaper: { version: 1, policy: "conservative-1x-v1" },
  tools: [
    "listPerpMarkets",
    "getPerpSnapshot",
    "getPerpOrderBook",
    "getPerpCandles",
    "getPerpFundingHistory",
    "searchWeb",
    "readPage",
  ],
  plugins: { version: 1, enabled: ["perpl", "perps-paper", "exa"] },
  intervalHours: 6,
  ...(previewConfig.uncertaintyPolicy
    ? { uncertaintyPolicy: previewConfig.uncertaintyPolicy }
    : {}),
  sources: { web: { mode: "prefer", sites: ["coindesk.com", "theblock.co"] }, books: [] },
  skills: [],
  brief,
  spend: { perCallAusd: 25, perDayAusd: 100 },
  maxLeverage: 3,
  voice: "analyst",
  risk: { maxOpenPositions: 3, dayLossStopAusd: 20 },
  entry: { mode: "approve", meanwhile: "wait", smallAusd: 10 },
};

function agent(paused: boolean, balanceAusd: number): Agent {
  return {
    id: AGENT_ID,
    productId: AGENT_ID,
    tenantId: "preview",
    name: "Halftime",
    handle: "halftime",
    accent: "lime",
    avatarPattern: 0,
    draft: false,
    version: 4,
    config,
    paused,
    scheduleEnabled: false,
    nextDueAt: null,
    wallet: { walletId: WALLET_ID, address: ADDRESS, balanceAusd },
    canSchedule: { ok: false, reason: "first_run" },
    canCreateAnother: { ok: true, reason: null },
    spend: { perCallAusd: 25, perDayAusd: 100 },
    spendEnforced: true,
    visibility: "public",
    publishedAt: PUBLISHED_AT,
    xHandle: X_HANDLE,
  };
}

/* `GET /wallets`. The warnings stage has 0.12 MON (under 0.2) and 18 AUSD (under one 25 trade). */
function wallets(ausdMicro: string, monWei: string): StudioWallets {
  return {
    chainId: 10143,
    master: { address: MASTER, ausdMicro: "177600000", monWei: "3700000000000000000" },
    agents: [
      {
        walletId: WALLET_ID,
        address: ADDRESS,
        ausdMicro,
        monWei,
        agentId: AGENT_ID,
        agentName: "Halftime",
        caps: { perTradeAusd: 25, perDayAusd: 100, maxLeverage: 3 },
        policiesApproved: true,
      },
    ],
    readAt: NOW - MINUTE,
  };
}

/* `GET /wallets/ledger`, newest first. */
const ledger: LedgerEntry[] = [
  {
    direction: "to_agent",
    token: "MON",
    amount: "0.5",
    agentName: "Halftime",
    txHash: "0x5e1c0f7a9b3d2e4c6a8b0d1f3e5a7c9b2d4f6e8a0c1b3d5f7a9c2e4b6d8f0a1c",
    at: at(1730),
  },
  {
    direction: "to_agent",
    token: "AUSD",
    amount: "75.8",
    agentName: "Halftime",
    txHash: "0x2b4d6f8a0c1e3a5c7e9b1d3f5a7c9e0b2d4f6a8c1e3b5d7f9a0c2e4b6d8f1a3c",
    at: at(1732),
  },
];

/* `GET /agents/:id/versions`, newest first. Version 1 is from before the table, so it has no row. */
const versions: SetupVersion[] = [
  { version: 4, summary: "Caps · 25 / 100 / 3× · 3 open · day-loss 20", at: at(118) },
  { version: 3, summary: "Exit 2 · 4h time stop instead of 6h", at: at(1450) },
  { version: 2, summary: "Entry 3 · funding threshold 0.05%", at: at(1690) },
];

const perplSource: MarketSourceDto = {
  venue: "perpl",
  network: "testnet",
  observedAt: new Date(NOW - 20_000).toISOString(),
  stale: false,
};
const sampleSource: MarketSourceDto = { venue: "sample" };

const LIMITS = {
  takerFee: 0.00035,
  maintenanceMargin: 0.025,
  slippageCap: 0.01,
  minimumAccountOpen: 10,
};

/** The canvas's six markets (`MKT_MARKETS`), in the DTO's words. */
const BOARD: readonly Omit<PerpMarketDto, "source">[] = [
  {
    symbol: "BTC-PERP",
    base: "BTC",
    accent: "amber",
    mark: 97420,
    change24h: 0.018,
    funding1h: 0.0000875,
    openInterest: 4_100_000,
    maxLeverage: 10,
    agentsReading: 7,
    openCalls: 3,
    lastCall: null,
    note: "Deepest book. Levels every 250.",
    hourlyReach: 1.2,
    limits: LIMITS,
  },
  {
    symbol: "ETH-PERP",
    base: "ETH",
    accent: "blue",
    mark: 3610,
    change24h: -0.009,
    funding1h: 0.000025,
    openInterest: 2_300_000,
    maxLeverage: 10,
    agentsReading: 5,
    openCalls: 2,
    lastCall: null,
    note: "Tracks BTC most days, not today.",
    hourlyReach: 1.6,
    limits: LIMITS,
  },
  {
    symbol: "SOL-PERP",
    base: "SOL",
    accent: "violet",
    mark: 212.4,
    change24h: -0.024,
    funding1h: -0.00001,
    openInterest: 820_000,
    maxLeverage: 5,
    agentsReading: 4,
    openCalls: null,
    lastCall: null,
    note: "Wider spread after the unlock.",
    hourlyReach: 2.4,
    limits: LIMITS,
  },
  {
    symbol: "MON-PERP",
    base: "MON",
    accent: "lime",
    mark: 1.84,
    change24h: 0.051,
    funding1h: 0.00012,
    openInterest: 310_000,
    maxLeverage: 5,
    agentsReading: 3,
    openCalls: null,
    lastCall: null,
    note: "Thin book. Size down.",
    hourlyReach: 3.1,
    limits: LIMITS,
  },
  {
    symbol: "HYPE-PERP",
    base: "HYPE",
    accent: "cyan",
    mark: 24.6,
    change24h: 0.004,
    funding1h: 0.00006,
    openInterest: 260_000,
    maxLeverage: 5,
    agentsReading: null,
    openCalls: null,
    lastCall: null,
    note: "Funding runs hot on weekends.",
    hourlyReach: null,
    limits: LIMITS,
  },
  {
    symbol: "ZEC-PERP",
    base: "ZEC",
    accent: "orange",
    mark: 41.2,
    change24h: -0.011,
    funding1h: 0.00002,
    openInterest: 90_000,
    maxLeverage: 3,
    agentsReading: 1,
    openCalls: null,
    lastCall: null,
    note: "New on Perpl. One agent watches it.",
    hourlyReach: null,
    limits: LIMITS,
  },
];

const board = (source: MarketSourceDto): PerpMarketDto[] =>
  BOARD.map((market) => ({ ...market, source }));

/** 25 hourly marks ending at the mark, from 24 h ago (when it was `mark / (1 + change)`). */
function trail(market: Pick<PerpMarketDto, "mark" | "change24h">): number[] {
  const start = market.mark / (1 + market.change24h);
  return Array.from({ length: 25 }, (_, index) => {
    const t = index / 24;
    const wobble = Math.sin(index * 1.7) * 0.003 * (1 - t);
    return Number((start + (market.mark - start) * t + start * wobble).toFixed(2));
  });
}

/** Synthetic times for the labelled inert fixture only, never a live fallback. */
function fixtureTrailTimes(market: PerpMarketDto): string[] | undefined {
  if (market.source.venue !== "perpl") {
    return undefined;
  }
  const end = Date.parse(market.source.observedAt);
  const closedHour = Math.floor(end / 3_600_000) * 3_600_000;
  return [
    ...Array.from({ length: 24 }, (_, index) =>
      new Date(closedHour - (23 - index) * 3_600_000).toISOString(),
    ),
    new Date(end).toISOString(),
  ];
}

/** Thirty days of synthetic hourly prices, confined to the labelled local design fixture. */
function fixturePriceHistory(market: PerpMarketDto): MarketDetailDto["priceHistory"] {
  const times = fixtureTrailTimes(market);
  if (!times) {
    return undefined;
  }
  const prices = trail(market);
  const start = prices[0]!;
  const first = Date.parse(times[0]!);
  const older = Array.from({ length: 696 }, (_, index) => {
    const progress = index / 696;
    return {
      price: Number(
        (start * (1 - 0.12 * (1 - progress) + 0.045 * Math.sin(progress * 7))).toFixed(2),
      ),
      at: new Date(first - (696 - index) * 3_600_000).toISOString(),
    };
  });
  return [...older, ...times.map((at, index) => ({ price: prices[index]!, at }))];
}

function details(markets: readonly PerpMarketDto[]): Record<string, MarketDetailDto> {
  return Object.fromEntries(
    markets
      .filter((market) => market.base === "BTC" || market.base === "ETH")
      .map((market) => [
        market.symbol,
        {
          market,
          readQuestion: `Is ${market.symbol} above {level} 24 hours after delivery?`,
          calls: [],
          trail: trail(market),
          trailTimestamps: fixtureTrailTimes(market),
          priceHistory: fixturePriceHistory(market),
        },
      ]),
  );
}

const directoryAgent = (
  name: string,
  handle: string,
  ticker: string | null,
  accent: DirectoryAgentDto["agent"]["accent"],
) => ({ name, handle, ticker, slug: ticker ? ticker.slice(1).toLowerCase() : null, accent });

/* `GET /marketplace/directory`: the canvas's six agents (`MKT_AGENTS`). Paid reads are not built,
   so no agent carries a service. */
const directory: DirectoryAgentDto[] = [
  {
    agent: directoryAgent("Wire", "wire", "$WIRE", "cyan"),
    beat: "news",
    venue: "perps",
    decides: "Reacts to news on BTC and ETH. The 30 to 90 seconds before the first big print.",
    score: 84,
    hitRate: 0.61,
    resolved: 48,
    net: 212,
    service: null,
  },
  {
    agent: directoryAgent("Drift", "drift", "$DRFT", "blue"),
    beat: "trend",
    venue: "perps",
    decides: "Follows the trend on ETH and SOL. Enters after confirmation, leaves on the fade.",
    score: 71,
    hitRate: 0.54,
    resolved: 63,
    net: 140,
    service: null,
  },
  {
    agent: directoryAgent("Counter", "counter", "$CNTR", "orange"),
    beat: "funding",
    venue: "perps",
    decides: "Fades the crowd on MON and HYPE when funding goes extreme. Small and often.",
    score: 66,
    hitRate: 0.58,
    resolved: 71,
    net: 96,
    service: null,
  },
  {
    agent: directoryAgent("Unlock Watch", "unlockwatch", "$UNLK", "violet"),
    beat: "unlocks",
    venue: "perps",
    decides: "Token unlock calendars, and what the float does after.",
    score: 58,
    hitRate: 0.57,
    resolved: 29,
    net: 42,
    service: null,
  },
  {
    agent: directoryAgent("Halftime", "halftime", null, "lime"),
    beat: "news",
    venue: "perps",
    decides: "Headlines move BTC and ETH before the book does. Never trades a single source.",
    score: null,
    hitRate: null,
    resolved: 0,
    net: 0,
    service: null,
  },
  {
    agent: directoryAgent("Print Day", "printday", "$PRNT", "amber"),
    beat: "macro",
    venue: "perps",
    decides: "CPI and payrolls. It does not model news, only prints.",
    score: 44,
    hitRate: 0.49,
    resolved: 22,
    net: -31,
    service: null,
  },
];

/* `GET /marketplace/leaderboard`: only agents with a resolved record, ranked by score. */
const leaderboard: LeaderboardDto = {
  entries: directory
    .filter((entry) => entry.score !== null)
    .map((entry) => ({
      agent: entry.agent,
      beat: entry.beat,
      venue: entry.venue,
      score: entry.score ?? 0,
      calibrationGap: 0.04,
      resolved: entry.resolved,
      net: entry.net,
    })),
  weights: [{ label: "Calibration", weight: 1, note: "30 days · losses stay up" }],
  calibration: [],
};

/* `GET /v1/signing/passkeys`. */
const passkeys: PasskeyDto[] = [
  {
    id: "pk-preview-1",
    credential_id: "cred-preview-1",
    label: "MacBook Pro · Touch ID",
    transports: ["internal"],
    device_type: "multi_device",
    created_at: at(2880),
    last_used_at: at(1),
  },
  {
    id: "pk-preview-2",
    credential_id: "cred-preview-2",
    label: "iPhone · Face ID",
    transports: ["hybrid"],
    device_type: "multi_device",
    created_at: at(2800),
    last_used_at: at(1046),
  },
];

/** The brief with exit 2 edited and not applied (`perpl-brief-dirty`). */
const dirtyBrief: BriefText = {
  thesis: brief.thesis,
  enters: brief.entersWhen.join("\n"),
  exits: [brief.exitsWhen[0], "Three hours after entry, no matter what", brief.exitsWhen[2]].join(
    "\n",
  ),
  never: brief.never.join("\n"),
};

// ─── The Perpl paper runtime, staged ───────────────────────────────────────────────────────────

const ACTIVE_STAGES: readonly LiveStage[] = [
  "perpl-live-active",
  "perpl-decisions-active",
  "perpl-record-active",
  "perpl-positions-active",
];

const iso = (minutesFromNow: number) => new Date(NOW + minutesFromNow * MINUTE).toISOString();
const checkId = (n: number) => `c0ffee00-0000-4000-8000-${String(n).padStart(12, "0")}`;

/* The brief's three entries, as the model judged them on a check that proposed or entered. */
const entriesMet = [
  { index: 1, met: true, why: "CoinDesk and @WatcherGuru carried the same headline 38s apart" },
  { index: 2, met: true, why: "Price moved 0.2% since the headline" },
  { index: 3, met: true, why: "Funding +0.02%, not leaning its way" },
];
const neverKept = [
  { index: 1, broken: false },
  { index: 2, broken: false },
  { index: 3, broken: false },
];

const summary = (
  n: number,
  minutesAgo: number,
  fields: Partial<PerpsCheckSummaryDto>,
): PerpsCheckSummaryDto => ({
  id: checkId(n),
  at: at(minutesAgo),
  trigger: "hourly",
  status: "finished",
  outcome: "held",
  outcomeText: "HOLD",
  instrument: null,
  action: null,
  probability: null,
  horizonHours: null,
  entries: [],
  exits: [],
  never: [],
  rationale: null,
  inputs: { instruments: ["BTC", "ETH"], web: true },
  configVersion: 4,
  costMicros: "3900",
  error: null,
  ...fields,
});

/* `GET /agents/:id/perps/checks`, newest first: a proposal two minutes ago, holds, a blocked
   second long, the BTC long it holds, an exit at the stop and the brief applied. */
const activeChecks: PerpsCheckSummaryDto[] = [
  summary(8, 2, {
    outcome: "proposed",
    outcomeText: "PROPOSED SHORT ETH",
    instrument: "ETH",
    action: "open-short",
    probability: 0.68,
    horizonHours: 4,
    entries: entriesMet,
    never: neverKept,
    rationale:
      "Two sources carried the ETF outflow headline within a minute and ETH has barely moved. Funding is flat, so the crowd is not short yet.",
    costMicros: "4200",
  }),
  summary(7, 62, {
    outcomeText: "ENTRY 2 HELD",
    instrument: "ETH",
    action: "hold",
    entries: [
      entriesMet[0]!,
      { index: 2, met: false, why: "Price already +0.6% since the headline" },
      entriesMet[2]!,
    ],
    never: neverKept,
    rationale: "The headline was real but the move already happened.",
  }),
  summary(6, 73, {
    outcome: "blocked",
    outcomeText: "BLOCKED BY CAP · PER DAY",
    instrument: "BTC",
    action: "open-long",
    probability: 0.61,
    horizonHours: 4,
    entries: entriesMet,
    never: neverKept,
    trigger: "manual",
  }),
  summary(5, 94, {
    outcome: "entered",
    outcomeText: "ENTERED LONG BTC",
    instrument: "BTC",
    action: "open-long",
    probability: 0.71,
    horizonHours: 4,
    entries: entriesMet,
    never: neverKept,
    rationale:
      "A credible headline on two sources, BTC flat since, funding neutral: the 30 to 90 seconds the brief is about.",
    costMicros: "4600",
  }),
  summary(4, 122, {
    outcomeText: "LOW CONVICTION",
    instrument: "BTC",
    action: "open-long",
    probability: 0.52,
    horizonHours: 24,
    entries: entriesMet,
    never: neverKept,
  }),
  summary(3, 171, {
    outcome: "exited",
    outcomeText: "STOP · LONG ETH",
    trigger: "exits",
    instrument: "ETH",
    inputs: null,
    costMicros: null,
  }),
  summary(2, 190, { outcomeText: "NEVER 1", never: [{ index: 1, broken: true }] }),
  summary(1, 236, {
    outcome: "system",
    outcomeText: "OPENED ITS PAPER ACCOUNT · 75.80 AUSD",
    trigger: "system",
    inputs: null,
    costMicros: null,
  }),
];

/* The steps of the newest check (the strip's log) and of the entry (Decisions opens it). */
const steps = (startMinutesAgo: number, lines: readonly [number, string][]) =>
  lines.map(([seconds, text]) => ({
    at: new Date(NOW - startMinutesAgo * MINUTE + seconds * 1000).toISOString(),
    text,
    ms: null,
  }));

const detail = (
  check: PerpsCheckSummaryDto,
  minutesAgo: number,
  lines: readonly [number, string][],
): PerpsCheckDetailDto => ({
  ...check,
  startedAt: at(minutesAgo),
  finishedAt: new Date(
    NOW - minutesAgo * MINUTE + lines[lines.length - 1]![0] * 1000,
  ).toISOString(),
  steps: steps(minutesAgo, lines),
});

const activeDetails: Record<string, PerpsCheckDetailDto> = {
  [checkId(8)]: detail(activeChecks[0]!, 2, [
    [0.3, "Woke up · hourly check"],
    [1.6, "Read Perpl BTC, ETH · 1.3s"],
    [3.0, "Read the web · coindesk.com, theblock.co · 2 results"],
    [6.1, "Asked the model · 3.1s"],
    [7.1, "Checking the brief · entries 1, 2, 3 met · never kept"],
    [8.6, "PROPOSED SHORT ETH · waits 15 min for you"],
  ]),
  [checkId(5)]: detail(activeChecks[3]!, 94, [
    [0.3, "Woke up · hourly check"],
    [1.2, "Read Perpl BTC, ETH · 0.9s"],
    [2.9, "Read the web · 2 results"],
    [6.4, "Asked the model · 3.5s"],
    [8.0, "Checking the brief · entries 1, 2, 3 met"],
    [9.2, "ENTERED LONG BTC · 25 AUSD at 3× · exits armed"],
  ]),
};

/* `GET /agents/:id/perps/positions`: the BTC long it entered 94 minutes ago, and three closes. */
const activePositions: PerpsPositionsResponseDto = {
  network: "testnet",
  account: true,
  open: [
    {
      id: "pos-preview-btc",
      instrument: "BTC",
      side: "long",
      quantity: "0.000774",
      entryPrice: "96900",
      notional: "75",
      margin: "25",
      leverage: 3,
      openedAt: at(94),
      mark: "97420",
      unrealizedPnl: "0.402",
      stopPrice: "95931",
      takeProfitPrice: "98838",
      exitDueAt: iso(146),
      liquidationEstimate: "64600",
      checkId: checkId(5),
      configVersion: 4,
    },
  ],
  closed: [
    {
      id: "pos-preview-eth",
      instrument: "ETH",
      side: "long",
      entryPrice: "3650",
      exitPrice: "3613.5",
      margin: "25",
      leverage: 3,
      openedAt: at(223),
      closedAt: at(171),
      closeReason: "stop",
      realizedPnl: "-3.2",
    },
    {
      id: "pos-preview-btc-1",
      instrument: "BTC",
      side: "long",
      entryPrice: "95120",
      exitPrice: "97022",
      margin: "25",
      leverage: 3,
      openedAt: at(1236),
      closedAt: at(1046),
      closeReason: "take_profit",
      realizedPnl: "3.9",
    },
    {
      id: "pos-preview-btc-0",
      instrument: "BTC",
      side: "short",
      entryPrice: "95800",
      exitPrice: "95510",
      margin: "20",
      leverage: 2,
      openedAt: at(1620),
      closedAt: at(1380),
      closeReason: "time",
      realizedPnl: "0.7",
    },
  ],
};

/* `GET /agents/:id/perps/proposals`: the short it proposed two minutes ago, 13 minutes left. */
const activeProposals: PerpsProposalDto[] = [
  {
    id: "9b0b0000-0000-4000-8000-000000000001",
    checkId: checkId(8),
    kind: "enter",
    instrument: "ETH",
    side: "short",
    margin: "25",
    leverage: 3,
    notional: "75",
    createdAt: at(2),
    expiresAt: iso(13),
    positionId: null,
  },
];

const today = (fields: Partial<PerpsRecordDto["today"]>): PerpsRecordDto["today"] => ({
  newMarginAusd: 0,
  realizedAusd: 0,
  openCount: 0,
  leverageInUse: 0,
  checks: 0,
  manualChecks: 0,
  manualLimit: 6,
  costMicros: "0",
  ...fields,
});

/* An equity point per hour over the last day, ending at the open BTC long's mark. */
const series = Array.from({ length: 25 }, (_, index) => ({
  at: at((24 - index) * 60),
  equity: Number(
    (75.8 + Math.sin(index * 0.9) * 0.8 + (index > 20 ? -3.2 : 0) + index * 0.05).toFixed(2),
  ),
}));

/* `GET /agents/:id/perps/record`, the runtime on. */
const activeRecord: PerpsRecordDto = {
  runtimeEnabled: true,
  network: "testnet",
  account: true,
  realizedAusd: 1.4,
  openPnlAusd: 0.4,
  feesAndFundingAusd: -0.9,
  cashAusd: 77.2,
  equityAusd: 77.6,
  closedCount: 3,
  wins: 2,
  hitRate: 2 / 3,
  maxDrawdownAusd: 3.2,
  maxDrawdownPct: 0.041,
  checks: 31,
  entries: 4,
  series: [...series.slice(0, -1), { at: at(0), equity: 77.6 }],
  today: today({
    newMarginAusd: 50,
    realizedAusd: -3.2,
    openCount: 1,
    leverageInUse: 3,
    checks: 14,
    manualChecks: 2,
    costMicros: "58300",
  }),
};

/* The runtime off, as the API answers while `PERPL_RUNTIME_ENABLED` is false. */
const offRuntime: LiveRuntimeStaged = {
  record: {
    ...activeRecord,
    runtimeEnabled: false,
    account: false,
    realizedAusd: 0,
    openPnlAusd: null,
    feesAndFundingAusd: 0,
    cashAusd: 0,
    equityAusd: null,
    closedCount: 0,
    wins: 0,
    hitRate: null,
    maxDrawdownAusd: 0,
    maxDrawdownPct: null,
    checks: 0,
    entries: 0,
    series: [],
    today: today({}),
  },
  checks: [],
  positions: { network: "testnet", account: false, open: [], closed: [] },
  proposals: [],
  details: {},
  actions: [],
};

const activeRuntime: LiveRuntimeStaged = {
  record: activeRecord,
  checks: activeChecks,
  positions: activePositions,
  proposals: activeProposals,
  details: activeDetails,
  actions: [],
};

/* `perpl-positions-active`: the hourly check started a minute ago is still running, so the owner's
   "Close now" on the BTC long waits for it (`lastError` CHECK_RUNNING). */
const runningCheck = summary(9, 1, {
  status: "running",
  outcome: null,
  outcomeText: null,
  costMicros: null,
});
const closeActionId = "ac710000-0000-4000-8000-000000000001";
const closingRuntime: LiveRuntimeStaged = {
  ...activeRuntime,
  checks: [runningCheck, ...activeChecks],
  actions: [
    {
      kind: "close",
      target: "pos-preview-btc",
      actionId: closeActionId,
      action: {
        id: closeActionId,
        kind: "close",
        status: "pending",
        positionId: "pos-preview-btc",
        proposalId: null,
        attempts: 1,
        lastError: "CHECK_RUNNING",
        checkId: null,
        createdAt: at(0.5),
        updatedAt: at(0.2),
      },
      outcome: null,
    },
  ],
};

/* `perpl-positions-paused`: the operator turned the runtime off with the BTC long still open. Its
   paper stays drawn with Close now and Stop · close all, which still run (R3); nothing waits on
   the owner, because an approval cannot open anything while it is off. */
const pausedRuntime: LiveRuntimeStaged = {
  ...activeRuntime,
  record: { ...activeRecord, runtimeEnabled: false },
  proposals: [],
};

/**
 * The runtime each stage reads: off, on, on with a close waiting for the running check, or off with
 * a paper position still open.
 */
function stagedRuntime(stage: LiveStage): LiveRuntimeStaged {
  if (stage === "perpl-positions-active") {
    return closingRuntime;
  }
  if (stage === "perpl-positions-paused") {
    return pausedRuntime;
  }
  return ACTIVE_STAGES.includes(stage) ? activeRuntime : offRuntime;
}

const ACCOUNT_TABS: Partial<Record<LiveStage, AccountTab>> = {
  "perpl-account-profile": "profile",
  "perpl-account-notify": "notify",
};

/**
 * The live studio at one `?stage=perpl-*`. `perpl-live` is the Overview the day after Go Public;
 * `perpl-paused` has entries paused; `perpl-warnings` has its gas and free AUSD low, so the banner
 * shows; the rest open their section, `perpl-brief-dirty` with an edit not applied and the account
 * stages on their tab. Those keep the Perpl runtime off; `perpl-live-active` (a position and a
 * proposal on Overview), `perpl-decisions-active`, `perpl-record-active` and
 * `perpl-positions-active` (Positions, its "Close now" waiting for the running check) have it on,
 * with checks, a paper position, a proposal and a record.
 */
export function liveStudioFixture(stage: LiveStage): LiveStaged {
  const warned = stage === "perpl-warnings";
  const markets = board(stage === "perpl-markets" ? sampleSource : perplSource);
  return {
    now: NOW,
    agent: agent(stage === "perpl-paused", warned ? 18 : 75.8),
    section: SECTIONS[stage],
    wallets: warned
      ? wallets("18000000", "120000000000000000")
      : wallets("75800000", "900000000000000000"),
    x: {
      account: { handle: X_HANDLE, verifiedAt: at(1760) },
      status: "connected",
      available: true,
      readsAvailable: true,
    },
    ledger,
    versions,
    markets,
    details: details(markets),
    directory,
    leaderboard,
    passkeys,
    accountHandle: "nightowl",
    accountTab: ACCOUNT_TABS[stage] ?? "security",
    briefDraft: stage === "perpl-brief-dirty" ? dirtyBrief : null,
    runtime: stagedRuntime(stage),
  };
}
