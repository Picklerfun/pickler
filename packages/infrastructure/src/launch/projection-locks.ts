import type { PoolClient } from "pg";

/** Lock only the evidence used by position reconciliation; never return the header history. */
export async function lockCanonicalGraduationBlocks(
  client: PoolClient,
  venue: "uniswap" | "kuru",
): Promise<number> {
  const table = venue === "uniswap" ? "market.uniswap_graduations" : "market.kuru_graduations";
  const result = await client.query<{ count: string }>(`
    SELECT count(*) FROM (
      SELECT b.hash FROM market.chain_blocks b
      WHERE b.chain='eip155:10143' AND NOT b.orphaned
        AND EXISTS (SELECT 1 FROM ${table} g
                    WHERE g.chain=b.chain AND g.block_hash=b.hash)
      FOR SHARE OF b
    ) locked
  `);
  return Number(result.rows[0]!.count);
}
