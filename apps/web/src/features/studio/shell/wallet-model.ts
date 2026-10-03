/**
 * Master wallet's rules shared by the draft and the live studio (studio-draft-dashboard-v1 D17,
 * studio-live-v1 L20): the shape of an allocation row, which each studio builds for its own canvas,
 * and the ledger of the person's transfers. Pure, pinned in
 * `apps/web/test/studio-draft-model.test.ts`.
 */
import { formatUnits, parseAmount } from "../new-agent/model";
import { stamp } from "./clock";

/** Why a view-only member's move of money is shut (Fund, Pull back), in both studios. */
export const VIEW_ONLY_FUNDS = "View-only: ask an owner to move funds.";

export interface AllocationRow {
  /** `master`, an agent wallet's id, or the studio's own keys for what is not a wallet. */
  key: string;
  label: string;
  value: string;
  /** The dot: master lime, an agent's wallet its own, positions blue, credits violet. */
  kind: "master" | "agent" | "positions" | "credits";
  /** Not built yet (spec D17): drawn as "Soon", never as a number. */
  soon: boolean;
}

export interface LedgerRow {
  key: string;
  text: string;
  sub: "MASTER → AGENT" | "AGENT → MASTER";
  /** "+10 AUSD" back into master, "−10 AUSD" out of it. */
  amount: string;
  /** Money back into master: the canvas draws the amount lime. */
  toMaster: boolean;
  /** The agent the transfer moved money for: its dot is that agent's accent, either way. */
  agentName: string | null;
  /** "hh:mm" today, the day ("OCT 1") before it, in local time. */
  at: string;
  iso: string;
}

/**
 * Master wallet's ledger (spec D17): the person's transfers from `GET /wallets/ledger` as the
 * canvas words them, from master's side, so a move to an agent is money out and one back is money
 * in. An amount that is not a plain decimal is shown as the server sent it.
 */
export function ledgerRows(
  entries: readonly {
    direction: "to_agent" | "to_master";
    token: "AUSD" | "MON";
    amount: string;
    agentName: string | null;
    txHash: string;
    at: string;
  }[],
  now: Date,
): LedgerRow[] {
  return entries.map((entry, index) => {
    const toMaster = entry.direction === "to_master";
    const name = entry.agentName ? `${entry.agentName}'s wallet` : "its wallet";
    const units = parseAmount(entry.amount, entry.token);
    const amount = units === null ? entry.amount : formatUnits(units, entry.token);
    return {
      key: `${entry.txHash}-${index}`,
      text: toMaster ? `Back from ${name}` : `To ${name}`,
      sub: toMaster ? "AGENT → MASTER" : "MASTER → AGENT",
      amount: `${toMaster ? "+" : "−"}${amount} ${entry.token}`,
      toMaster,
      agentName: entry.agentName,
      at: stamp(new Date(entry.at), now),
      iso: entry.at,
    };
  });
}
