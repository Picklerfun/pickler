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
  const rows = await readTokenRows(database, [agentId], chainId);
  if (rows.length > 1) {
    throw new Error("Ambiguous agent token projection");
  }
  const row = rows[0];
  if (row?.confirmed) {
    return { token: toToken(row, chainId), pending: false };
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

interface TokenRow {
  agentId: string;
  name: string;
  ticker: string;
  address: string;
  confirmed: boolean;
  imageUri: string | null;
  accent: Accent | null;
  pattern: number | null;
}

function toToken(row: TokenRow, chainId: 143 | 10143): AgentToken {
  return {
    name: row.name,
    ticker: row.ticker,
    address: row.address,
    chainId,
    imageUri: row.imageUri,
    avatar: { accent: row.accent ?? "lime", pattern: row.pattern ?? 0 },
  };
}

/** One canonical read for the public directory; no provider calls or per-agent queries. */
export async function readConfirmedAgentTokens(
  database: Pool | PoolClient,
  agentIds: string[],
  chainId: number | null,
): Promise<Map<string, AgentToken>> {
  const tokens = new Map<string, AgentToken>();
  if (chainId === null || agentIds.length === 0) {
    return tokens;
  }
  if (chainId !== 143 && chainId !== 10143) {
    throw new Error("Unsupported agent-token network");
  }
  const rows = await readTokenRows(database, agentIds, chainId);
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.agentId)) {
      throw new Error("Ambiguous agent token projection");
    }
    seen.add(row.agentId);
    if (row.confirmed) {
      tokens.set(row.agentId, toToken(row, chainId));
    }
  }
  return tokens;
}

async function readTokenRows(
  database: Pool | PoolClient,
  agentIds: string[],
  chainId: 143 | 10143,
): Promise<TokenRow[]> {
  const result = await database.query<TokenRow>(
    `
    SELECT t.agent_id AS "agentId",t.name,t.ticker,t.address,t.image_uri AS "imageUri",
      COALESCE(frozen.payload->'avatar'->>'accent',frozen.params->'avatar'->>'accent','lime') AS accent,
      COALESCE((frozen.payload->'avatar'->>'pattern')::int,(frozen.params->'avatar'->>'pattern')::int,0) AS pattern,EXISTS (
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
    FROM market.tokens t LEFT JOIN LATERAL (
      SELECT g.payload,d.params FROM launch.grants g JOIN launch.drafts d ON d.id=g.draft_id
      JOIN market.chain_events e ON e.chain=g.chain AND e.emitter=g.factory AND e.tx_hash=t.launch_tx_hash AND e.event_name='LaunchCreated'
      WHERE g.agent_id=t.agent_id AND g.chain=t.chain AND lower(g.payload->'params'->>'metadataHash')=lower(e.decoded->>'metadataHash')
        AND lower(g.payload->'params'->>'creator')=lower(e.decoded->>'creator')
        AND lower(g.payload->'params'->>'expectedConfigHash')=lower(e.decoded->>'presetHash')
      ORDER BY g.created_at LIMIT 1
    ) frozen ON true WHERE t.agent_id=ANY($1::uuid[]) AND t.chain=$2
      AND t.status IN ('pre_graduation','graduated') AND t.address IS NOT NULL
    ORDER BY t.agent_id,t.launched_at DESC,t.id`,
    [agentIds, `eip155:${chainId}`],
  );
  return result.rows;
}
