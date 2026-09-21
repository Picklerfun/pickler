"use client";

import { TARGET_CHAIN } from "./provider";

/**
 * One read against the chain's public RPC, for a signer that has no provider of its own.
 *
 * An injected wallet answers `eth_getBalance` itself; a passkey account has nobody to ask, so the
 * page asks the network directly. A balance is public, so this needs no key and carries none.
 */
export async function readBalanceOverRpc(address: string): Promise<bigint | null> {
  const url = TARGET_CHAIN.publicRpcUrls[0];
  if (!url) {
    return null;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [address, "latest"],
      }),
    });
    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as { result?: unknown };
    return typeof body.result === "string" ? BigInt(body.result) : null;
  } catch {
    // An unreachable RPC is a missing number, not a broken connection: the address is still real.
    return null;
  }
}
