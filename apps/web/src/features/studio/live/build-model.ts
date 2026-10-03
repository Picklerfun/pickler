/**
 * The live studio's BUILD sections (docs/specs/studio-live-v1.md L9–L16): what Brief, Sources &
 * rules, Limits and Controls draw beyond `model.ts` (which already words the caps and the entry
 * notes so that none of them promises what the Perpl runtime will do, draft spec D19): the brief's
 * tags against its version, the plugins, the stops, the wallet card's balances, the entry form and
 * why a shut control is shut.
 *
 * Pure, no React and no transport; pinned in `apps/web/test/studio-live-build.test.ts`.
 */
import { formatUnits } from "../new-agent/model";
import type { BriefKey, BriefView } from "../shell/build-model";
import { VIEW_ONLY_FUNDS } from "../shell/wallet-model";
import { GAS_LOW_WEI, type LiveCaps, type LiveEntry, type LiveWalletRead } from "./model";

/** What `PUT /setup` takes as `caps`: the five, as they are. */
export const capsPatch = (caps: LiveCaps): LiveCaps => ({
  perTradeAusd: caps.perTradeAusd,
  perDayAusd: caps.perDayAusd,
  maxLeverage: caps.maxLeverage,
  maxOpenPositions: caps.maxOpenPositions,
  dayLossStopAusd: caps.dayLossStopAusd,
});

// ─── Brief ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Each brief section's tag on a public agent (the canvas's `sections`): the line count, then
 * EDITED, or the version it runs on (`V4`) where the shell's draft tag says DEFAULT.
 */
export function liveBriefTags(
  tags: BriefView["tags"],
  version: number,
): Record<BriefKey, { text: string; edited: boolean }> {
  const said = (tag: { text: string; edited: boolean }) => ({
    text: tag.text.replace(/DEFAULT$/, `V${version}`),
    edited: tag.edited,
  });
  return {
    thesis: said(tags.thesis),
    enters: said(tags.enters),
    exits: said(tags.exits),
    never: said(tags.never),
  };
}

// ─── Sources & rules ───────────────────────────────────────────────────────────────────────────

export interface PluginRow {
  key: "perpl" | "web" | "x" | "oi";
  name: string;
  note: string;
  /** The tools it gives, as the canvas's title. */
  tools: string;
  /** Perpl is fixed, the web a switch, the other two shut. */
  kind: "fixed" | "switch" | "soon";
  on: boolean;
  /** The small line under the note: ALWAYS ON, ON / OFF, SOON. */
  line: string;
}

/** IT READS (spec L15): Perpl fixed, the web a switch, X feeds and Open interest shut, Soon. */
export function pluginRows(webOn: boolean): PluginRow[] {
  return [
    {
      key: "perpl",
      name: "Perpl",
      note: "Markets, books, funding, candles · Monad",
      tools:
        "listPerpMarkets · getPerpSnapshot · getPerpOrderBook · getPerpCandles · getPerpFundingHistory",
      kind: "fixed",
      on: true,
      line: "ALWAYS ON",
    },
    {
      key: "web",
      name: "Web",
      note: "Search and page reads via Exa",
      tools: "searchWeb · readPage",
      kind: "switch",
      on: webOn,
      line: webOn ? "ON" : "OFF",
    },
    {
      key: "x",
      name: "X feeds",
      note: "The accounts named in the brief",
      tools: "readTimeline · readPost",
      kind: "soon",
      on: false,
      line: "SOON",
    },
    {
      key: "oi",
      name: "Open interest",
      note: "Coinglass · OI, liquidations",
      tools: "getOpenInterest · getLiquidations",
      kind: "soon",
      on: false,
      line: "SOON",
    },
  ];
}

/** IT READS' tag: how many sources are on (Perpl, and the web when it is). */
export const pluginCount = (webOn: boolean): string => `${webOn ? 2 : 1} ON`;

// ─── Controls ──────────────────────────────────────────────────────────────────────────────────

export interface StopRow {
  key: "pause" | "stop" | "auto";
  name: string;
  note: string;
  /** Pause entries' real control, or the tag of a stop that is not built. */
  action: { kind: "button"; label: "Pause" | "Resume" } | { kind: "tag"; label: string };
}

/**
 * STOPS (spec L13): "Pause entries" is real (no passkey) and reads Resume while paused; "Stop ·
 * close all" closes positions, which needs live trading, so it is shut with Soon; Auto-pause is
 * what the runtime will do, tagged WITH THE RUNTIME.
 */
export function stopRows(paused: boolean): StopRow[] {
  return [
    {
      key: "pause",
      name: "Pause entries",
      note: "No new positions; closing its own stays allowed. One click, no passkey.",
      action: { kind: "button", label: paused ? "Resume" : "Pause" },
    },
    {
      key: "stop",
      name: "Stop · close all",
      note: "Closing every position at market and stopping comes with live trading.",
      action: { kind: "tag", label: "SOON" },
    },
    {
      key: "auto",
      name: "Auto-pause",
      note: "It will pause itself when it hits the day-loss stop, runs out of gas or credits, or loses Perpl for more than 2 minutes.",
      action: { kind: "tag", label: "WITH THE RUNTIME" },
    },
  ];
}

/** The entry as `PUT /setup` takes it, the small amount as the stepper shows it (1..per trade). */
export function entryPatch(form: LiveEntry, perTradeAusd: number): LiveEntry {
  return {
    mode: form.mode,
    meanwhile: form.meanwhile,
    smallAusd: Math.max(1, Math.min(form.smallAusd, perTradeAusd)),
  };
}

/** The entry form saves to something other than what is saved. */
export function entryDirty(form: LiveEntry, saved: LiveEntry, perTradeAusd: number): boolean {
  const now = entryPatch(form, perTradeAusd);
  const was = entryPatch(saved, perTradeAusd);
  return (
    now.mode !== was.mode || now.meanwhile !== was.meanwhile || now.smallAusd !== was.smallAusd
  );
}

// ─── Limits: its wallet ────────────────────────────────────────────────────────────────────────

export interface LimitsWalletView {
  free: string;
  /** Nothing is in positions before the runtime. */
  inPositions: string;
  mon: string;
  gasLow: boolean;
  /** "Pull free AUSD back" opens only with free AUSD to pull. */
  canPull: boolean;
}

/** ITS WALLET (spec L12): AUSD · FREE, AUSD · IN POSITIONS (0), MON · GAS; dashes unread. */
export function limitsWallet(read: LiveWalletRead | null): LimitsWalletView {
  const ausd = read?.ausdMicro ?? null;
  const mon = read?.monWei ?? null;
  return {
    free: formatUnits(ausd, "AUSD"),
    inPositions: "0",
    mon: formatUnits(mon, "MON"),
    gasLow: mon !== null && mon < GAS_LOW_WEI,
    canPull: ausd !== null && ausd > 0n,
  };
}

// ─── Why a control is shut ─────────────────────────────────────────────────────────────────────

/** A view-only member's reason on every write of the live studio. */
export const VIEW_ONLY_REASON = "View-only: ask an owner to change this.";

/** A view-only member's reason on a move of money (Fund, Pull back): the shell's, for both studios. */
export { VIEW_ONLY_FUNDS };

/** "Pull free AUSD back" with nothing free in its wallet. */
export const NO_FREE_AUSD = "No free AUSD to pull back.";

/** Why "Pull free AUSD back" is shut, or null when it opens: view-only first, then the balance. */
export function pullReason(canManage: boolean, canPull: boolean): string | null {
  if (!canManage) {
    return VIEW_ONLY_FUNDS;
  }
  return canPull ? null : NO_FREE_AUSD;
}
