/**
 * The MARKETPLACE and YOU sections' own rules (studio-live-v1 L17–L21) beyond what `model.ts`
 * already builds: which state a lazy read is in, the shut buttons' reasons and words, the live
 * canvas's allocation, the account's tabs as a keyboard moves through them, the passkey card's tag
 * and a staged account's profile. Pure, pinned in `apps/web/test/studio-live-market.test.ts`.
 */
import type { WalletsDto } from "@pickler/api-schema";
import type { ProfileDto } from "../../auth/lib/pickler-api";
import { formatUnits, unitsOf } from "../new-agent/model";
import type { AllocationRow } from "../shell/wallet-model";
import type { LiveRead } from "./use-live";

/** What a section draws for one of its reads. */
export type ReadState = "loading" | "failed" | "empty" | "preview" | "ready";

/**
 * A live read's state: `failed` says so with Retry; null is still reading, except in a preview
 * studio, which reads nothing and so has nothing to wait for: it says it is a preview
 * (`PREVIEW_NOTE`), never that the list is empty. An empty list is empty.
 */
export function readState<T>(
  read: LiveRead<T>,
  preview: boolean,
  isEmpty: (value: T) => boolean,
): ReadState {
  if (read === "failed") {
    return "failed";
  }
  if (read === null) {
    return preview ? "preview" : "loading";
  }
  return isEmpty(read) ? "empty" : "ready";
}

/** Why each shut marketplace button is shut (draft spec D19: nothing promises what isn't built). */
export const SHUT = {
  ask: "Paid reads are not open yet.",
  back: "Agent tokens are not launched yet.",
  launch: "The token launcher is not deployed yet.",
  trade: "Trading from your master wallet comes with live Perpl trading.",
  sessions: "Other signed-in devices cannot be listed yet.",
  toggle: "Nothing stores this preference yet.",
  notify: "Notices to owners are not built yet.",
} as const;

/** The marketplace reads' words: loading, failed and empty, per section. */
export const READ_WORDS = {
  agents: {
    loading: "Reading the directory…",
    failed: "Couldn't read the directory.",
    empty: "No public agents yet.",
  },
  markets: {
    loading: "Reading Perpl…",
    failed: "Couldn't read Perpl.",
    empty: "Perpl has no open markets right now.",
  },
  leaders: {
    loading: "Reading the leaderboard…",
    failed: "Couldn't read the leaderboard.",
    empty: "No agent has a resolved record yet.",
  },
} as const;

/**
 * An agent card's second shut button (canvas `a.cta`): the owner's own agent has no token to back,
 * so it reads "Launch its token" (shut, `SHUT.launch`); any other "Back it" (`SHUT.back`).
 */
export const backLabel = (own: boolean): string => (own ? "Launch its token" : "Back it");

/** Why the card's second button is shut: the launcher for the owner's agent, a token otherwise. */
export const backReason = (own: boolean): string => (own ? SHUT.launch : SHUT.back);

/** The leaderboard's shut Ask: its DTO carries no read price, so no price is printed. */
export const LEADER_ASK = "Ask";

/**
 * Wallets' master card allocation, as the live canvas draws it: what this agent's wallet holds
 * (dashes until `GET /wallets` is read; a flat agent has nothing in positions, so it is all free),
 * then AI credits, drawn Soon. An agent without a wallet has only the credits row.
 */
export function liveAllocation(
  wallets: WalletsDto | null,
  agent: { name?: string | undefined; wallet: { walletId: string } | null },
): AllocationRow[] {
  const rows: AllocationRow[] = [];
  if (agent.wallet) {
    const walletId = agent.wallet.walletId;
    const read = wallets?.agents.find((entry) => entry.walletId === walletId) ?? null;
    const ausd = read ? unitsOf(read.ausdMicro) : null;
    rows.push({
      key: walletId,
      label: agent.name ? `In ${agent.name}'s wallet` : "In its wallet",
      value: ausd === null ? "—" : `${formatUnits(ausd, "AUSD")} AUSD`,
      kind: "agent",
      soon: false,
    });
  }
  rows.push({ key: "credits", label: "AI credits", value: "Soon", kind: "credits", soon: true });
  return rows;
}

/**
 * The passkey card's line (canvas 708, honest): the passkey signs the moves of money that exist
 * today. Caps are saved, not signed (L12), and closing positions and marketplace buys are not built.
 */
export const PASSKEY_NOTE =
  "Your passkey signs every move of money: funding an agent and pulling it back. No seed phrase exists.";

/**
 * A staged or preview studio reads no profile: Public profile draws the account the stage names,
 * made the day the stage's clock reads. Null without a handle.
 */
export function stagedProfile(handle: string | null, now: number): ProfileDto | null {
  if (!handle) {
    return null;
  }
  return {
    user_id: "staged",
    display_name: handle,
    handle,
    created_at: new Date(now).toISOString(),
  };
}

/**
 * The tab a key moves to in a tablist (WAI-ARIA tabs): ArrowRight and ArrowLeft step and wrap,
 * Home and End jump; any other key moves nowhere (null).
 */
export function tabAfter<T extends string>(keys: readonly T[], current: T, key: string): T | null {
  const index = keys.indexOf(current);
  if (index < 0 || keys.length === 0) {
    return null;
  }
  switch (key) {
    case "ArrowRight":
      return keys[(index + 1) % keys.length] ?? null;
    case "ArrowLeft":
      return keys[(index - 1 + keys.length) % keys.length] ?? null;
    case "Home":
      return keys[0] ?? null;
    case "End":
      return keys[keys.length - 1] ?? null;
    default:
      return null;
  }
}

/** The passkey card's tag: "ACTIVE · 2 DEVICES" from the list that was read, never a guess. */
export function passkeyTag(
  read: { kind: "loading" } | { kind: "failed" } | { kind: "ready"; passkeys: readonly unknown[] },
): string {
  if (read.kind === "loading") {
    return "READING…";
  }
  if (read.kind === "failed") {
    return "UNREAD";
  }
  const count = read.passkeys.length;
  if (count === 0) {
    return "NONE YET";
  }
  return `ACTIVE · ${count} ${count === 1 ? "DEVICE" : "DEVICES"}`;
}
