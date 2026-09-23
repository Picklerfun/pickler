import { type Address, parseAbi } from "viem";

// Perpl testnet, verificado contra GET /api/v1/pub/context el 2026-09-16 (docs/investigacion/perpl.md).
export const PERPL_CHAIN_ID = 10143;
export const PERPL_REST = "https://testnet.perpl.xyz/api";
export const PERPL_WS = "wss://testnet.perpl.xyz/ws/v1/trading";
export const PERPL_MARKET_DATA_WS = "wss://testnet.perpl.xyz/ws/v1/market-data"; // público, sin firma ni pings (D11)
export const PERPL_WEB = "https://testnet.perpl.xyz";

export const EXCHANGE_ADDRESS: Address = "0x1964c32f0be608e7d29302aff5e61268e72080cc";
// getAccountByAddr devuelve un struct; el primer word es el id, así que decodificar uint256 lo lee. Revierte (0x03a0e277) sin cuenta.
export const EXCHANGE_ABI = parseAbi([
  "function createAccount(uint256 amount) returns (uint256)",
  "function allowOrderForwarding(bool allow)",
  "function getAccountByAddr(address addr) view returns (uint256)",
  "function depositCollateral(uint256 amount)",
  "function withdrawCollateral(uint256 amount)",
]);

export const TRADING_KEY_LABEL = "Pickler iOS";
export const TRADING_KEY_SCOPE = 3; // read | trade; nunca withdraw

export const PING_MS = 3000; // idle 10 s testnet, 5 s mainnet
export const ORDER_TIMEOUT_MS = 30_000;
export const CONTEXT_POLL_MS = 5000;
export const CONTEXT_TIMEOUT_MS = 15_000;
export const ENROLL_TIMEOUT_MS = 15_000;
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;
export const SOCKET_GRACE_MS = 2000;

export const LEVERAGES = [1, 2, 3, 5] as const;
export type Leverage = (typeof LEVERAGES)[number];

/** Niveles por lado que muestra BookCard (D11). */
export const BOOK_DEPTH = 5;

/** Un reintento debe reemplazar una tx descartada por falta de MON (lección del spike). */
export const PRIORITY_FEE_WEI = 20_000_000_000n;
