import type { Address, Hex } from "viem";
import { AUSD_ADDRESS, AUSD_FAUCET_ADDRESS } from "../config/chain";

export const MONADSCAN_API = "https://api.etherscan.io/v2/api";
export const MONADSCAN_CHAIN_ID = 10143;
const EXPLORER_TIMEOUT_MS = 15_000;

export type Transfer = { hash: Hex; block: bigint; timestamp: number; from: Address; to: Address; value: bigint };
export type MovementKind = "Faucet" | "Deposit" | "Withdrawal";
export type MovementStatus = "Complete" | "Confirming" | "Reverted";
export type Movement = { kind: MovementKind; amount: bigint; sign: "+" | "-"; when: number; hash: Hex; status: MovementStatus };

type TokenTx = { blockNumber: string; timeStamp: string; hash: string; from: string; to: string; value: string };

function isTokenTx(v: unknown): v is TokenTx {
  if (v === null || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return ["blockNumber", "timeStamp", "hash", "from", "to", "value"].every((k) => typeof r[k] === "string");
}

/** Lanza si la respuesta no es la de Etherscan V2 o trae un error distinto de "No transactions found". */
export function parseTokenTxResponse(body: unknown): Transfer[] {
  if (body === null || typeof body !== "object") throw new Error("Explorer returned no JSON object");
  const { status, message, result } = body as Record<string, unknown>;
  if (status === "0") {
    if (message === "No transactions found") return [];
    throw new Error(typeof result === "string" ? result : typeof message === "string" ? message : "Explorer error");
  }
  if (status !== "1" || !Array.isArray(result)) throw new Error("Explorer returned an unexpected payload");
  return result.map((row) => {
    if (!isTokenTx(row)) throw new Error("Explorer returned a malformed transfer");
    return {
      hash: row.hash as Hex,
      block: BigInt(row.blockNumber),
      timestamp: Number(row.timeStamp),
      from: row.from as Address,
      to: row.to as Address,
      value: BigInt(row.value),
    };
  });
}

export async function fetchAusdTransfers(address: Address, key: string): Promise<Transfer[]> {
  const url = `${MONADSCAN_API}?chainid=${MONADSCAN_CHAIN_ID}&module=account&action=tokentx&contractaddress=${AUSD_ADDRESS}&address=${address}&sort=desc&apikey=${key}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXPLORER_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Explorer responded ${res.status}`);
    return parseTokenTxResponse(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

function classify(t: Transfer, self: Address): { kind: MovementKind; sign: "+" | "-" } {
  if (same(t.from, AUSD_FAUCET_ADDRESS)) return { kind: "Faucet", sign: "+" };
  if (same(t.from, self)) return { kind: "Withdrawal", sign: "-" };
  return { kind: "Deposit", sign: "+" };
}

/** Más reciente primero. */
export function toMovements(transfers: Transfer[], self: Address): Movement[] {
  return [...transfers]
    .sort((a, b) => (a.block < b.block ? 1 : a.block > b.block ? -1 : 0))
    .map((t) => ({ ...classify(t, self), amount: t.value, when: t.timestamp, hash: t.hash, status: "Complete" as const }));
}

export function pendingMovement(kind: MovementKind, amount: bigint, hash: Hex): Movement {
  return { kind, amount, sign: kind === "Withdrawal" ? "-" : "+", when: Math.floor(Date.now() / 1000), hash, status: "Confirming" };
}
