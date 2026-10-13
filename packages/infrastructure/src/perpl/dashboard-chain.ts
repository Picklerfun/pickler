import { decodeErrorResult, decodeFunctionResult, encodeFunctionData, type Hex } from "viem";
import { IPerplReadAbi } from "@pickler/chain";

const RPC = "https://testnet-rpc.monad.xyz";
const EXCHANGE = "0x1964c32f0be608e7d29302aff5e61268e72080cc";
const MAX_BYTES = 2 * 1024 * 1024;
const hex = /^0x[\da-f]+$/i;

function safeInteger(value: bigint) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Invalid chain integer");
  }
  return Number(value);
}

// Perpl's first bank reserves its highest three bits; the other banks start at 253/509/765.
// Source: PerplFoundation/dex-sdk, state/account.rs::perpetuals_with_position.
export function perplPositionMarkets(banks: readonly bigint[]) {
  const ids: number[] = [];
  const offsets = [0, 253, 509, 765];
  for (let bank = 0; bank < 4; bank++) {
    const value = banks[bank];
    if (value === undefined || value < 0n || value >= 1n << 256n) {
      throw new Error("Invalid position bitmap");
    }
    for (let bit = 0; bit < (bank === 0 ? 253 : 256); bit++) {
      if ((value & (1n << BigInt(bit))) !== 0n) {
        ids.push(offsets[bank]! + bit);
      }
    }
  }
  if (ids.length > 64) {
    throw new Error("Too many positions for a bounded snapshot");
  }
  return ids;
}

/** Only public eth_chainId, eth_getBlockByNumber and pinned eth_call reads. No credentials. */
export async function readPerplChain(fetcher: typeof fetch, wallet: string, signal: AbortSignal) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const rpc = async (calls: { method: string; params: unknown[] }[], missingAccount?: string) => {
    const response = await fetcher(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(calls.map((call, id) => ({ jsonrpc: "2.0", id, ...call }))),
      signal: deadline,
      redirect: "manual",
    });
    if (!response.ok || Number(response.headers.get("Content-Length")) > MAX_BYTES) {
      await response.body?.cancel();
      throw new Error("Chain snapshot unavailable");
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Missing chain response");
    }
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) {
          break;
        }
        length += part.value.byteLength;
        if (length > MAX_BYTES) {
          await reader.cancel();
          throw new Error("Chain response too large");
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(body) || body.length !== calls.length) {
      throw new Error("Incomplete chain response");
    }
    return calls.map((_, id): unknown => {
      const items = body.filter((item) => item?.id === id);
      const item = items[0];
      if (items.length !== 1 || item.jsonrpc !== "2.0") {
        throw new Error("Unverified chain response");
      }
      if (
        item.error &&
        missingAccount &&
        item.result === undefined &&
        typeof item.error.data === "string"
      ) {
        const failure = decodeErrorResult({ abi: IPerplReadAbi, data: item.error.data as Hex });
        if (
          failure.errorName === "AccountDoesNotExist" &&
          failure.args[0].toLowerCase() === missingAccount.toLowerCase()
        ) {
          return null;
        }
      }
      if (item.error || item.result === undefined) {
        throw new Error("Unverified chain response");
      }
      return item.result;
    });
  };
  const [chainId, rawBlock] = await rpc([
    { method: "eth_chainId", params: [] },
    { method: "eth_getBlockByNumber", params: ["latest", false] },
  ]);
  const block = rawBlock as { number?: unknown; timestamp?: unknown; hash?: unknown } | null;
  if (
    typeof chainId !== "string" ||
    !hex.test(chainId) ||
    BigInt(chainId) !== 10143n ||
    typeof block?.number !== "string" ||
    !hex.test(block.number) ||
    typeof block.timestamp !== "string" ||
    !hex.test(block.timestamp) ||
    typeof block.hash !== "string" ||
    !/^0x[\da-f]{64}$/i.test(block.hash)
  ) {
    throw new Error("Wrong or incomplete chain snapshot");
  }
  const blockNumber = safeInteger(BigInt(block.number));
  const timestamp = safeInteger(BigInt(block.timestamp) * 1000n);
  // EIP-1898 prevents mixing states if a reorg occurs while the snapshot is read.
  const blockRef = { blockHash: block.hash, requireCanonical: true };
  const call = (data: Hex) => ({ method: "eth_call", params: [{ to: EXCHANGE, data }, blockRef] });
  const [accountData] = await rpc(
    [
      call(
        encodeFunctionData({
          abi: IPerplReadAbi,
          functionName: "getAccountByAddr",
          args: [wallet as Hex],
        }),
      ),
    ],
    wallet,
  );
  if (accountData === null) {
    return { block: blockNumber, timestamp, accounts: [], positions: [] };
  }
  if (typeof accountData !== "string" || !hex.test(accountData)) {
    throw new Error("Missing account response");
  }
  const account = decodeFunctionResult({
    abi: IPerplReadAbi,
    functionName: "getAccountByAddr",
    data: accountData as Hex,
  });
  if (account.accountId !== 0n && account.accountAddr.toLowerCase() !== wallet.toLowerCase()) {
    throw new Error("Account identity mismatch");
  }
  const accountId = safeInteger(account.accountId);
  const marketIds = perplPositionMarkets([
    account.positions.bank1,
    account.positions.bank2,
    account.positions.bank3,
    account.positions.bank4,
  ]);
  if (accountId === 0 && (marketIds.length || account.balanceCNS || account.lockedBalanceCNS)) {
    throw new Error("Invalid empty account");
  }
  const positions = [];
  for (let start = 0; start < marketIds.length; start += 10) {
    const ids = marketIds.slice(start, start + 10);
    const results = await rpc(
      ids.map((marketId) =>
        call(
          encodeFunctionData({
            abi: IPerplReadAbi,
            functionName: "getPositionV2",
            args: [BigInt(marketId), account.accountId],
          }),
        ),
      ),
    );
    for (let i = 0; i < ids.length; i++) {
      const data = results[i];
      if (typeof data !== "string" || !hex.test(data)) {
        throw new Error("Missing position response");
      }
      const [position, mark, validMark] = decodeFunctionResult({
        abi: IPerplReadAbi,
        functionName: "getPositionV2",
        data: data as Hex,
      });
      if (
        position.accountId !== account.accountId ||
        ![0, 1].includes(position.positionType) ||
        position.lotLNS === 0n
      ) {
        throw new Error("Position identity mismatch");
      }
      const entryResidue = safeInteger(position.priceResiduePNSQ16);
      if (entryResidue > 65535) {
        throw new Error("Invalid entry residue");
      }
      positions.push({
        id: ids[i]!,
        accountId,
        marketId: ids[i]!,
        side: position.positionType === 0 ? ("long" as const) : ("short" as const),
        size: safeInteger(position.lotLNS),
        entry: safeInteger(position.pricePNS),
        entryResidue,
        collateral: position.depositCNS.toString(),
        leverage: null,
        mark: validMark ? safeInteger(mark) : 0,
      });
    }
  }
  return {
    block: blockNumber,
    timestamp,
    accounts:
      accountId === 0
        ? []
        : [
            {
              id: accountId,
              balance: account.balanceCNS.toString(),
              locked: account.lockedBalanceCNS.toString(),
              frozen: account.frozen !== 0,
            },
          ],
    positions,
  };
}
