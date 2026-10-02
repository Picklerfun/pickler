// apps/web/src/features/studio/new-agent/wallet-reads.ts
/**
 * What the create screen knows about the person's wallets, and how each read changes it. Pure, so
 * the two rules that keep "Create {name}" from asking for the policies twice are pinned in
 * `apps/web/test/studio-new-agent-wallet.test.ts`:
 *
 * - Reads are numbered as they start, and an answer older than the newest one applied (or failed)
 *   is dropped, so a slow read never overwrites a newer one.
 * - Approved policies stay approved for that wallet. A read taken before the approval landed, or a
 *   confirm whose answer was lost, never turns it back to false.
 *
 * No React and no transport; the hook in `use-agent-wallet.ts` holds this state.
 */
import type { WalletsDto } from "@pickler/api-schema";
import { arrived, unlinkedWallet, type WalletView } from "./model";

/** "{delta} {token} arrived", with an id that stays the same while later arrivals are added. */
export interface Arrival {
  /** The read's number and the arrival's place in it: unique, and fixed once made. */
  id: string;
  text: string;
  at: string;
}

export interface WalletReads {
  /** The newest read applied or failed; 0 before any. */
  seq: number;
  wallets: WalletsDto | null;
  /** Whether Pickler's delegated user exists; null until read. */
  delegated: boolean | null;
  /** The unlinked agent wallet this screen is setting up, or null. */
  wallet: WalletView | null;
  /** Wallet ids whose policies are known to be approved. */
  approved: readonly string[];
  arrivals: readonly Arrival[];
  /** When the chain was last read, as the screen shows it. */
  checkedAt: string;
  /** Why the last read failed, or "". Only a read that succeeds clears it. */
  error: string;
}

export const initialReads = (
  staged: { wallets: WalletsDto; wallet: WalletView | null; firstTime: boolean } | null = null,
): WalletReads => ({
  seq: 0,
  wallets: staged?.wallets ?? null,
  delegated: staged ? !staged.firstTime : null,
  wallet: staged?.wallet ?? null,
  approved: [],
  arrivals: [],
  checkedAt: "",
  error: "",
});

/** A read's answer: the wallets, whether the delegated user exists, and the time to show. */
export function applyRead(
  state: WalletReads,
  read: { seq: number; wallets: WalletsDto; delegated: boolean; at: string },
): WalletReads {
  if (read.seq <= state.seq) {
    return state;
  }
  const found = unlinkedWallet(read.wallets);
  const news =
    state.wallet && found && state.wallet.walletId === found.wallet.walletId
      ? arrived(state.wallet, found.wallet, read.at).map((news, index): Arrival => ({
          id: `${read.seq}-${index}`,
          ...news,
        }))
      : [];
  const approved =
    found && found.policiesApproved && !state.approved.includes(found.wallet.walletId)
      ? [...state.approved, found.wallet.walletId]
      : state.approved;
  return {
    ...state,
    seq: read.seq,
    wallets: read.wallets,
    delegated: read.delegated,
    wallet: found?.wallet ?? null,
    approved,
    arrivals: news.length ? [...news, ...state.arrivals] : state.arrivals,
    checkedAt: read.at,
    error: "",
  };
}

/** A read that failed. Older than the newest read, it says nothing. */
export function failRead(state: WalletReads, read: { seq: number; message: string }): WalletReads {
  if (read.seq <= state.seq) {
    return state;
  }
  return { ...state, seq: read.seq, error: read.message };
}

/** The policies were confirmed for this wallet. */
export function markApproved(state: WalletReads, walletId: string): WalletReads {
  return state.approved.includes(walletId)
    ? state
    : { ...state, approved: [...state.approved, walletId] };
}

/** The wallet ceremony finished: the delegated user exists. */
export const markDelegated = (state: WalletReads): WalletReads =>
  state.delegated === true ? state : { ...state, delegated: true };

export const policiesApproved = (state: WalletReads): boolean =>
  state.wallet !== null && state.approved.includes(state.wallet.walletId);
