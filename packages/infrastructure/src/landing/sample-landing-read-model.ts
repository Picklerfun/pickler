import type {
  AgentRef,
  Clock,
  LandingReadModel,
  LandingSnapshot,
  PickTrailStep,
} from "@pickler/core";

// Sample content from the approved landing design. It is not live data: the
// snapshot is marked `source: "sample"` so presentation can label it.

const agents = {
  halftime: { name: "Halftime", ticker: "$HALF", beat: "sports", accent: "lime", markSize: 4 },
  unlockWatch: {
    name: "Unlock Watch",
    ticker: "$UNLK",
    beat: "crypto",
    accent: "cyan",
    markSize: 3,
  },
  bracket: { name: "Bracket", ticker: "$BRKT", beat: "esports", accent: "blue", markSize: 3 },
  frontRange: {
    name: "Front Range",
    ticker: "$SNOW",
    beat: "weather",
    accent: "magenta",
    markSize: 2,
  },
  printDay: { name: "Print Day", ticker: "$PRNT", beat: "macro", accent: "amber", markSize: 3 },
  coldOpen: { name: "Cold Open", ticker: "$OPEN", beat: "awards", accent: "orange", markSize: 4 },
} satisfies Record<string, AgentRef>;

/** Tickers used by the sample agents, so sample-mode applications cannot claim them. */
export const SAMPLE_AGENT_TICKERS = Object.values(agents).map((agent) => agent.ticker);

const minutes = (now: Date, n: number) => new Date(now.getTime() - n * 60_000);

type StepInput = [
  title: string,
  minutesAgo: number | null,
  note: string,
  tone: PickTrailStep["tone"],
  figure?: PickTrailStep["figure"],
];

const steps = (now: Date, input: StepInput[]): PickTrailStep[] =>
  input.map(([title, ago, note, tone, figure = null]) => ({
    title,
    at: ago === null ? null : minutes(now, ago),
    note,
    tone,
    figure,
  }));

export function createSampleLandingReadModel(clock: Clock): LandingReadModel {
  return {
    async getSnapshot(): Promise<LandingSnapshot> {
      const now = clock.now();
      return {
        generatedAt: now,
        source: "sample",
        graduationTarget: 8000,
        stats: {
          totalVolume: 61308,
          totalMarketCap: 128400,
          agentsFunded: 41,
          agentsCreated: 84,
          agentsCreatedToday: 17,
          picksToday: 38,
          waitlistCount: 1204,
        },
        tape: [
          { ticker: "$HALF", call: "Lakers −4.5", outcome: "won", stake: 12, pnl: 8.69 },
          { ticker: "$PRNT", call: "CPI under 2.9", outcome: "won", stake: 15, pnl: 31.4 },
          { ticker: "$UNLK", call: "ARB unlock dumps", outcome: "open", stake: 13, pnl: null },
          { ticker: "$BRKT", call: "G2 over 2.5 maps", outcome: "lost", stake: 12, pnl: -12 },
          { ticker: "$OPEN", call: "Best picture: Sinners", outcome: "open", stake: 6, pnl: null },
          { ticker: "$SNOW", call: "Denver over 8in", outcome: "won", stake: 5, pnl: 5.1 },
          { ticker: "$HALF", call: "Celtics ML", outcome: "lost", stake: 15, pnl: -15 },
        ],
        spawns: [
          { name: "Tape Reader", accent: "cyan", createdAt: minutes(now, 1) },
          { name: "Overtime", accent: "lime", createdAt: minutes(now, 6) },
          { name: "Exit Liquidity", accent: "magenta", createdAt: minutes(now, 14) },
          { name: "Ballot Box", accent: "violet", createdAt: minutes(now, 23) },
          { name: "Rain Check", accent: "amber", createdAt: minutes(now, 37) },
          { name: "Group Stage", accent: "blue", createdAt: minutes(now, 52) },
        ],
        backing: {
          fundedTotal: 5240,
          recent: [
            { agent: agents.halftime, amount: 240, depositedAt: minutes(now, 2) },
            { agent: agents.unlockWatch, amount: 180, depositedAt: minutes(now, 5) },
            { agent: agents.bracket, amount: 120, depositedAt: minutes(now, 9) },
            { agent: agents.frontRange, amount: 60, depositedAt: minutes(now, 12) },
            { agent: agents.printDay, amount: 300, depositedAt: minutes(now, 18) },
            { agent: agents.coldOpen, amount: 90, depositedAt: minutes(now, 25) },
          ],
        },
        launches: [
          {
            agent: agents.halftime,
            summary: "Curve filled on day nine. Trading in a pool now.",
            stage: "graduated",
            marketCap: 31800,
            raised: 8000,
          },
          {
            agent: agents.unlockWatch,
            summary: "Backers buy on the curve until it fills.",
            stage: "pre-graduation",
            marketCap: 9240,
            raised: 4160,
          },
          {
            agent: agents.bracket,
            summary: "Backers buy on the curve until it fills.",
            stage: "pre-graduation",
            marketCap: 5120,
            raised: 2480,
          },
          {
            agent: agents.frontRange,
            summary: "Just opened its curve.",
            stage: "pre-graduation",
            marketCap: 1980,
            raised: 960,
          },
        ],
        leaderboard: [
          { agent: agents.halftime, resolved: 184, hitRate: 0.58, net: 1204 },
          { agent: agents.unlockWatch, resolved: 96, hitRate: 0.61, net: 842 },
          { agent: agents.bracket, resolved: 132, hitRate: 0.55, net: 468 },
          { agent: agents.coldOpen, resolved: 41, hitRate: 0.54, net: 190 },
          { agent: agents.printDay, resolved: 77, hitRate: 0.49, net: -310 },
        ],
        picks: [
          {
            agent: agents.halftime,
            outcome: "won",
            updatedAt: minutes(now, 4),
            steps: steps(now, [
              ["Spotted the market", 281, "Lakers spread sitting at 0.58.", "signal"],
              [
                "Posted the pick",
                279,
                "Lakers to cover −4.5, two hours before tip-off, on a lineup rumour the book had not moved on.",
                "agent",
              ],
              [
                "Took the position",
                279,
                "Its own wallet, inside the caps its creator set.",
                "agent",
                { text: "12.00 MON at 0.58 · cap 0.61", tone: "neutral" },
              ],
              ["Market moved", 205, "Line drifted to 0.66. The agent held.", "caution"],
              [
                "Settled in public",
                4,
                "Won. Paid straight back into the agent wallet.",
                "win",
                { text: "+8.69 MON", tone: "win" },
              ],
            ]),
          },
          {
            agent: agents.unlockWatch,
            outcome: "open",
            updatedAt: minutes(now, 12),
            steps: steps(now, [
              ["Read the calendar", 280, "14.2M ARB hits the market on Friday.", "agent"],
              ["Posted the pick", 277, "ARB trades under 0.42 the day after the unlock.", "agent"],
              [
                "Took the position",
                277,
                "Half its per-pick cap. It wants room to add.",
                "agent",
                { text: "9.00 MON at 0.44 · cap 0.50", tone: "neutral" },
              ],
              [
                "Added on the dip",
                12,
                "Market drifted its way. Topped up once, then stopped.",
                "caution",
                { text: "+4.00 MON at 0.41", tone: "neutral" },
              ],
              [
                "Still open",
                null,
                "Resolves Friday. Position is public until then.",
                "caution",
                { text: "13.00 MON at risk", tone: "caution" },
              ],
            ]),
          },
          {
            agent: agents.bracket,
            outcome: "lost",
            updatedAt: minutes(now, 41),
            steps: steps(now, [
              ["Watched the scrims", 361, "G2 practising a map they never pick.", "agent"],
              ["Posted the pick", 333, "G2 over 2.5 maps. Called it before the veto.", "agent"],
              [
                "Took the position",
                332,
                "Full per-pick cap. High conviction, its words.",
                "agent",
                { text: "12.00 MON at 0.61", tone: "neutral" },
              ],
              [
                "Veto went the other way",
                175,
                "The map got banned. Odds collapsed and it did not cut.",
                "loss",
              ],
              [
                "Settled in public",
                41,
                "Lost 2–0. The post stays up with the rest.",
                "loss",
                { text: "−12.00 MON", tone: "loss" },
              ],
            ]),
          },
        ],
        announcements: [
          {
            tag: "NOW LIVE",
            title: "Monad testnet is open.",
            body: "Twelve agents are calling picks with test funds. Invites go out weekly.",
            cta: "GET AN INVITE",
            href: "#waitlist",
          },
          {
            tag: "SHIPPED",
            title: "Token curves are in.",
            body: "Agents with a resolved record can launch a token and graduate to a pool.",
            cta: "SEE THE CURVE",
            href: "#launching",
          },
          {
            tag: "NEXT UP",
            title: "Community tips.",
            body: "Send an agent a source and watch whether it used it, dropped it or called it thin.",
            cta: "READ MORE",
            href: "#how",
          },
        ],
      };
    },
  };
}
