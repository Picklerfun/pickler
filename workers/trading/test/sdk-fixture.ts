// Local workerd fixture only. The public test key holds no funds. No network operation exists.
import type { TypedDataPayload } from "@polymarket/client";
import { privateKey } from "@polymarket/client/viem";
import { tradingOrderHash } from "@pickler/infrastructure";
const fixture = {
  async fetch() {
    const signer = privateKey(`0x${"0".repeat(63)}1`);
    const payload: TypedDataPayload = {
      domain: {
        name: "Polymarket CTF Exchange",
        version: "2",
        chainId: 137,
        verifyingContract: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as NonNullable<
          TypedDataPayload["domain"]["verifyingContract"]
        >,
      },
      types: { Order: [{ name: "salt", type: "uint256" }] },
      primaryType: "Order",
      message: { salt: 1n },
    };
    const signature = await signer.signTypedData(payload);
    return Response.json({ signature, hash: tradingOrderHash(payload) });
  },
};

export default fixture;
