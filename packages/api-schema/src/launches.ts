// Agent token launches, as the public API serves them.
//
// Three rules the rest of this file follows, each because the alternative loses information
// silently:
//
// - Every amount is a decimal string in base units, never a number. A uint256 does not fit a
//   double, and a token with 18 decimals loses precision long before it overflows.
// - Every asset identity carries its chain. An address alone names nothing: the same address
//   holds different contracts on different chains, which Permit2 on Monad demonstrates.
// - Every read says how fresh it is. A projection can lag or be rebuilding, and a client that
//   cannot tell a current answer from a stale one will present both the same way.

/** CAIP-2, e.g. `eip155:10143`. */
export type ChainIdDto = string;

/** How much a caller should trust what they were just handed. */
export interface FreshnessDto {
  /** The block the projection had reached when this was read. */
  asOfBlock: string | null;
  asOfBlockHash: string | null;
  /** When the indexer last wrote, ISO-8601 UTC. */
  indexedAt: string | null;
  /** observed | confirmed | finalized, under the policy measured for this chain. */
  finality: "observed" | "confirmed" | "finalized" | "unknown";
  /**
   * True when the projection is behind far enough that a caller should say so.
   *
   * Not an error: a stale read is still the best answer available. It is a fact the interface
   * has to be able to show rather than quietly presenting old data as current.
   */
  stale: boolean;
}

/** A read, and how fresh it is. Reads are never returned bare. */
export interface ReadDto<T> extends FreshnessDto {
  data: T;
  /** Opaque; absent when there is no further page. */
  nextCursor?: string;
}

export type LaunchPhaseDto = "reserved" | "launching" | "pre_graduation" | "graduated" | "failed";

export interface AssetDto {
  chainId: ChainIdDto;
  address: string;
  symbol: string | null;
  decimals: number;
}

export interface LaunchSummaryDto {
  /** Opaque, and resolves unambiguously to a chain and an address. */
  id: string;
  chainId: ChainIdDto;
  address: string;
  ticker: string;
  name: string;
  imageUri: string | null;
  phase: LaunchPhaseDto;
  /** Null when no agent has been linked yet; the chain knows a key, not our identifier. */
  agentId: string | null;
  quote: AssetDto;
  /** Base units. Null before a launch exists on chain. */
  totalSupply: string | null;
  launchedAt: string | null;
  graduatedAt: string | null;
}

export interface CurveStateDto {
  /** Where trading happens in this phase. */
  venue: "pickler_curve" | "pons" | "uniswap_v4";
  address: string | null;
  /** A Uniswap V4 pool lives inside the PoolManager and has no address of its own. */
  poolKey: string | null;
  /** Base units of the agent token still buyable on the curve. */
  remainingTokens: string | null;
  /** Base units of quote backing the curve, net of fees. */
  realQuoteReserve: string | null;
  /** Base units of quote the curve is aiming at before it graduates. */
  graduationTarget: string | null;
  openedAt: string;
  closedAt: string | null;
}

export interface LaunchDetailDto extends LaunchSummaryDto {
  curve: CurveStateDto | null;
  pool: CurveStateDto | null;
}

export interface TradeDto {
  side: "buy" | "sell";
  trader: string;
  /** Base units of the agent token. */
  tokenAmount: string;
  /** Base units of the quote asset, gross of fees for a buy and net for a sell. */
  quoteAmount: string;
  feeAmount: string;
  blockNumber: string;
  txHash: string;
  logIndex: number;
  blockTime: string;
}

/**
 * Every failure the launch surface can report.
 *
 * A closed set rather than free text: a client has to be able to tell "your quote expired, ask
 * again" from "the chain refused this", and a message it has to parse is not a contract. The
 * on-chain custom errors decode into these same codes, so an error is never invented at the
 * HTTP layer.
 */
export type LaunchErrorCodeDto =
  | "invalid_request"
  | "unsupported_chain"
  | "launch_not_found"
  | "preset_disabled"
  | "config_changed"
  | "quote_expired"
  | "requote_required"
  | "slippage_exceeded"
  | "exceeds_remaining_supply"
  | "curve_closed"
  | "graduation_pending"
  | "insufficient_balance"
  | "allowance_required"
  | "indexer_stale"
  | "rpc_unavailable"
  | "simulation_failed"
  | "idempotency_conflict";

export interface LaunchErrorDto {
  error: {
    code: LaunchErrorCodeDto;
    message: string;
    /** Echoed so a report can be traced without guessing which request it was. */
    requestId?: string;
    /** Whether trying the same thing again could succeed. */
    retryable: boolean;
  };
}

/** How stale a read may be before it is flagged, in blocks. */
export const STALE_AFTER_BLOCKS = 50n;

export const LAUNCH_LIST_LIMITS = {
  defaultLimit: 25,
  maxLimit: 100,
} as const;
