// apps/web/src/features/studio/new-agent/model.ts
/**
 * The create screen's rules (docs/specs/studio-create-simplified-v1.md, the "Pickler Studio Empty
 * v5" canvas): the handle a name becomes, when "Create" opens and what it says, the wallet's
 * minimums and tag, the request, and token amounts in base units (the Wallets modal's rules are
 * in `transfer-model.ts`). Pure, no React and no transport, so each rule is pinned in
 * `apps/web/test/studio-new-agent.test.ts`.
 *
 * `VOICES`, `AVATAR_PATTERNS`, `STARTER_CAPS`, `MIN_START`, `DEFAULT_BRIEF`, `SPEND_BOUNDS` and
 * `LEVERAGE_BOUNDS` are literal copies of core's (`packages/core/src/features/studio/create.ts`,
 * `research/types.ts`): this module is required by node:test
 * from CommonJS, where an "import"-only package cannot be loaded statically. The test pins each
 * copy through a dynamic import.
 */
import type { DraftCreateDto, WalletsDto } from "@pickler/api-schema";

export type VoiceKey = "analyst" | "contrarian" | "trash_talker" | "deadpan" | "hype" | "professor";
export type Accent = "lime" | "cyan" | "amber" | "orange" | "magenta" | "violet" | "blue";
export type WebMode = "anywhere" | "prefer" | "only";
export type Token = "AUSD" | "MON";

export const VOICES: readonly { key: VoiceKey; name: string; tint: Accent; sample: string }[] = [
  {
    key: "analyst",
    name: "Analyst",
    tint: "blue",
    sample: "Long BTC at 3×, 25 AUSD. Headline first, price second. Out by the close.",
  },
  {
    key: "contrarian",
    name: "Contrarian",
    tint: "orange",
    sample: "Everyone is long and paying for it. That is the whole reason I am short.",
  },
  {
    key: "trash_talker",
    name: "Trash talker",
    tint: "magenta",
    sample: "You saw the headline a minute after me. I was already filled.",
  },
  {
    key: "deadpan",
    name: "Deadpan",
    tint: "cyan",
    sample: "Long BTC. 25 AUSD. 3×. That is the post.",
  },
  { key: "hype", name: "Hype", tint: "lime", sample: "WE ARE LONG. Full clip. Let it run." },
  {
    key: "professor",
    name: "Professor",
    tint: "amber",
    sample: "Funding at 0.09% with OI up 22% is a crowded trade by any definition. Fading it.",
  },
];

export const ACCENT_OPTIONS: readonly Accent[] = [
  "lime",
  "cyan",
  "amber",
  "orange",
  "magenta",
  "blue",
  "violet",
];

export const AVATAR_PATTERNS = [
  "1001011001101001",
  "1111100110011111",
  "0110100110010110",
  "1010010110100101",
  "1100110000110011",
  "0000011001100000",
] as const;

export const STARTER_CAPS = { perTradeAusd: 5, perDayAusd: 20, maxLeverage: 1 } as const;
export const MIN_START = { ausdMicro: 10_000_000n, monWei: 500_000_000_000_000_000n } as const;
export const MAX_SITES = 20;

/** Core's bounds on the caps (AUSD), so a stepper never reaches a value the API refuses. */
export const SPEND_BOUNDS = {
  perCallAusd: { min: 1, max: 1_000 },
  perDayAusd: { min: 1, max: 10_000 },
} as const;
export const LEVERAGE_BOUNDS = { min: 1, max: 10 } as const;

export const DEFAULT_BRIEF = {
  thesis:
    "Headlines move the selected markets before the order book does. The edge is the 30 to 90 seconds between a credible headline and the first big print.",
  enters:
    "Two of my sources carry the same headline within 60s\nPrice has moved less than 0.3% since the headline\nFunding is not already leaning my way by more than 0.05%",
  exits:
    "+2% take profit or −1% stop, whichever comes first\nFour hours after entry, no matter what\nA second headline contradicts the first",
  never:
    "Trade a headline from a single source\nHold through a funding print\nAdd to a losing position",
} as const;

export interface NewAgentForm {
  markets: string[];
  name: string;
  /** "" follows the name. */
  handle: string;
  voice: VoiceKey | null;
  accent: Accent;
  pattern: number;
  webOn: boolean;
  webMode: WebMode;
  sites: string[];
  thesis: string;
  enters: string;
  exits: string;
  never: string;
  perTrade: number;
  perDay: number;
  leverage: number;
}

export const emptyForm = (): NewAgentForm => ({
  markets: [],
  name: "",
  handle: "",
  voice: null,
  accent: "lime",
  pattern: 0,
  webOn: false,
  webMode: "anywhere",
  sites: [],
  thesis: DEFAULT_BRIEF.thesis,
  enters: DEFAULT_BRIEF.enters,
  exits: DEFAULT_BRIEF.exits,
  never: DEFAULT_BRIEF.never,
  perTrade: STARTER_CAPS.perTradeAusd,
  perDay: STARTER_CAPS.perDayAusd,
  leverage: STARTER_CAPS.maxLeverage,
});

/** The agent's wallet as the screen knows it, in base units; null balances are unread. */
export interface WalletView {
  walletId: string;
  address: string;
  ausdMicro: bigint | null;
  monWei: bigint | null;
}

const slug = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 15);

export const deriveHandle = (name: string, edited = ""): string =>
  edited.trim() ? slug(edited) : slug(name);

/** The handle rule the availability route applies: 3–15 of a–z, 0–9 and _. */
export const validHandle = (handle: string): boolean => /^[a-z0-9_]{3,15}$/.test(handle);

export type HandleState = "empty" | "invalid" | "checking" | "free" | "taken" | "failed";

export function handleState(handle: string, available: boolean | null | "failed"): HandleState {
  if (!handle) {
    return "empty";
  }
  if (!validHandle(handle)) {
    return "invalid";
  }
  if (available === null) {
    return "checking";
  }
  if (available === "failed") {
    return "failed";
  }
  return available ? "free" : "taken";
}

export const lines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export const funded = (wallet: WalletView | null): boolean =>
  wallet !== null &&
  wallet.ausdMicro !== null &&
  wallet.monWei !== null &&
  wallet.ausdMicro >= MIN_START.ausdMicro &&
  wallet.monWei >= MIN_START.monWei;

/** A day's cap below one trade's: the caps contradict each other. */
export const capsInverted = (form: NewAgentForm): boolean => form.perDay < form.perTrade;

/** Any cap moved off the starter caps. */
export const capsEdited = (form: NewAgentForm): boolean =>
  form.perTrade !== STARTER_CAPS.perTradeAusd ||
  form.perDay !== STARTER_CAPS.perDayAusd ||
  form.leverage !== STARTER_CAPS.maxLeverage;

/**
 * Where the wallet sheet starts: at step 2 when an earlier attempt made the wallet and its
 * delegated user is still missing (a cancelled step 2), otherwise at step 1.
 */
export const walletSheetStep = (wallet: WalletView | null, delegated: boolean | null): 1 | 2 =>
  wallet !== null && delegated === false ? 2 : 1;

/** Why "Create" is closed, or that it is open. One rule feeds both the label and the button. */
export type CreateBlock = { ok: true } | { ok: false; label: string };

/**
 * Why the wallet step is shut, or "" when it is open. At the draft limit it is not Create's words:
 * the step is shut because a new wallet would end in a draft the API refuses, so it says what lifts
 * it. Otherwise it is why this workspace cannot create agents at all (`menuAccess`'s `createNote`:
 * research not enabled, or a viewer), so the wallet button never looks open while the API would
 * refuse the person behind it.
 */
export const walletLockNote = (draftLock: string, createNote = ""): string =>
  draftLock ? "You're at the draft limit; open or delete a draft first." : createNote;

/**
 * `draftLock` is the gate's draft-limit note (`home/gate.ts`, the 409 DRAFT_LIMIT's own words), or
 * "". It comes first, as the button's words: nothing on the form can lift it, and the wallet step
 * is shut for the same reason.
 */
export function createBlock(
  form: NewAgentForm,
  handle: HandleState,
  wallet: WalletView | null,
  draftLock = "",
): CreateBlock {
  const derived = deriveHandle(form.name, form.handle);
  const blocked = (label: string): CreateBlock => ({ ok: false, label });
  if (draftLock) {
    return blocked(draftLock);
  }
  if (!form.name.trim()) {
    return blocked("Name it to create");
  }
  if (handle === "taken") {
    return blocked(`@${derived} is taken`);
  }
  if (handle === "invalid" || handle === "empty") {
    return blocked(`@${derived || "handle"} can't be a handle`);
  }
  if (handle === "checking") {
    return blocked(`Checking @${derived}…`);
  }
  if (handle === "failed") {
    return blocked(`Couldn't check @${derived} · try again`);
  }
  if (!form.voice) {
    return blocked("Pick a voice to create");
  }
  if (!form.markets.length) {
    return blocked("Choose trading markets to create");
  }
  if (lines(form.enters).length === 0) {
    return blocked("Write an entry rule to create");
  }
  if (form.webOn && form.webMode === "only" && form.sites.length === 0) {
    return blocked("Name a site for “Only”");
  }
  if (capsInverted(form)) {
    return blocked("Fix the caps to create");
  }
  if (!wallet) {
    return blocked("Create its wallet first");
  }
  if (!funded(wallet)) {
    return blocked("Deposit to create");
  }
  return { ok: true };
}

export function createLabel(
  form: NewAgentForm,
  handle: HandleState,
  wallet: WalletView | null,
  draftLock = "",
): string {
  const block = createBlock(form, handle, wallet, draftLock);
  return block.ok ? `Create ${form.name.trim()}` : block.label;
}

export const canCreate = (
  form: NewAgentForm,
  handle: HandleState,
  wallet: WalletView | null,
  draftLock = "",
): boolean => createBlock(form, handle, wallet, draftLock).ok;

export function footNote(wallet: WalletView | null): string {
  if (!wallet) {
    return "CREATE ITS WALLET FIRST →";
  }
  if (!funded(wallet)) {
    return "FUND ITS WALLET TO CREATE →";
  }
  return "ONE PASSKEY";
}

export function walletTag(wallet: WalletView | null): string {
  if (!wallet) {
    return "STEP 0 · CREATE IT";
  }
  return funded(wallet) ? "FUNDED" : "CREATED · EMPTY";
}

/**
 * The wallet panel's step 0 (canvas "noAgentWallet"): two Touch IDs listed the first time, one
 * later, and step 2 only when an earlier step 1 made the wallet and its step 2 was cancelled.
 */
export function step0Copy(input: { firstTime: boolean; pendingDelegate: boolean }): {
  tag: string;
  note: string;
  steps: { n: string; text: string; done: boolean }[];
  cta: string;
} {
  const steps = (stepOneDone: boolean) => [
    { n: "1", text: "Its wallet, under your passkey", done: stepOneDone },
    { n: "2", text: "Pickler may trade from it · inside the caps · never withdraw", done: false },
  ];
  if (input.pendingDelegate) {
    return {
      tag: "STEP 0 · 1 OF 2 DONE",
      note: "Its wallet is made, under your passkey. One more Touch ID lets Pickler trade from it.",
      steps: steps(true),
      cta: "Let Pickler trade from it · step 2",
    };
  }
  if (input.firstTime) {
    return {
      tag: walletTag(null),
      note: "A wallet that is only its own. Two Touch IDs, back to back, the first time only.",
      steps: steps(false),
      cta: "Create its wallet · 2 signatures",
    };
  }
  return {
    tag: walletTag(null),
    note: "A wallet that is only its own. One Touch ID.",
    steps: [],
    cta: "Create its wallet",
  };
}

/** Under the balances: when they were read, and which minimum is still short. */
export function balanceNote(wallet: WalletView, checkedAt: string): string {
  if (!checkedAt) {
    return "NOT CHECKED YET";
  }
  const read = `LAST CHECKED ${checkedAt}`;
  const ausdShort = (wallet.ausdMicro ?? 0n) < MIN_START.ausdMicro;
  const monShort = (wallet.monWei ?? 0n) < MIN_START.monWei;
  if (ausdShort && monShort) {
    return `${read} · WAITING FOR AUSD AND MON`;
  }
  if (ausdShort) {
    return `${read} · WAITING FOR AUSD`;
  }
  return monShort ? `${read} · WAITING FOR MON` : read;
}

/** The canvas outlines the wallet card when only the money is missing: named, a free handle, a voice. */
export const walletOutlined = (
  form: NewAgentForm,
  handle: HandleState,
  wallet: WalletView | null,
): boolean =>
  Boolean(form.name.trim()) && handle === "free" && form.voice !== null && !funded(wallet);

export type SectionKey = "thesis" | "enters" | "exits" | "never";

/**
 * An advanced section's tag, as the canvas words it: EMPTY, or DEFAULT / EDITED against the loaded
 * default, with the line count for the three rule lists. `edited` lights the tag.
 */
export function sectionTag(key: SectionKey, value: string): { text: string; edited: boolean } {
  if (!value.trim()) {
    return { text: "EMPTY", edited: false };
  }
  const edited = value.trim() !== DEFAULT_BRIEF[key].trim();
  const state = edited ? "EDITED" : "DEFAULT";
  if (key === "thesis") {
    return { text: state, edited };
  }
  const count = lines(value).length;
  return { text: `${count} ${count === 1 ? "LINE" : "LINES"} · ${state}`, edited };
}

/** A base-unit balance from the API (a decimal string, or null when unread). */
export const unitsOf = (value: string | null): bigint | null =>
  value === null ? null : BigInt(value);

/**
 * The agent wallet a reload finds mid-setup: one of the person's with no agent yet, its balances in
 * base units and whether its policies were already approved. Null when there is none.
 *
 * With several unlinked wallets it is the newest, the one the API's `findUnlinkedWallet` reuses
 * (`created_at DESC, wallet_id DESC`). `GET /wallets` lists them oldest first
 * (`listAgentWallets`: `created_at, wallet_id`), so that is the last unlinked one in the list.
 */
export function unlinkedWallet(
  wallets: WalletsDto,
): { wallet: WalletView; policiesApproved: boolean } | null {
  let found: WalletsDto["agents"][number] | undefined;
  for (const agent of wallets.agents) {
    if (agent.agentId === null) {
      found = agent;
    }
  }
  if (!found) {
    return null;
  }
  return {
    wallet: {
      walletId: found.walletId,
      address: found.address,
      ausdMicro: unitsOf(found.ausdMicro),
      monWei: unitsOf(found.monWei),
    },
    policiesApproved: found.policiesApproved,
  };
}

/** What `POST /v1/studio/drafts` is sent. */
export function toDraftRequest(form: NewAgentForm, walletId: string): DraftCreateDto {
  if (!form.voice) {
    throw new Error("A draft needs a voice");
  }
  return {
    name: form.name.trim(),
    handle: deriveHandle(form.name, form.handle),
    voice: form.voice,
    avatar: { accent: form.accent, pattern: form.pattern },
    sources: { web: form.webOn ? { mode: form.webMode, sites: [...form.sites] } : null },
    brief: {
      thesis: form.thesis.trim(),
      entersWhen: lines(form.enters),
      exitsWhen: lines(form.exits),
      never: lines(form.never),
    },
    caps: { perTradeAusd: form.perTrade, perDayAusd: form.perDay, maxLeverage: form.leverage },
    walletId,
    markets: [...form.markets],
  };
}

/** Each token's decimals: AUSD in micro units, MON in wei. */
export const DECIMALS: Record<Token, number> = { AUSD: 6, MON: 18 };

/** A decimal amount in base units, or null when it is not a positive amount the token can hold. */
export function parseAmount(text: string, token: Token): bigint | null {
  const value = text.trim();
  if (!/^\d+(\.\d+)?$/.test(value)) {
    return null;
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > DECIMALS[token]) {
    return null;
  }
  const units =
    BigInt(whole!) * 10n ** BigInt(DECIMALS[token]) +
    BigInt(fraction.padEnd(DECIMALS[token], "0") || "0");
  return units > 0n ? units : null;
}

/** What the transfer routes are sent: the amount trimmed, because the server does not trim. */
export function toTransferBody(input: { from: string; to: string; token: Token; amount: string }): {
  from: string;
  to: string;
  token: Token;
  amount: string;
} {
  return { from: input.from, to: input.to, token: input.token, amount: input.amount.trim() };
}

/** Base units as a short decimal: 1500000 AUSD-micro → "1.5". */
export function formatUnits(units: bigint | null, token: Token): string {
  if (units === null) {
    return "—";
  }
  const scale = 10n ** BigInt(DECIMALS[token]);
  const whole = units / scale;
  const fraction = (units % scale)
    .toString()
    .padStart(DECIMALS[token], "0")
    .slice(0, 4)
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** "0x7a3f…91c2": enough of an address or hash to recognise, not to copy. Short input stays whole. */
export const shortAddress = (address: string): string =>
  address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;

export const patternCells = (index: number): boolean[] =>
  (AVATAR_PATTERNS[index] ?? AVATAR_PATTERNS[0]).split("").map((cell) => cell === "1");

const HOST = /^[a-z0-9.-]+\.[a-z]{2,}$/;

/** What a typed site becomes: a bare host, or null when it is not one. */
export function siteHost(text: string): string | null {
  const host = text
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
  return HOST.test(host) ? host : null;
}

export function siteNote(form: NewAgentForm, draft: string): { text: string; bad: boolean } {
  if (draft.trim() && !siteHost(draft)) {
    return { text: "BARE HOSTNAMES ONLY · NO HTTPS, NO PATHS", bad: true };
  }
  if (draft.trim() && form.sites.includes(siteHost(draft)!)) {
    return { text: "ALREADY LISTED", bad: true };
  }
  if (form.sites.length >= MAX_SITES) {
    return { text: `${MAX_SITES} SITES IS THE LIMIT`, bad: false };
  }
  if (form.webMode === "only" && form.sites.length === 0) {
    return { text: "“ONLY” NEEDS AT LEAST ONE SITE", bad: true };
  }
  return { text: `${form.sites.length} OF ${MAX_SITES} · ENTER TO ADD`, bad: false };
}

/** What a read found that the last one did not: "{delta} AUSD arrived". A decrease is not news. */
export function arrived(
  before: WalletView,
  after: WalletView,
  at: string,
): { text: string; at: string }[] {
  const found: { text: string; at: string }[] = [];
  const check = (token: Token, was: bigint | null, now: bigint | null) => {
    if (was !== null && now !== null && now > was) {
      found.push({ text: `${formatUnits(now - was, token)} ${token} arrived`, at });
    }
  };
  check("AUSD", before.ausdMicro, after.ausdMicro);
  check("MON", before.monWei, after.monWei);
  return found;
}

/**
 * The passkey sheet's words (spec §3.1, D6): the wallet's two steps, " · 1 OF 2" / " · 2 OF 2"
 * only the first time, and the create sheet, which says what is true about the caps.
 */
export function sheetCopy(input: {
  kind: "wallet" | "create";
  step: 1 | 2;
  firstTime: boolean;
  form: NewAgentForm;
}): { title: string; body: string; done: string } {
  const { form } = input;
  const name = form.name.trim();
  if (input.kind === "create") {
    return {
      title: `Create ${name}?`,
      body: `SETS ITS CAPS · ${form.perTrade} / ${form.perDay} AUSD · ${form.leverage}× · IT CAN ONLY TRADE ON PERPL AND CAN'T WITHDRAW · PICKLER HOLDS EVERY TRADE TO THESE CAPS`,
      done: `${name} is yours`,
    };
  }
  if (input.step === 2) {
    return {
      title: "Let Pickler trade from it?",
      body: `INSIDE THE CAPS ONLY · NEVER WITHDRAW${input.firstTime ? " · 2 OF 2" : ""}`,
      done: "Wallet ready",
    };
  }
  return {
    title: name ? `Create ${name}'s wallet?` : "Create its wallet?",
    body: `UNDER YOUR PASSKEY · ONLY THIS AGENT USES IT${input.firstTime ? " · 1 OF 2" : ""}`,
    done: "Wallet ready",
  };
}

/** Where an arrow key moves a radio group's selection (wrapping), or null for any other key. */
export function radioStep(key: string, index: number, count: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
