import type { Pool, PoolClient } from "pg";
import type { AgentToken, Accent } from "@pickler/core";

/** A browser receipt is never a source. An orphaned or unconfirmed projection is pending. */
export async function readAgentToken(
  database: Pool | PoolClient,
  agentId: string,
  chainId: number | null,
): Promise<{ token: AgentToken | null; pending: boolean }> {
  if (chainId === null) {
    return { token: null, pending: false };
  }
  if (chainId !== 143 && chainId !== 10143) {
    throw new Error("Unsupported agent-token network");
  }
  const chain = `eip155:${chainId}`;
  const result = await database.query<{
    name: string;
    ticker: string;
    address: string;
    confirmed: boolean;
    accent: Accent | null;
    pattern: number | null;
  }>(
    `
    SELECT t.name,t.ticker,t.address,p.accent,p.avatar_pattern AS pattern,EXISTS (
      SELECT 1 FROM market.chain_events e JOIN market.chain_blocks b ON b.chain=e.chain AND b.hash=e.block_hash
      JOIN launch.agent_keys k ON k.agent_id=t.agent_id AND k.chain=e.chain AND k.agent_key=lower(e.decoded->>'agentKey')
      JOIN launch.grants g ON g.agent_id=k.agent_id AND g.chain=k.chain AND g.factory=lower(e.emitter)
      WHERE e.chain=t.chain AND e.tx_hash=t.launch_tx_hash AND e.event_name='LaunchCreated'
        AND NOT e.orphaned AND NOT b.orphaned AND b.finality IN ('confirmed','finalized')
        AND lower(e.decoded->>'token')=lower(t.address)
        AND lower(g.payload->'params'->>'creator')=lower(e.decoded->>'creator')
        AND lower(g.payload->'params'->>'metadataHash')=lower(e.decoded->>'metadataHash')
        AND lower(g.payload->'params'->>'expectedConfigHash')=lower(e.decoded->>'presetHash')
        AND date_trunc('second',g.created_at) <= b.block_time AND g.expires_at >= b.block_time
    ) AS confirmed
    FROM market.tokens t LEFT JOIN agents.agent_profiles p ON p.agent_id=t.agent_id WHERE t.agent_id=$1 AND t.chain=$2
      AND t.status IN ('pre_graduation','graduated') AND t.address IS NOT NULL
    ORDER BY t.launched_at DESC,t.id LIMIT 2`,
    [agentId, chain],
  );
  if (result.rows.length > 1) {
    throw new Error("Ambiguous agent token projection");
  }
  const row = result.rows[0];
  if (row?.confirmed) {
    return {
      token: {
        name: row.name,
        ticker: row.ticker,
        address: row.address,
        chainId,
        imageUri: null,
        avatar: { accent: row.accent ?? "lime", pattern: row.pattern ?? 0 },
      },
      pending: false,
    };
  }
  const pending = await database.query(
    `
    SELECT 1 FROM launch.agent_keys k JOIN market.chain_events e ON e.chain=k.chain AND lower(e.decoded->>'agentKey')=k.agent_key
    JOIN market.chain_blocks b ON b.chain=e.chain AND b.hash=e.block_hash
    JOIN launch.grants g ON g.agent_id=k.agent_id AND g.chain=k.chain AND g.factory=lower(e.emitter)
    WHERE k.agent_id=$1 AND k.chain=$2 AND e.event_name='LaunchCreated' AND NOT e.orphaned AND NOT b.orphaned
      AND lower(g.payload->'params'->>'creator')=lower(e.decoded->>'creator')
      AND lower(g.payload->'params'->>'metadataHash')=lower(e.decoded->>'metadataHash')
      AND lower(g.payload->'params'->>'expectedConfigHash')=lower(e.decoded->>'presetHash')
      AND date_trunc('second',g.created_at) <= b.block_time AND g.expires_at >= b.block_time
    LIMIT 1`,
    [agentId, chain],
  );
  return { token: null, pending: !!row || !!pending.rowCount };
}
