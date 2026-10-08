/**
 * The draft studio at each `?stage=draft*` (`home/stage.ts`, studio-draft-dashboard-v1 §7), as the
 * "Pickler Studio Draft" canvas draws it: Halftime, an analyst trading BTC and ETH on Perpl, made a
 * few minutes ago with its own wallet, funded with 10 AUSD and 0.5 MON from a master wallet that
 * holds the rest. Outside production only; nothing here is anyone's agent, and nothing is sent.
 *
 * Every shape is the API's (`Agent`, `GET /wallets`, `/activity`, `/x`, `/wallets/ledger`), with the
 * words the server writes, so the staged studio goes through the same screens a real draft does.
 * The clock is fixed, not `Date.now()`: the server renders this first, and a stamp that differs
 * between the server and the browser would rehydrate into a different screen.
 */
import type {
  ActivityEvent,
  Agent,
  LedgerEntry,
  PerpsCheckDetailDto,
  PerpsPositionsResponseDto,
  PerpsRecordDto,
  StudioWallets,
  XState,
} from "../api";
import type { DraftStage } from "../home/stage";
import { previewConfig } from "../preview";
import type { DraftSectionKey } from "./model";

/** Go Public's screen state on a Connect X stage: the X row, the skip, the typed handle, the card. */
export interface DraftGoPublicStage {
  xOpen: boolean;
}

/** The draft studio filled in for the design harness, at one moment. */
export interface DraftStaged {
  /** The fixed clock every time on the screen is read against. */
  now: number;
  agent: Agent;
  section: DraftSectionKey;
  wallets: StudioWallets;
  activity: ActivityEvent[];
  x: XState;
  ledger: LedgerEntry[];
  goPublic: DraftGoPublicStage;
  /** The signed-in account's handle, which the YOU sections' header line names. */
  accountHandle: string;
  /**
   * The Perpl paper runtime's reads (`/perps/record`, `/perps/positions`, the newest check). Null
   * on every stage but the two that ran, so the rest keep the Console's Soon state.
   */
  perps: {
    record: PerpsRecordDto | null;
    positions: PerpsPositionsResponseDto | null;
    check: PerpsCheckDetailDto | null;
  };
}

const NOW = Date.UTC(2026, 9, 2, 14, 30, 0);
const MINUTE = 60_000;
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * MINUTE).toISOString();

const AGENT_ID = "preview-draft";
const WALLET_ID = "wal-preview";
const ADDRESS = "0x91bE6f20A3c7D45e81B0F9a2C6d13E7b58Fd4a07";
const MASTER = "0x7f3a9C41e02bB7d5F8a16E3c90D4b27A51f0c21e";
const X_HANDLE = "HalftimeBot";

/** Which section each stage opens on; the X stages are all the Overview's Go Public card. */
const SECTIONS: Record<DraftStage, DraftSectionKey> = {
  draft: "overview",
  "draft-x-open": "overview",
  "draft-x-miss": "overview",
  "draft-x-ok": "overview",
  "draft-x-skipped": "overview",
  "draft-console": "console",
  "draft-console-ran": "console",
  "draft-trades": "picks",
  "draft-trades-active": "picks",
  "draft-brief": "brief",
  "draft-sources": "skills",
  "draft-limits": "limits",
  "draft-identity": "identity",
  "draft-trade": "trade",
  "draft-master": "master",
  /* Activity is locked while it is private (spec D2): the stage proves the locked panel. */
  "draft-locked": "activity",
};

/** The config `prepareDraft` writes for this draft: Perpl, the web preferring two sites, the Wire. */
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
  brief: {
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
  },
  spend: { perCallAusd: 5, perDayAusd: 20 },
  maxLeverage: 1,
  voice: "analyst",
};

function agent(xHandle: string | null): Agent {
  return {
    id: AGENT_ID,
    productId: AGENT_ID,
    tenantId: "preview",
    name: "Halftime",
    handle: "halftime",
    accent: "lime",
    avatarPattern: 0,
    draft: true,
    version: 1,
    config,
    paused: false,
    scheduleEnabled: false,
    nextDueAt: null,
    wallet: { walletId: WALLET_ID, address: ADDRESS, balanceAusd: 10 },
    canSchedule: { ok: false, reason: "first_run" },
    // A lone funded draft: nothing is unfunded, and the drafts are below their limit.
    canCreateAnother: { ok: true, reason: null },
    spend: { perCallAusd: 5, perDayAusd: 20 },
    spendEnforced: true,
    visibility: "private",
    publishedAt: null,
    xHandle,
  };
}

const wallets: StudioWallets = {
  chainId: 10143,
  master: { address: MASTER, ausdMicro: "177600000", monWei: "3700000000000000000" },
  agents: [
    {
      walletId: WALLET_ID,
      address: ADDRESS,
      ausdMicro: "10000000",
      monWei: "500000000000000000",
      agentId: AGENT_ID,
      agentName: "Halftime",
      caps: { perTradeAusd: 5, perDayAusd: 20, maxLeverage: 1 },
      policiesApproved: true,
    },
  ],
  readAt: NOW - MINUTE,
};

/* `GET /agents/:id/activity`, newest first, in the words the server writes. The create screen
   makes and funds the wallet first; "Create Halftime" comes last. */
const activity: ActivityEvent[] = [
  { kind: "created", text: "Halftime created", at: at(9) },
  { kind: "transfer", text: "To Halftime's wallet · 0.5 MON", at: at(11) },
  { kind: "transfer", text: "To Halftime's wallet · 10 AUSD", at: at(12) },
  { kind: "wallet", text: "Agent wallet created · 0x91bE…4a07", at: at(14) },
];

/* `GET /wallets/ledger`: the person's transfers, newest first. */
const ledger: LedgerEntry[] = [
  {
    direction: "to_agent",
    token: "MON",
    amount: "0.5",
    agentName: "Halftime",
    txHash: "0x5e1c0f7a9b3d2e4c6a8b0d1f3e5a7c9b2d4f6e8a0c1b3d5f7a9c2e4b6d8f0a1c",
    at: at(11),
  },
  {
    direction: "to_agent",
    token: "AUSD",
    amount: "10",
    agentName: "Halftime",
    txHash: "0x2b4d6f8a0c1e3a5c7e9b1d3f5a7c9e0b2d4f6a8c1e3b5d7f9a0c2e4b6d8f1a3c",
    at: at(12),
  },
];

/* The Perpl paper runtime after one "Run it on paper" (perpl-paper-runtime-v1 R17), in the words
   the check runner writes: every entry met, so it entered LONG BTC at 5 AUSD × 1; an ETH short
   from yesterday's run closed at its target. */
const CHECK_ID = "5f0b6c1e-2a3d-4e7f-9a8b-1c2d3e4f5a6b";
const CHECK_AT = NOW - 6 * MINUTE;
const after = (ms: number) => new Date(CHECK_AT + ms).toISOString();

const ranCheck: PerpsCheckDetailDto = {
  id: CHECK_ID,
  at: new Date(CHECK_AT).toISOString(),
  trigger: "manual",
  status: "finished",
  outcome: "entered",
  outcomeText: "ENTERED LONG BTC",
  instrument: "BTC",
  action: "open-long",
  probability: 0.68,
  horizonHours: 4,
  entries: [
    { index: 1, met: true, why: "CoinDesk and The Block both ran the ETF inflow line 40s apart" },
    { index: 2, met: true, why: "BTC is up 0.12% since the first headline" },
    { index: 3, met: true, why: "Funding is +0.01%, not leaning long" },
  ],
  exits: [],
  never: [
    { index: 1, broken: false },
    { index: 2, broken: false },
    { index: 3, broken: false },
  ],
  rationale:
    "Two credible sources carried the same inflow headline inside a minute and the book has not moved yet. Small long, out at the stop, the target or four hours.",
  inputs: { instruments: ["BTC", "ETH"], web: true },
  configVersion: 1,
  costMicros: "4200",
  error: null,
  startedAt: after(400),
  finishedAt: after(6100),
  steps: [
    { at: after(1000), text: "Read the brief · 3 entries, 3 exits, 3 never", ms: null },
    { at: after(1300), text: "Opened its paper account · 10.00 AUSD", ms: null },
    { at: after(2700), text: "Read Perpl BTC, ETH · 1.4s", ms: 1400 },
    { at: after(3600), text: "Read the web · 3 sources · 0.9s", ms: 900 },
    { at: after(5700), text: "Asked the model · 2.1s", ms: 2100 },
    { at: after(5800), text: "Entry 1, 2 and 3 met", ms: null },
    { at: after(6000), text: "Opened LONG BTC at 64210.5 · 5.00 AUSD × 1", ms: null },
  ],
};

const ranPositions: PerpsPositionsResponseDto = {
  network: "testnet",
  account: true,
  open: [
    {
      id: "pos-btc-1",
      instrument: "BTC",
      side: "long",
      quantity: "0.000077869",
      entryPrice: "64210.5",
      notional: "5",
      margin: "5",
      leverage: 1,
      openedAt: after(6000),
      mark: "64480",
      unrealizedPnl: "0.021",
      stopPrice: "62284.19",
      takeProfitPrice: "68063.13",
      exitDueAt: new Date(CHECK_AT + 4 * 60 * MINUTE).toISOString(),
      liquidationEstimate: null,
      checkId: CHECK_ID,
      configVersion: 1,
    },
  ],
  closed: [
    {
      id: "pos-eth-1",
      instrument: "ETH",
      side: "short",
      entryPrice: "2412.8",
      exitPrice: "2380.4",
      margin: "5",
      leverage: 1,
      openedAt: at(26 * 60),
      closedAt: at(23 * 60),
      closeReason: "take_profit",
      realizedPnl: "0.064",
    },
  ],
};

const ranRecord: PerpsRecordDto = {
  runtimeEnabled: true,
  network: "testnet",
  account: true,
  realizedAusd: 0.064,
  openPnlAusd: 0.021,
  feesAndFundingAusd: 0.006,
  cashAusd: 5.064,
  equityAusd: 10.085,
  closedCount: 1,
  wins: 1,
  hitRate: 1,
  maxDrawdownAusd: 0,
  maxDrawdownPct: 0,
  checks: 2,
  entries: 2,
  series: [],
  today: {
    newMarginAusd: 5,
    realizedAusd: 0,
    openCount: 1,
    leverageInUse: 1,
    checks: 1,
    manualChecks: 1,
    manualLimit: 6,
    costMicros: "4200",
  },
};

/**
 * The draft studio at one `?stage=draft*`. `draft` is the Overview right after "Create Halftime";
 * the X stages are Go Public's card with the X row open, reconnection required,
 * connected OAuth, and unavailable configuration (historical stage names); the rest open their section, and `draft-locked` opens
 * Activity, which a private agent has locked. `draft-console-ran` and `draft-trades-active` are the
 * Console and Trades after one paper run with the Perpl runtime open.
 */
export function draftStudioFixture(stage: DraftStage): DraftStaged {
  const verified = stage === "draft-x-ok";
  const miss = stage === "draft-x-miss";
  return {
    now: NOW,
    agent: agent(verified ? X_HANDLE : null),
    section: SECTIONS[stage],
    wallets,
    activity,
    x: {
      account: verified || miss ? { handle: X_HANDLE, verifiedAt: at(2) } : null,
      status: verified ? "connected" : miss ? "reconnect_required" : "disconnected",
      available: stage !== "draft-x-skipped",
      readsAvailable: stage !== "draft-x-skipped",
    },
    ledger,
    goPublic: {
      xOpen: stage === "draft-x-open" || miss || stage === "draft-x-skipped",
    },
    accountHandle: "nightowl",
    perps:
      stage === "draft-console-ran" || stage === "draft-trades-active"
        ? { record: ranRecord, positions: ranPositions, check: ranCheck }
        : { record: null, positions: null, check: null },
  };
}
