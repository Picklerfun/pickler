import type { Pool } from "pg";
import type { TokenMarketDto, TradeDto } from "@pickler/api-schema";
import {
  tokenCurveMarket,
  tokenFdvWad,
  tokenTradePriceWad,
  type TokenReferenceEconomics,
} from "@pickler/core";
import type { tokens } from "./market.js";

export interface TokenMarketProfile {
  chain: string;
  factory: string;
  configHash: string;
  economics: TokenReferenceEconomics;
}
interface Observation {
  at: string;
  block: string;
  decoded: Record<string, string>;
  eventName: "CurveBought" | "CurveSold";
  txHash: string;
  logIndex: number;
}
interface MarketRow {
  launch: { at: string; block: string; factory: string; decoded: Record<string, string> };
  latest: Observation | null;
  history: Observation[];
  recent: Observation[];
  volume: string;
  windowEnd: Date;
  activityCount: string;
}

/** One database snapshot. No provider, cursor movement, trade preparation or balance inference. */
export async function readTokenMarket(
  pool: Pool,
  token: typeof tokens.$inferSelect,
  profile?: TokenMarketProfile,
): Promise<TokenMarketDto | null> {
  const result = await pool.query<MarketRow>(
    `
    WITH launch AS (
      SELECT e.decoded,e.emitter,b.block_time,e.block_number
      FROM market.chain_events e
      JOIN market.chain_blocks b ON b.chain=e.chain AND b.hash=e.block_hash
      WHERE e.chain=$1 AND e.tx_hash=$2 AND e.event_name='LaunchCreated'
        AND lower(e.decoded->>'token')=$3 AND NOT e.orphaned AND NOT b.orphaned
        AND b.finality IN ('confirmed','finalized')
      ORDER BY e.block_number DESC,e.log_index DESC LIMIT 1
    ), activity AS (
      SELECT e.*,b.block_time,
        jsonb_build_object('at',b.block_time,'block',e.block_number::text,'decoded',e.decoded,
          'eventName',e.event_name,'txHash',e.tx_hash,'logIndex',e.log_index) AS observation
      FROM market.chain_events e
      JOIN market.chain_blocks b ON b.chain=e.chain AND b.hash=e.block_hash
      JOIN launch l ON lower(l.decoded->>'curve')=e.emitter
      WHERE e.chain=$1 AND e.event_name IN ('CurveBought','CurveSold')
        AND NOT e.orphaned AND NOT b.orphaned AND b.finality IN ('confirmed','finalized')
        AND e.block_number>=l.block_number
    ), hourly AS (
      SELECT DISTINCT ON (date_trunc('hour',block_time)) * FROM activity
      WHERE block_time>=now()-interval '7 days'
      ORDER BY date_trunc('hour',block_time),block_number DESC,log_index DESC
    )
    SELECT now() AS "windowEnd",jsonb_build_object('at',l.block_time,'block',l.block_number::text,
        'factory',l.emitter,'decoded',l.decoded) AS launch,
      (SELECT observation FROM activity ORDER BY block_number DESC,log_index DESC LIMIT 1) AS latest,
      coalesce((SELECT jsonb_agg(observation ORDER BY block_number,log_index) FROM hourly),'[]'::jsonb) AS history,
      coalesce((SELECT jsonb_agg(observation ORDER BY block_number DESC,log_index DESC)
        FROM (SELECT * FROM activity ORDER BY block_number DESC,log_index DESC LIMIT 20) r),'[]'::jsonb) AS recent,
      coalesce((SELECT sum(CASE WHEN event_name='CurveBought' THEN (decoded->>'grossQuoteIn')::numeric
        ELSE (decoded->>'netQuoteOut')::numeric+(decoded->>'totalFee')::numeric END)::text
        FROM activity WHERE block_time>=now()-interval '24 hours' AND block_time<=now()),'0') AS volume,
      (SELECT count(*)::text FROM activity WHERE block_time>=now()-interval '7 days') AS "activityCount"
    FROM launch l
  `,
    [token.chain, token.launchTxHash, token.address],
  );
  const row = result.rows[0];
  if (
    !row ||
    token.decimals === null ||
    token.quoteDecimals === null ||
    token.decimals > 18 ||
    token.quoteDecimals > 18
  ) {
    return null;
  }
  const terms =
    profile &&
    profile.chain === token.chain &&
    profile.factory.toLowerCase() === row.launch.factory.toLowerCase() &&
    profile.configHash.toLowerCase() === row.launch.decoded.presetHash?.toLowerCase() &&
    profile.economics.quoteAddress.toLowerCase() === token.quoteAddress &&
    profile.economics.totalSupply === token.totalSupply &&
    token.decimals === 18 &&
    token.quoteDecimals === 6
      ? profile.economics
      : null;
  function trade(observation: Observation): TradeDto & { priceWad: string } {
    const d = observation.decoded;
    const side: TradeDto["side"] = observation.eventName === "CurveBought" ? "buy" : "sell";
    const amounts = {
      side,
      tokenAmount: side === "buy" ? d.tokensOut! : d.tokensIn!,
      quoteAmount: side === "buy" ? d.grossQuoteIn! : d.netQuoteOut!,
      feeAmount: d.totalFee!,
    };
    return {
      ...amounts,
      trader: side === "buy" ? d.recipient! : d.seller!,
      blockTime: observation.at,
      blockNumber: observation.block,
      txHash: observation.txHash,
      logIndex: observation.logIndex,
      priceWad: tokenTradePriceWad({
        ...amounts,
        tokenDecimals: token.decimals!,
        quoteDecimals: token.quoteDecimals!,
      }),
    };
  }
  const snapshot = row.latest;
  const netSold = snapshot?.decoded.netSoldAfter ?? (terms ? "0" : null);
  const reserve = snapshot?.decoded.reserveAfter ?? (terms ? "0" : null);
  const curve = terms && netSold !== null ? tokenCurveMarket(terms, netSold) : null;
  const lastTrade = snapshot ? trade(snapshot) : null;
  const priceWad = curve?.priceWad ?? lastTrade?.priceWad ?? null;
  // Hourly samples keep long windows bounded; recent receipts retain intrahour movement.
  const observations = new Map<string, Observation>();
  for (const observation of [...row.history, ...row.recent, ...(snapshot ? [snapshot] : [])]) {
    observations.set(`${observation.txHash}:${observation.logIndex}`, observation);
  }
  const ordered = [...observations.values()].sort((a, b) => {
    const delta = BigInt(a.block) - BigInt(b.block);
    return delta < 0n ? -1 : delta > 0n ? 1 : a.logIndex - b.logIndex;
  });
  const history = ordered.map((observation) => ({
    at: observation.at,
    priceWad: terms
      ? tokenCurveMarket(terms, observation.decoded.netSoldAfter!).priceWad
      : trade(observation).priceWad,
  }));
  if (terms) {
    // Keep the real launch price after the first trade instead of dropping its chart anchor.
    history.unshift({ at: row.launch.at, priceWad: tokenCurveMarket(terms, "0").priceWad });
  }
  const recentWindow = ordered.filter(
    (point) => Date.parse(point.at) >= row.windowEnd.getTime() - 604_800_000,
  ).length;

  return {
    version: 1,
    tokenDecimals: token.decimals,
    priceKind: curve ? "curve" : lastTrade ? "last_trade" : "unavailable",
    priceWad,
    fdvWad:
      priceWad !== null && token.totalSupply !== null
        ? tokenFdvWad(priceWad, token.totalSupply, token.decimals)
        : null,
    volume24h: row.volume,
    windowEnd: row.windowEnd.toISOString(),
    observedAt: snapshot?.at ?? row.launch.at,
    observedBlock: snapshot?.block ?? row.launch.block,
    netSold,
    realQuoteReserve: reserve,
    remainingTokens: curve?.remainingTokens ?? null,
    progressBps: curve?.progressBps ?? null,
    terms: terms
      ? {
          totalSupply: terms.totalSupply,
          saleAllocation: terms.saleAllocation,
          lpAllocation: terms.lpAllocation,
          buyFeeBps: terms.buyFeeBps,
          sellFeeBps: terms.sellFeeBps,
        }
      : null,
    history: history.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-721),
    historyTruncated: BigInt(row.activityCount) > BigInt(recentWindow),
    recentTrades: row.recent.map(trade),
  };
}
