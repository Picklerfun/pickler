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
import type { ActivityEvent, Agent, LedgerEntry, StudioWallets, XState } from "../api";
import type { DraftStage } from "../home/stage";
import { previewConfig } from "../preview";
import type { DraftSectionKey, XCardState } from "./model";

/** Go Public's screen state on a Connect X stage: the X row, the skip, the typed handle, the card. */
export interface DraftGoPublicStage {
  xOpen: boolean;
  skipped: boolean;
  handle: string;
  card: XCardState;
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
}

const NOW = Date.UTC(2026, 9, 2, 14, 30, 0);
const MINUTE = 60_000;
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * MINUTE).toISOString();

const AGENT_ID = "preview-draft";
const WALLET_ID = "wal-preview";
const ADDRESS = "0x91bE6f20A3c7D45e81B0F9a2C6d13E7b58Fd4a07";
const MASTER = "0x7f3a9C41e02bB7d5F8a16E3c90D4b27A51f0c21e";
const X_HANDLE = "HalftimeBot";
/** Core's challenge form: "pk-" and eight lowercase base32 characters. */
const CHALLENGE = `Verifying Halftime on @pickler · pk-k7q4m2xa`;

/** Which section each stage opens on; the X stages are all the Overview's Go Public card. */
const SECTIONS: Record<DraftStage, DraftSectionKey> = {
  draft: "overview",
  "draft-x-open": "overview",
  "draft-x-miss": "overview",
  "draft-x-ok": "overview",
  "draft-x-skipped": "overview",
  "draft-console": "console",
  "draft-trades": "picks",
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

const idleCard: XCardState = { challenge: null, checking: false, unavailable: false, taken: null };

/**
 * The draft studio at one `?stage=draft*`. `draft` is the Overview right after "Create Halftime";
 * the X stages are Go Public's card with the X row open, the post not found yet ("Check again"),
 * the account verified, and X skipped; the rest open their section, and `draft-locked` opens
 * Activity, which a private agent has locked.
 */
export function draftStudioFixture(stage: DraftStage): DraftStaged {
  const verified = stage === "draft-x-ok";
  const miss = stage === "draft-x-miss";
  const challenge = miss
    ? { handle: X_HANDLE, text: CHALLENGE, expiresAt: new Date(NOW + 30 * MINUTE).toISOString() }
    : null;
  return {
    now: NOW,
    agent: agent(verified ? X_HANDLE : null),
    section: SECTIONS[stage],
    wallets,
    activity,
    x: {
      account: verified ? { handle: X_HANDLE, verifiedAt: at(2) } : null,
      challenge,
      available: true,
    },
    ledger,
    goPublic: {
      xOpen: stage === "draft-x-open" || miss,
      skipped: stage === "draft-x-skipped",
      handle: miss ? X_HANDLE : "",
      card: { ...idleCard, challenge: challenge && { handle: X_HANDLE, text: CHALLENGE } },
    },
  };
}
