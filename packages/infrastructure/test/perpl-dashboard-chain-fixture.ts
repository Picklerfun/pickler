/** Controlled public RPC. Never sends a network request or holds a wallet signing key. */
import { readFileSync } from "node:fs";
import { decodeFunctionData, encodeErrorResult, encodeFunctionResult, type Hex } from "viem";
import { IPerplReadAbi } from "@pickler/chain";
import { controlledPerpl, DASHBOARD_WALLET } from "./perpl-dashboard-fixture.js";

export function controlledPerplChain(now: () => number = Date.now, wallet = DASHBOARD_WALLET) {
  const venue = controlledPerpl(now, wallet);
  const context = JSON.parse(
    readFileSync(
      new URL("../../perpl-context/test/fixtures/context.json", import.meta.url),
      "utf8",
    ),
  );
  let failure = "";
  let offset = 0;
  let extraMarket: number | null = null;
  const calls: { method: string; params: unknown[] }[] = [];
  const hash = "0x" + "4".repeat(64);
  const fetcher: typeof fetch = async (target, init) => {
    if (new URL(String(target)).origin === "https://testnet.perpl.xyz") {
      return venue.fetcher(target, init);
    }
    if (String(target) !== "https://testnet-rpc.monad.xyz") {
      throw new Error("Forbidden RPC");
    }
    if (failure === "unavailable") {
      return new Response("provider-private-message", { status: 503 });
    }
    const request = JSON.parse(String(init?.body));
    const replies = request.map((call: { id: number; method: string; params: unknown[] }) => {
      calls.push(call);
      const reply = (result: unknown) => ({ jsonrpc: "2.0", id: call.id, result });
      if (call.method === "eth_chainId") {
        return reply(failure === "chain" ? "0x8f" : "0x279f");
      }
      if (call.method === "eth_getBlockByNumber") {
        return reply({
          number: "0x64",
          timestamp: "0x" + Math.floor(now() / 1000).toString(16),
          hash,
        });
      }
      if (call.method !== "eth_call") {
        throw new Error("Non-read RPC");
      }
      const tx = call.params[0] as { to: string; data: Hex };
      if (
        tx.to !== "0x1964c32f0be608e7d29302aff5e61268e72080cc" ||
        JSON.stringify(call.params[1]) !==
          JSON.stringify({ blockHash: hash, requireCanonical: true })
      ) {
        throw new Error("Unpinned contract read");
      }
      const decoded = decodeFunctionData({ abi: IPerplReadAbi, data: tx.data });
      if (decoded.functionName === "getAccountByAddr") {
        const requested = decoded.args[0];
        if (failure === "missing" || requested.toLowerCase() !== wallet.toLowerCase()) {
          return {
            jsonrpc: "2.0",
            id: call.id,
            error: {
              code: 3,
              data: encodeErrorResult({
                abi: IPerplReadAbi,
                errorName: "AccountDoesNotExist",
                args: [requested],
              }),
            },
          };
        }
        return reply(
          encodeFunctionResult({
            abi: IPerplReadAbi,
            functionName: "getAccountByAddr",
            result: {
              accountId: 619n,
              balanceCNS: 500000000n,
              lockedBalanceCNS: 20000000n,
              frozen: 0,
              accountAddr:
                failure === "identity" ? "0x9999999999999999999999999999999999999999" : requested,
              positions: {
                bank1:
                  (1n << 255n) |
                  (1n << 16n) |
                  (1n << 32n) |
                  (extraMarket !== null && extraMarket < 253 ? 1n << BigInt(extraMarket) : 0n),
                bank2:
                  extraMarket !== null && extraMarket >= 253 ? 1n << BigInt(extraMarket - 253) : 0n,
                bank3: 0n,
                bank4: 0n,
              },
            },
          }),
        );
      }
      const marketId = Number(decoded.args[0]);
      const m =
        context.markets.find((item: { id: number }) => item.id === marketId) ?? context.markets[0];
      const short = marketId === 32;
      return reply(
        encodeFunctionResult({
          abi: IPerplReadAbi,
          functionName: "getPositionV2",
          result: [
            {
              accountId: failure === "position" ? 999n : 619n,
              nextNodeId: 0n,
              prevNodeId: 0n,
              positionType: short ? 1 : 0,
              depositCNS: short ? 100000000n : 200000000n,
              pricePNS: BigInt(m.state.mrk + (short ? 100 : -400)),
              lotLNS: short ? 100n : 1000n,
              entryBlock: 90n,
              pnlCNS: 0n,
              deltaPnlCNS: 0n,
              premiumPnlCNS: 0n,
              priceResiduePNSQ16: 0n,
            },
            BigInt(m.state.mrk + offset),
            failure !== "mark",
          ],
        }),
      );
    });
    return Response.json(failure === "partial" ? replies.slice(0, -1) : replies.reverse());
  };
  return {
    fetcher,
    calls,
    venue,
    setFailure(value: string) {
      failure = value;
    },
    addMarket(value: number) {
      extraMarket = value;
    },
    updateMarks() {
      offset += 100;
      venue.updateMarks();
    },
  };
}
