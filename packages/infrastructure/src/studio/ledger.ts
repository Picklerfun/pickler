import type { Pool } from "pg";
import type { TransferLedgerEntry } from "@pickler/core";

/** `wallets.transfers.amount` is micro-AUSD or wei, by token. */
const DECIMALS = { ausd: 6, mon: 18 } as const;

/** A stored amount in token units, without trailing zeros: 10_000_000 micro-AUSD is "10". */
export function tokenAmount(token: "ausd" | "mon", raw: string | bigint): string {
  const digits = BigInt(raw)
    .toString()
    .padStart(DECIMALS[token] + 1, "0");
  const whole = digits.slice(0, -DECIMALS[token]);
  const fraction = digits.slice(-DECIMALS[token]).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * The person's master ↔ agent transfers for the Master wallet's ledger (studio-draft-dashboard-v1
 * D17), newest first, at most 100. A move into an agent wallet is `to_agent`, anything else
 * `to_master`; the agent is whichever side is an agent wallet, null once no agent holds it.
 */
export async function listTransfers(pool: Pool, userId: string): Promise<TransferLedgerEntry[]> {
  const { rows } = await pool.query<{
    toAgent: boolean;
    token: "ausd" | "mon";
    amount: string;
    agentName: string | null;
    txHash: string;
    at: Date;
  }>(
    `SELECT tw.wallet_id IS NOT NULL AS "toAgent", t.token, t.amount::text AS amount,
       ag.name AS "agentName", t.tx_hash AS "txHash", t.created_at AS at
     FROM wallets.transfers t
     LEFT JOIN wallets.wallets tw ON tw.wallet_id = t.to_wallet_id AND tw.kind = 'agent'
     LEFT JOIN wallets.agent_wallets l
       ON l.wallet_id = CASE WHEN tw.wallet_id IS NOT NULL THEN t.to_wallet_id ELSE t.from_wallet_id END
     LEFT JOIN agents.agents ag ON ag.id = l.agent_id
     WHERE t.user_id = $1
     ORDER BY t.created_at DESC, t.id DESC LIMIT 100`,
    [userId],
  );
  return rows.map((row) => ({
    direction: row.toAgent ? "to_agent" : "to_master",
    token: row.token === "mon" ? "MON" : "AUSD",
    amount: tokenAmount(row.token, row.amount),
    agentName: row.agentName,
    txHash: row.txHash,
    at: row.at,
  }));
}
