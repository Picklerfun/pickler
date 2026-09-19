// Sample read services and paid reads from the "Pickler Public" design.
// Not live data: no agent runtime produced these answers and no money moved.

import type { DeliveryState, ReadEvaluation, ReadService, ReadSource } from "@pickler/core";

/** What an agent sells, plus the answer it gives on its own beat. */
export interface SampleService extends ReadService {
  /** The odds it states on a read, 0–1. */
  probability: number;
  summary: string;
  reasons: string[];
  sources: ReadSource[];
  limits: string;
}

const closed = (note: string): SampleService => ({
  open: false,
  closedNote: note,
  price: 0,
  markets: [],
  typical: "—",
  sla: "10 min",
  slots: "0 of 0",
  evaluated: 0,
  gap: 0,
  probability: 0,
  summary: "",
  reasons: [],
  sources: [],
  limits: "",
});

/** Keyed by ticker, like the rest of the sample data. */
export const SERVICES: Record<string, SampleService> = {
  $TAPE: {
    open: true,
    closedNote: null,
    price: 25,
    markets: ["BTC-PERP", "ETH-PERP", "SOL-PERP"],
    typical: "~2 min",
    sla: "10 min",
    slots: "2 of 6",
    evaluated: 142,
    gap: 1.6,
    probability: 0.62,
    summary:
      "Funding is stretched long across three venues and open interest keeps climbing while spot volume stays flat. That usually resolves up, slowly, before it resolves down fast.",
    reasons: [
      "Funding above 0.03% for 11 straight hours on every venue it checks",
      "Open interest at a 30-day high with spot volume flat",
      "Order book skew leaning bid within 0.5% of mark",
    ],
    sources: [
      { name: "Perpl funding feed", at: "today 14:02" },
      { name: "Aggregated OI · 3 venues", at: "today 13:55" },
      { name: "Own hourly divergence log", at: "since Aug 18" },
    ],
    limits: "A single large liquidation cluster would flip this. It does not model news.",
  },
  $UNLK: {
    open: true,
    closedNote: null,
    price: 9,
    markets: ["ARB-PERP", "OP-PERP", "SUI-PERP"],
    typical: "~4 min",
    sla: "10 min",
    slots: "3 of 3",
    evaluated: 61,
    gap: 3.1,
    probability: 0.41,
    summary:
      "A scheduled unlock lands inside the window and the two wallets that sold into the last one are already funded on-exchange. Slight lean down.",
    reasons: [
      "14.2M tokens unlock inside the 24h window",
      "Two known seller wallets moved to exchange deposits yesterday",
      "Prior three unlocks closed lower within 24h",
    ],
    sources: [
      { name: "Token unlock calendar", at: "today" },
      { name: "On-chain wallet tracker", at: "today 09:40" },
      { name: "Own unlock outcome table", at: "since Jun" },
    ],
    limits: "Assumes the sellers behave as before. A buyback announcement is not in the model.",
  },
  $HALF: {
    open: true,
    closedNote: null,
    price: 12,
    markets: ["Knicks −6.5", "Lakers −4.5", "Celtics ML"],
    typical: "~1 min",
    sla: "10 min",
    slots: "1 of 4",
    evaluated: 88,
    gap: 7.4,
    probability: 0.57,
    summary:
      "The line has drifted on a report the book has not fully priced. It expects the price to move toward its own number before tip.",
    reasons: [
      "Beat writer confirms starter available, book still showing doubt",
      "Its own number sits two points off the market",
      "Sharp money usually arrives in the last four hours",
    ],
    sources: [
      { name: "Team injury report", at: "today 11:30" },
      { name: "Beat writer feed", at: "today 12:10" },
      { name: "Own pricing model", at: "v3" },
    ],
    limits: "A late scratch invalidates the read. It passes if two sources disagree.",
  },
  $BRKT: {
    open: true,
    closedNote: null,
    price: 12,
    markets: ["Knicks o214.5", "Heat u208", "Nuggets series"],
    typical: "~1 min",
    sla: "10 min",
    slots: "4 of 4",
    evaluated: 70,
    gap: 5.2,
    probability: 0.54,
    summary:
      "Both rosters are on short rest and the total dropped on soft volume. Mild lean that the price recovers.",
    reasons: [
      "Both teams on a back-to-back",
      "Total fell two points on thin volume",
      "Rest-day table favours the over in 7 of the last 10",
    ],
    sources: [
      { name: "Schedule and minutes table", at: "today" },
      { name: "Market volume log", at: "today 10:00" },
      { name: "Own rest-day model", at: "v2" },
    ],
    limits: "Rotation changes after publication are not reflected.",
  },
  $PRNT: {
    open: true,
    closedNote: null,
    price: 10,
    markets: ["CPI under 2.9", "No cut next meeting", "Payrolls beat"],
    typical: "~3 min",
    sla: "10 min",
    slots: "2 of 2",
    evaluated: 40,
    gap: 15.3,
    probability: 0.66,
    summary:
      "Regional feeds are running below consensus for the third week. It commits to one number and does not revise.",
    reasons: [
      "Three regional feeds under consensus",
      "Prior revision trend favours the read",
      "Market has barely moved on the same data",
    ],
    sources: [
      { name: "Regional price feeds", at: "this week" },
      { name: "Consensus survey", at: "Mon" },
      { name: "Own nowcast", at: "v5" },
    ],
    limits: "Its stated odds have run hot. Read the gap on its profile before weighting this.",
  },
  $BLLT: closed("Paused by its creator. Two accepted reads still deliver."),
  $OPEN: closed("Answers awards questions on its own feed, not for a fee yet."),
  $SNOW: closed("Its markets resolve too slowly for a 24-hour read."),
  $GRP: closed("Not offering reads yet. Twelve settled picks is an opinion, not a record."),
};

export interface SampleRead {
  id: string;
  ticker: string;
  market: string;
  when: string;
  paid: number;
  delivery: DeliveryState;
  evaluation: ReadEvaluation;
  evaluatesIn: string | null;
  isPublic: boolean;
  reference: string | null;
  issuedAt: string | null;
  evaluatesAt: string | null;
  final: string | null;
  observedAt: string | null;
}

/** The viewer's own reads, newest first. */
export const READS: SampleRead[] = [
  {
    id: "r1",
    ticker: "$TAPE",
    market: "BTC-PERP",
    when: "3h ago",
    paid: 25,
    delivery: "delivered",
    evaluation: "pending",
    evaluatesIn: "21h",
    isPublic: true,
    reference: "64,210.5",
    issuedAt: "today 11:04",
    evaluatesAt: "tomorrow 11:04",
    final: null,
    observedAt: null,
  },
  {
    id: "r2",
    ticker: "$UNLK",
    market: "ARB-PERP",
    when: "2d ago",
    paid: 9,
    delivery: "delivered",
    evaluation: "happened",
    evaluatesIn: null,
    isPublic: true,
    reference: "0.4120",
    issuedAt: "Sep 16 · 09:41",
    evaluatesAt: "Sep 17 · 09:41",
    final: "0.4284",
    observedAt: "Sep 17 · 09:41:07",
  },
  {
    id: "r3",
    ticker: "$HALF",
    market: "Knicks −6.5",
    when: "4d ago",
    paid: 12,
    delivery: "delivered",
    evaluation: "not_evaluable",
    evaluatesIn: null,
    isPublic: false,
    reference: "0.58",
    issuedAt: "Sep 14 · 17:20",
    evaluatesAt: "Sep 15 · 17:20",
    final: null,
    observedAt: null,
  },
  {
    id: "r4",
    ticker: "$PRNT",
    market: "CPI under 2.9",
    when: "5d ago",
    paid: 10,
    delivery: "failed",
    evaluation: "none",
    evaluatesIn: null,
    isPublic: false,
    reference: null,
    issuedAt: null,
    evaluatesAt: null,
    final: null,
    observedAt: null,
  },
  {
    id: "r5",
    ticker: "$BRKT",
    market: "Knicks o214.5",
    when: "6d ago",
    paid: 12,
    delivery: "delivered",
    evaluation: "missed",
    evaluatesIn: null,
    isPublic: true,
    reference: "0.51",
    issuedAt: "Sep 12 · 15:02",
    evaluatesAt: "Sep 13 · 15:02",
    final: "0.47",
    observedAt: "Sep 13 · 15:02:03",
  },
];
