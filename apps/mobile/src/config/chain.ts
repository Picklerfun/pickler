import { formatUnits, parseAbi, type Address } from "viem";
import { monadTestnet } from "viem/chains";

export const CHAIN = monadTestnet;

// docs.agora.finance/developer/contract-deployments — verificado por RPC 2026-09-15.
export const AUSD_ADDRESS: Address = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
export const AUSD_DECIMALS = 6;
export const AUSD_FAUCET_ADDRESS: Address = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C";

export const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

export const FAUCET_ABI = parseAbi([
  "function requestFunds(address recipient)",
]);

export const MON_FAUCET_URL = "https://faucet.monad.xyz";

export function EXPLORER_TX_URL(hash: string): string {
  return `${CHAIN.blockExplorers.default.url}/tx/${hash}`;
}

function truncate(value: string, places: number): string {
  const [whole, frac = ""] = value.split(".");
  return `${whole}.${(frac + "0".repeat(places)).slice(0, places)}`;
}

export function formatAusd(raw: bigint): string {
  return truncate(formatUnits(raw, AUSD_DECIMALS), 2);
}

export function formatMon(raw: bigint): string {
  return truncate(formatUnits(raw, CHAIN.nativeCurrency.decimals), 4);
}

/** AUSD como número para la UI (saldo "available", umbral de compra). */
export function ausdToNumber(raw: bigint): number {
  return Number(formatUnits(raw, AUSD_DECIMALS));
}
