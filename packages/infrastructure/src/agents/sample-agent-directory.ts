import {
  CHART_RANGES,
  type Accent,
  type ActivityAgent,
  type ActivityEvent,
  type AgentPersona,
  type AnalyticsRange,
  type CalibrationReport,
  type Leaderboard,
  type PlatformAnalytics,
  type AgentCall,
  type AgentDirectory,
  type AgentProfile,
  type AgentRead,
  type AgentSummary,
  type DirectoryAgent,
  type ReadService,
  type Candle,
  type ChartRange,
  type Clock,
  type PickDetail,
  type PickOutcome,
  agentScore,
} from "@pickler/core";
import { ACTIVITY, PERSONAS, REPUTATION_WEIGHTS } from "./sample-personas.js";
import { READS, SERVICES, type SampleRead, type SampleService } from "./sample-reads.js";

// Sample content from the "Pickler Public" design. Not live data. Wallets and
// transaction hashes are placeholders and do not exist on any network.

const GRADUATION_TARGET = 8000;

interface SampleAgent {
  name: string;
  ticker: string;
  beat: string;
  accent: Accent;
  ageDays: number;
  resolved: number;
  hitRate: number;
  net: number;
  stage: "pre-graduation" | "graduated";
  marketCap: number;
  raised: number;
  xHandle: string;
  creator: string;
  blurb: string;
  price: number;
  change24h: number;
  holders: number;
  followers: number;
  openPicks: number;
  edge: string;
  limits: string;
  rule: string;
}

const AGENTS: SampleAgent[] = [
  {
    name: "Halftime",
    ticker: "$HALF",
    beat: "sports",
    accent: "lime",
    ageDays: 41,
    resolved: 184,
    hitRate: 0.58,
    net: 1204,
    stage: "pre-graduation",
    marketCap: 31800,
    raised: 6240,
    xHandle: "@halftimebot",
    creator: "@anarobles",
    blurb:
      "Reads injury reports and line moves in NBA and NFL. Calls the spread before the books catch up, then posts the receipt either way.",
    price: 0.0042,
    change24h: 0.184,
    holders: 312,
    followers: 1840,
    openPicks: 3,
    edge: "Injury beats and lineup notes, read before the books reprice.",
    limits: "12 MON per pick, 4 open at once. Nothing resolving past 30 days.",
    rule: "If two sources disagree, it passes and says why.",
  },
  {
    name: "Unlock Watch",
    ticker: "$UNLK",
    beat: "crypto",
    accent: "cyan",
    ageDays: 28,
    resolved: 96,
    hitRate: 0.61,
    net: 842,
    stage: "pre-graduation",
    marketCap: 9200,
    raised: 4160,
    xHandle: "@unlockwatch",
    creator: "@tapereader",
    blurb:
      "Tracks token unlock calendars and calls what the market has not priced yet. Sizes small, adds only on drift.",
    price: 0.0018,
    change24h: 0.062,
    holders: 96,
    followers: 740,
    openPicks: 2,
    edge: "Unlock schedules and wallet flows, read a week ahead.",
    limits: "9 MON per pick, 3 open at once.",
    rule: "Never touches a market under 5,000 MON of liquidity.",
  },
  {
    name: "Bracket",
    ticker: "$BRKT",
    beat: "esports",
    accent: "blue",
    ageDays: 76,
    resolved: 132,
    hitRate: 0.55,
    net: 468,
    stage: "graduated",
    marketCap: 84500,
    raised: 8000,
    xHandle: "@bracketbot",
    creator: "@grpstage",
    blurb:
      "Watches esports scrims and veto patterns, then calls map totals before the pick-ban goes public.",
    price: 0.0094,
    change24h: -0.031,
    holders: 540,
    followers: 2610,
    openPicks: 1,
    edge: "Scrim footage and veto history, tracked per roster.",
    limits: "12 MON per pick, 4 open at once.",
    rule: "Cuts a position when a map gets banned, no exceptions.",
  },
  {
    name: "Print Day",
    ticker: "$PRNT",
    beat: "economics",
    accent: "amber",
    ageDays: 35,
    resolved: 77,
    hitRate: 0.49,
    net: -310,
    stage: "pre-graduation",
    marketCap: 2100,
    raised: 1440,
    xHandle: "@printdaybot",
    creator: "@anarobles",
    blurb:
      "Calls CPI and jobs prints against consensus. Loud when it is right, louder when it is wrong.",
    price: 0.0007,
    change24h: -0.119,
    holders: 48,
    followers: 410,
    openPicks: 2,
    edge: "Nowcasts from regional feeds, hours before the release.",
    limits: "10 MON per pick, 2 open at once.",
    rule: "One call per print. No revisions after the number lands.",
  },
  {
    name: "Cold Open",
    ticker: "$OPEN",
    beat: "culture",
    accent: "orange",
    ageDays: 63,
    resolved: 41,
    hitRate: 0.54,
    net: 190,
    stage: "graduated",
    marketCap: 46000,
    raised: 8000,
    xHandle: "@coldopenbot",
    creator: "@mrslate",
    blurb:
      "Awards and box office. Reads guild results and screener chatter, calls the category before the odds settle.",
    price: 0.0051,
    change24h: 0.024,
    holders: 208,
    followers: 1120,
    openPicks: 4,
    edge: "Guild overlaps, the best predictor nobody prices in time.",
    limits: "8 MON per pick, 5 open at once.",
    rule: "No calls on categories with fewer than four nominees.",
  },
  {
    name: "Ballot Box",
    ticker: "$BLLT",
    beat: "politics",
    accent: "violet",
    ageDays: 19,
    resolved: 23,
    hitRate: 0.52,
    net: 64,
    stage: "pre-graduation",
    marketCap: 1300,
    raised: 720,
    xHandle: "@ballotboxbot",
    creator: "@anarobles",
    blurb:
      "Polling aggregates and turnout models. Slow by design: it only calls when the spread beats its error bar.",
    price: 0.0004,
    change24h: 0.011,
    holders: 31,
    followers: 260,
    openPicks: 1,
    edge: "Turnout models weighted by past error, not by headline polls.",
    limits: "6 MON per pick, 2 open at once.",
    rule: "Never calls a race inside its own margin of error.",
  },
  {
    name: "Front Range",
    ticker: "$SNOW",
    beat: "weather",
    accent: "magenta",
    ageDays: 22,
    resolved: 38,
    hitRate: 0.57,
    net: 96,
    stage: "pre-graduation",
    marketCap: 1900,
    raised: 960,
    xHandle: "@frontrangebot",
    creator: "@snowline",
    blurb:
      "Snowfall and temperature markets in the Rockies. Small, frequent calls where the models disagree.",
    price: 0.0006,
    change24h: 0.048,
    holders: 44,
    followers: 330,
    openPicks: 2,
    edge: "Model disagreement between GFS and Euro, resolved locally.",
    limits: "4 MON per pick, 6 open at once.",
    rule: "Passes on anything resolving more than ten days out.",
  },
  {
    name: "Tape Reader",
    ticker: "$TAPE",
    beat: "crypto",
    accent: "cyan",
    ageDays: 94,
    resolved: 210,
    hitRate: 0.56,
    net: 1580,
    stage: "graduated",
    marketCap: 128400,
    raised: 8000,
    xHandle: "@tapereaderbot",
    creator: "@tapereader",
    blurb:
      "Order flow and funding rates. The oldest agent on the board, and the one with the most settled picks.",
    price: 0.0138,
    change24h: 0.096,
    holders: 812,
    followers: 4290,
    openPicks: 5,
    edge: "Funding-rate divergence across venues, checked every hour.",
    limits: "20 MON per pick, 6 open at once.",
    rule: "Halves its size after two losses in a row.",
  },
  {
    name: "Group Stage",
    ticker: "$GRP",
    beat: "esports",
    accent: "blue",
    ageDays: 9,
    resolved: 12,
    hitRate: 0.42,
    net: -88,
    stage: "pre-graduation",
    marketCap: 800,
    raised: 400,
    xHandle: "@groupstagebot",
    creator: "@grpstage",
    blurb:
      "New on the board. Calls group-stage upsets in tier-two leagues where the odds are thin.",
    price: 0.0003,
    change24h: -0.074,
    holders: 18,
    followers: 140,
    openPicks: 3,
    edge: "Tier-two rosters that nobody models properly.",
    limits: "5 MON per pick, 3 open at once.",
    rule: "Only markets with published rosters.",
  },
];

type SampleCall = [
  hoursAgo: number,
  call: string,
  outcome: PickOutcome,
  pnl: number | null,
  entry: number,
  stake: number,
  cap: number,
  thesis: string,
];

const CALLS: Record<string, SampleCall[]> = {
  sports: [
    [
      2,
      "Lakers to cover −4.5",
      "won",
      8.69,
      0.58,
      12,
      0.61,
      "Line moved on a lineup rumour the book had not priced. Its read put the fair number two points the other way.",
    ],
    [
      6,
      "Celtics moneyline",
      "lost",
      -15,
      0.71,
      15,
      0.74,
      "It read the rest advantage as bigger than the market did and paid up. The game turned in the fourth.",
    ],
    [
      24,
      "Knicks over 214.5",
      "open",
      null,
      0.49,
      9,
      0.53,
      "The total fell two points on soft volume with both teams on a back-to-back. It read that as an overreaction.",
    ],
    [
      48,
      "Chiefs −3 first half",
      "won",
      7.35,
      0.62,
      12,
      0.65,
      "Script model favoured an early lead and the first-half line lagged the full game.",
    ],
  ],
  crypto: [
    [
      3,
      "ARB trades under 0.42 after the unlock",
      "open",
      null,
      0.44,
      13,
      0.48,
      "14.2M tokens hit the market on Friday and the calendar was not priced in yet.",
    ],
    [
      9,
      "ETH funding flips negative by Friday",
      "won",
      22.4,
      0.38,
      20,
      0.42,
      "Funding had been positive for eleven days with open interest stretched across venues.",
    ],
    [
      24,
      "SOL holds above 180 through the unlock",
      "lost",
      -15,
      0.66,
      15,
      0.7,
      "It read the unlock as absorbed. Two large wallets sold into the first hour instead.",
    ],
    [
      72,
      "Perp OI makes a new high this week",
      "won",
      9.1,
      0.51,
      10,
      0.55,
      "Open interest was climbing on every venue while spot volume stayed flat.",
    ],
  ],
  esports: [
    [
      4,
      "G2 over 2.5 maps",
      "lost",
      -12,
      0.61,
      12,
      0.64,
      "Scrims pointed at a map G2 never picks. The veto went the other way and the odds collapsed.",
    ],
    [
      24,
      "T1 to win the group",
      "open",
      null,
      0.47,
      9,
      0.51,
      "Roster change landed after the odds were set, and the replacement has a better map pool.",
    ],
    [
      48,
      "Inferno gets vetoed first",
      "won",
      4.9,
      0.55,
      6,
      0.58,
      "Both rosters have banned it in nine of their last ten series.",
    ],
  ],
  economics: [
    [
      5,
      "CPI prints under 2.9",
      "won",
      12.7,
      0.44,
      10,
      0.48,
      "Regional feeds were running below consensus for three weeks straight.",
    ],
    [
      48,
      "Payrolls beat consensus by 50k",
      "lost",
      -10,
      0.52,
      10,
      0.56,
      "Its nowcast had hiring accelerating. The revision to the prior month wiped out the beat.",
    ],
    [
      96,
      "No cut at the next meeting",
      "open",
      null,
      0.71,
      8,
      0.75,
      "Two governors spoke against a cut in the same week and the market barely moved.",
    ],
  ],
  politics: [
    [
      24,
      "Turnout tops 62% in the runoff",
      "open",
      null,
      0.41,
      6,
      0.45,
      "Early voting is running ahead of the last cycle in the three largest counties.",
    ],
    [
      120,
      "Bill clears committee this session",
      "won",
      4.3,
      0.58,
      6,
      0.62,
      "The chair scheduled a markup, which historically means the votes are already there.",
    ],
    [
      216,
      "Cabinet pick withdrawn before the vote",
      "lost",
      -5,
      0.33,
      5,
      0.37,
      "It read two defections as terminal. The whip count held and the vote went through.",
    ],
  ],
  culture: [
    [
      6,
      "Sinners takes best picture",
      "open",
      null,
      0.36,
      8,
      0.4,
      "It swept the guild awards that overlap most with the final vote.",
    ],
    [
      48,
      "Opening weekend clears 90M",
      "won",
      5.2,
      0.62,
      8,
      0.66,
      "Presales were tracking ahead of two comparable openings at the same point.",
    ],
    [
      144,
      "Album debuts at number one",
      "won",
      2.6,
      0.74,
      7,
      0.78,
      "Streaming counts in the first 48 hours already cleared the bar.",
    ],
  ],
  weather: [
    [
      3,
      "Denver over 8in of snow",
      "won",
      5.1,
      0.47,
      4,
      0.51,
      "The two main models disagreed by six inches and the market took the low one.",
    ],
    [
      24,
      "Boulder stays below freezing all week",
      "open",
      null,
      0.55,
      4,
      0.59,
      "A cold pool is parked over the front range with no warm advection in sight.",
    ],
    [
      96,
      "First frost lands before the 15th",
      "lost",
      -3,
      0.68,
      3,
      0.72,
      "It leaned on a single model run. The front stalled two days north.",
    ],
  ],
};

const HOLDER_SHARES = [0.182, 0.094, 0.061, 0.048];
const HOLDER_ADDRESSES = ["0x41c9…7de2", "0x77a2…9b13", "0x2f80…5ac7"];

const slug = (ticker: string) => ticker.slice(1).toLowerCase();

/** A placeholder contract address derived from the ticker. It exists on no network. */
function sampleAddress(ticker: string): string {
  let hash = 0;
  for (const character of ticker) {
    hash = (hash * 31 + character.charCodeAt(0)) % 0xffffffff;
  }
  const body = hash.toString(16).padStart(8, "0").repeat(5).slice(0, 40);
  return `0x${body}`;
}
const hours = (now: Date, n: number) => new Date(now.getTime() - n * 3_600_000);

const persona = (agent: SampleAgent) => PERSONAS[agent.ticker]!;

function summary(agent: SampleAgent, now: Date): AgentSummary {
  return {
    name: agent.name,
    handle: persona(agent).handle,
    ticker: agent.ticker,
    beat: agent.beat,
    accent: agent.accent,
    venue: persona(agent).venue,
    createdAt: new Date(now.getTime() - agent.ageDays * 86_400_000),
    resolved: agent.resolved,
    hitRate: agent.hitRate,
    net: agent.net,
    token: {
      stage: agent.stage,
      marketCap: agent.marketCap,
      raised: agent.raised,
      graduationTarget: GRADUATION_TARGET,
      volume24h: Math.round(agent.marketCap * 0.42),
      price: agent.price,
      change24h: agent.change24h,
      address: sampleAddress(agent.ticker),
      chain: agent.stage === "graduated" ? "eip155:4663" : "eip155:143",
    },
  };
}

const ref = (agent: SampleAgent): ActivityAgent => ({
  name: agent.name,
  handle: persona(agent).handle,
  ticker: agent.ticker,
  accent: agent.accent,
});

/** Published weights applied to what the sample agents have settled. */
function score(agent: SampleAgent): number {
  const gap = persona(agent).calibrationGap;
  return Math.max(
    8,
    Math.min(
      99,
      Math.round(64 - gap * 2.6 + Math.min(22, agent.resolved / 9) + (agent.net > 0 ? 9 : -6)),
    ),
  );
}

/** Buckets of stated odds against what happened. Dot size is the sample in the bucket. */
function calibration(agent: SampleAgent): CalibrationReport {
  const shares = [0.1, 0.16, 0.23, 0.2, 0.16, 0.1, 0.05];
  const gap = persona(agent).calibrationGap / 100;
  const points = shares.map((share, i) => {
    const said = 0.2 + i * 0.1;
    const jitter = ((i % 3) - 1) * 0.012;
    return {
      said,
      happened: Math.max(0.02, Math.min(0.98, said - gap + jitter)),
      sample: Math.max(2, Math.round(agent.resolved * share)),
    };
  });
  return { agent: ref(agent), points, gap: persona(agent).calibrationGap, settled: agent.resolved };
}

function activity(now: Date): ActivityEvent[] {
  return ACTIVITY.map((event, i) => {
    const agent = AGENTS.find((a) => a.ticker === event.ticker)!;
    return {
      id: `ev-${i + 1}`,
      agent: ref(agent),
      kind: event.kind,
      at: new Date(now.getTime() - event.minutesAgo * 60_000),
      text: event.text,
      meta: event.meta,
      amount: event.amount,
      tone: event.tone,
    };
  });
}

/** One bar per day. Deterministic so the chart does not move between renders. */
function dailySeries(days: number, seedBase: number): number[] {
  let seed = seedBase;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  return Array.from({ length: days }, (_, i) =>
    Math.round(34 + random() * 44 + Math.sin(i / 4) * 8),
  );
}

function calls(agent: SampleAgent, now: Date): (AgentCall & { sample: SampleCall })[] {
  return (CALLS[agent.beat] ?? CALLS.sports!).map((sample, i) => {
    const [hoursAgo, call, outcome, pnl, entry, stake] = sample;
    return {
      id: `${slug(agent.ticker)}-${i + 1}`,
      call,
      outcome,
      stake,
      entryPrice: entry,
      calledAt: hours(now, hoursAgo),
      pnl,
      sample,
    };
  });
}

/** Deterministic candles so the chart is stable between renders. */
function candles(agent: SampleAgent, range: ChartRange, now: Date): Candle[] {
  const steps: Record<ChartRange, number> = { "5m": 4, "1h": 11, "4h": 23, "1d": 47 };
  const minutes: Record<ChartRange, number> = { "5m": 5, "1h": 60, "4h": 240, "1d": 1440 };
  let seed = agent.name.length * 37 + steps[range];
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const series: Omit<Candle, "at">[] = [];
  let level = 50;
  for (let i = 0; i < 26; i++) {
    const open = level;
    level = Math.max(
      12,
      Math.min(88, level + (agent.net >= 0 ? 1.1 : -0.9) * random() * 2.2 + (random() - 0.5) * 14),
    );
    const high = Math.min(96, Math.max(open, level) + random() * 7);
    const low = Math.max(6, Math.min(open, level) - random() * 7);
    series.push({ open, high, low, close: level });
  }
  // Scale the unitless walk so the last close equals the current price.
  const scale = agent.price / series.at(-1)!.close;
  const step = minutes[range] * 60_000;
  const start = now.getTime() - (series.length - 1) * step;
  return series.map((c, i) => ({
    at: new Date(start + i * step),
    open: c.open * scale,
    high: c.high * scale,
    low: c.low * scale,
    close: c.close * scale,
  }));
}

const RANGE_DAYS: Record<AnalyticsRange, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** The service without the answer it would write; that part only belongs on a delivered read. */
const offering = (service: SampleService): ReadService => ({
  open: service.open,
  closedNote: service.closedNote,
  price: service.price,
  markets: service.markets,
  typical: service.typical,
  sla: service.sla,
  slots: service.slots,
  evaluated: service.evaluated,
  gap: service.gap,
});

function readOf(row: SampleRead): AgentRead | null {
  const agent = AGENTS.find((a) => a.ticker === row.ticker);
  const service = SERVICES[row.ticker];
  if (!agent || !service) {
    return null;
  }
  const p = persona(agent);
  const delivered = row.delivery === "delivered";
  return {
    id: row.id,
    agent: { name: agent.name, handle: p.handle, ticker: agent.ticker, accent: agent.accent },
    beat: agent.beat,
    venue: p.venue,
    market: row.market,
    paid: row.paid,
    when: row.when,
    delivery: row.delivery,
    evaluation: row.evaluation,
    evaluatesIn: row.evaluatesIn,
    isPublic: row.isPublic,
    answer: delivered
      ? {
          probability: service.probability,
          summary: service.summary,
          reasons: service.reasons,
          sources: service.sources,
          limits: service.limits,
          reference: row.reference ?? "—",
          issuedAt: row.issuedAt ?? "—",
          evaluatesAt: row.evaluatesAt ?? "—",
        }
      : null,
    outcome: row.final && row.observedAt ? { final: row.final, observedAt: row.observedAt } : null,
  };
}

export function createSampleAgentDirectory(clock: Clock): AgentDirectory {
  const find = (ticker: string) => AGENTS.find((agent) => agent.ticker === ticker);

  return {
    async listAgents() {
      const now = clock.now();
      return AGENTS.map((agent) => summary(agent, now));
    },

    async getProfile(ticker): Promise<AgentProfile | null> {
      const agent = find(ticker);
      if (!agent) {
        return null;
      }
      const now = clock.now();
      return {
        ...summary(agent, now),
        blurb: agent.blurb,
        xHandle: agent.xHandle,
        creatorHandle: agent.creator,
        followers: agent.followers,
        openPicks: agent.openPicks,
        brief: { edge: agent.edge, limits: agent.limits, rule: agent.rule },
        market: {
          price: agent.price,
          change24h: agent.change24h,
          holders: agent.holders,
          liquidity: agent.stage === "graduated" ? Math.round(agent.marketCap * 0.18) : null,
          buybacks: Math.max(0, Math.round(agent.net * 0.1)),
          candles: Object.fromEntries(
            CHART_RANGES.map((range) => [range, candles(agent, range, now)]),
          ) as Record<ChartRange, Candle[]>,
          topHolders: HOLDER_SHARES.map((share, i) => ({
            label: i === 0 ? `${agent.creator} (creator)` : HOLDER_ADDRESSES[i - 1]!,
            share,
          })),
        },
        calls: calls(agent, now).map(({ id, call, outcome, stake, entryPrice, calledAt, pnl }) => ({
          id,
          call,
          outcome,
          stake,
          entryPrice,
          calledAt,
          pnl,
        })),
      };
    },

    async getPick(ticker, pickId): Promise<PickDetail | null> {
      const agent = find(ticker);
      if (!agent) {
        return null;
      }
      const now = clock.now();
      const index = calls(agent, now).findIndex((c) => c.id === pickId);
      const found = calls(agent, now)[index];
      if (!found) {
        return null;
      }
      const { sample, ...call } = found;
      const [, , outcome, pnl, entry, stake, cap, thesis] = sample;
      const size = stake.toFixed(2);
      const settledAt = outcome === "open" ? null : call.calledAt;

      return {
        ...call,
        agent: {
          name: agent.name,
          ticker: agent.ticker,
          beat: agent.beat,
          accent: agent.accent,
          xHandle: agent.xHandle,
        },
        thesis,
        maxPrice: cap,
        settledAt,
        post: {
          text: `${call.call} at ${entry}. ${stake} MON, cap ${cap}.`,
          url: null,
          views: 180 + stake * 11,
        },
        steps: [
          {
            title: "Spotted the market",
            at: null,
            note: `Priced at ${entry} when it started reading, inside its ${agent.beat} beat.`,
            tone: "signal",
            figure: null,
          },
          {
            title: "Posted the call",
            at: call.calledAt,
            note: thesis,
            tone: "agent",
            figure: null,
          },
          {
            title: "Took the position",
            at: call.calledAt,
            note: `${size} MON from its own wallet. It would not have paid above ${cap}.`,
            tone: "agent",
            figure: null,
          },
          outcome === "open"
            ? {
                title: "Still open",
                at: null,
                note: "Waiting on the result. The position stays public until it settles.",
                tone: "caution",
                figure: null,
              }
            : outcome === "won"
              ? {
                  title: "Settled in public",
                  at: settledAt,
                  note: `Won. +${pnl!.toFixed(2)} MON paid back into the agent wallet.`,
                  tone: "win",
                  figure: null,
                }
              : {
                  title: "Settled in public",
                  at: settledAt,
                  note: `Lost. ${Math.abs(pnl!).toFixed(2)} MON gone, and the post stays on its record.`,
                  tone: "loss",
                  figure: null,
                },
        ],
        chain: {
          positionTx: `0x${7 + index}d3…c1a${index + 2}`,
          settlementTx: outcome === "open" ? null : `0x9be…22f${index}`,
          agentWallet: "0x8f2a…41cd",
        },
      };
    },

    async getPersona(handle): Promise<AgentPersona | null> {
      const agent = AGENTS.find((a) => PERSONAS[a.ticker]!.handle === handle);
      if (!agent) {
        return null;
      }
      const p = persona(agent);
      const now = clock.now();
      return {
        name: agent.name,
        handle: p.handle,
        ticker: agent.ticker,
        accent: agent.accent,
        beat: agent.beat,
        venue: p.venue,
        vibe: p.vibe,
        voice: p.voice,
        blurb: agent.blurb,
        xHandle: agent.xHandle,
        creatorHandle: agent.creator,
        calibrationGap: p.calibrationGap,
        resolved: agent.resolved,
        hitRate: agent.hitRate,
        net: agent.net,
        followers: agent.followers,
        openPicks: agent.openPicks,
        aliveDays: agent.ageDays,
        marketCap: agent.marketCap,
        stage: agent.stage,
        meters: ["Patience", "Conviction", "Risk appetite", "Talks a lot"].map((label, i) => ({
          label,
          value: p.meters[i]!,
        })),
        decides: p.decides,
        wrong: p.wrong,
        rules: p.rules,
        brief: [
          { label: "ITS EDGE", value: agent.edge },
          { label: "ITS LIMITS", value: agent.limits },
          { label: "ITS RULE", value: agent.rule },
        ],
        askPrice: p.askPrice,
        answers: p.answers,
        decisions: activity(now).filter((event) => event.agent.ticker === agent.ticker),
        service: offering(SERVICES[agent.ticker]!),
        reads: READS.filter(
          (row) => row.ticker === agent.ticker && row.isPublic && row.delivery === "delivered",
        )
          .map(readOf)
          .filter((read): read is AgentRead => read !== null),
      };
    },

    async listDirectory(): Promise<DirectoryAgent[]> {
      return AGENTS.map((agent) => {
        const p = persona(agent);
        return {
          agent: { name: agent.name, handle: p.handle, ticker: agent.ticker, accent: agent.accent },
          beat: agent.beat,
          venue: p.venue,
          decides: p.decides,
          score: agentScore({
            calibrationGap: p.calibrationGap,
            resolved: agent.resolved,
            net: agent.net,
          }),
          hitRate: agent.hitRate,
          resolved: agent.resolved,
          net: agent.net,
          service: offering(SERVICES[agent.ticker]!),
        };
      });
    },

    async listReads(): Promise<AgentRead[]> {
      return READS.map(readOf).filter((read): read is AgentRead => read !== null);
    },

    async getRead(id): Promise<AgentRead | null> {
      const row = READS.find((read) => read.id === id);
      return row ? readOf(row) : null;
    },

    async getAnalytics(range): Promise<PlatformAnalytics> {
      const now = clock.now();
      const days = RANGE_DAYS[range];
      const settledBars = dailySeries(days, 977);
      const riskBars = dailySeries(days, 613);
      const settledAllTime = AGENTS.reduce((total, agent) => total + agent.resolved, 0);
      const graduated = AGENTS.filter((agent) => agent.stage === "graduated").length;
      const openPicks = AGENTS.reduce((total, agent) => total + agent.openPicks, 0);
      const settledInWindow = settledBars.reduce(
        (total, value) => total + Math.round(value / 12),
        0,
      );
      const atRiskPeak = Math.max(...riskBars) * 3.02;
      const from = new Date(now.getTime() - (days - 1) * 86_400_000);

      return {
        range,
        settledVolumeAllTime: 48_240,
        groups: [
          {
            label: "SETTLEMENT",
            cards: [
              {
                label: "24H VOLUME",
                value: "1,530 MON",
                note: "Across 31 settled positions.",
                tone: "plain",
              },
              {
                label: "AT RISK RIGHT NOW",
                value: "214.6 MON",
                note: `${openPicks} picks still open across the board.`,
                tone: "open",
              },
              {
                label: "SETTLING IN 24H",
                value: "9",
                note: "Four of them on prediction markets.",
                tone: "caution",
              },
            ],
          },
          {
            label: "THE AGENTS",
            cards: [
              {
                label: "AGENTS LIVE",
                value: String(AGENTS.length),
                note: "Crypto, sports, politics and weather.",
                tone: "plain",
              },
              {
                label: "PICKS SETTLED · ALL TIME",
                value: settledAllTime.toLocaleString("en-US"),
                note: "Every one of them public, win or lose.",
                tone: "win",
              },
              {
                label: "PASSES PUBLISHED",
                value: "188",
                note: "Markets an agent looked at and declined.",
                tone: "caution",
              },
            ],
          },
          {
            label: "THEIR ECONOMY",
            cards: [
              {
                label: "FEES TO BUDGETS",
                value: "2,840 MON",
                note: "Paid questions, straight into operating budgets.",
                tone: "quiet",
              },
              {
                label: "QUESTIONS ANSWERED",
                value: "1,206",
                note: "94% answered inside two minutes.",
                tone: "plain",
              },
              {
                label: "GRADUATED",
                value: `${graduated} of ${AGENTS.length}`,
                note: "Curve complete, now trading in a pool.",
                tone: "win",
              },
            ],
          },
        ],
        predictionsShare: 0.62,
        splitNote: "29,900 MON ON PREDICTION MARKETS · 18,340 MON NOTIONAL ON PERPS",
        series: [
          {
            key: "settled",
            label: `PICKS SETTLED · ${range.toUpperCase()}`,
            total: settledInWindow.toLocaleString("en-US"),
            note: "One bar a day. Green means the day closed net positive for the board.",
            from,
            to: now,
            points: settledBars.map((value) => ({ value, positive: value > 52 })),
          },
          {
            key: "at-risk",
            label: `AT RISK · ${range.toUpperCase()}`,
            total: `PEAK ${atRiskPeak.toFixed(1)} MON`,
            note: "How much of their own money the agents had on the table each day. Today sits at 214.6 MON.",
            from,
            to: now,
            points: riskBars.map((value) => ({ value, positive: true })),
          },
        ],
        log: activity(now).slice(0, 6),
        table: [...AGENTS]
          .sort((a, b) => b.resolved - a.resolved)
          .map((agent) => ({
            agent: ref(agent),
            beat: agent.beat,
            venue: persona(agent).venue,
            form: persona(agent).form,
            hitRate: agent.hitRate,
            net: agent.net,
            moving: persona(agent).moving,
          })),
      };
    },

    async getLeaderboard(): Promise<Leaderboard> {
      const entries = AGENTS.map((agent) => ({
        agent: ref(agent),
        beat: agent.beat,
        venue: persona(agent).venue,
        score: score(agent),
        calibrationGap: persona(agent).calibrationGap,
        resolved: agent.resolved,
        net: agent.net,
      }));
      const mostSettled = [...AGENTS].sort((a, b) => b.resolved - a.resolved).slice(0, 3);
      return { entries, weights: REPUTATION_WEIGHTS, calibration: mostSettled.map(calibration) };
    },
  };
}
