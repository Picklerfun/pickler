/**
 * The native balance of an address over a public JSON-RPC endpoint, for a signer that has no
 * provider of its own to ask. Null whenever it was not read — a refused request, a body that is
 * not a quantity, no network — because an unread balance is not a zero.
 */
/** A balance is decoration beside the address: it never holds anything up for longer than this. */
const TIMEOUT_MS = 5_000;

export async function readNativeBalance(
  address: string,
  rpcUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<bigint | null> {
  try {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [address, "latest"],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }
    const { result } = (await response.json()) as { result?: unknown };
    // `BigInt("0x")` throws and `BigInt("")` is zero: only a real quantity is a balance.
    return typeof result === "string" && /^0x[0-9a-fA-F]+$/.test(result) ? BigInt(result) : null;
  } catch {
    return null;
  }
}
