import test from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { signMeraPerplRead } from "../src/features/wallet/lib/mera-perpl-read";
import type { PerplReadKeyPayloadDto } from "@pickler/api-schema";
const account = privateKeyToAccount(generatePrivateKey());
async function setup() {
  const { PERPL_READ_KEY_TYPES, PERPL_READ_KEY_LABEL, PERPL_DASHBOARD_ORIGIN } =
    await import("@pickler/api-schema");
  const publicBytes = new Uint8Array(32).fill(6);
  const input = {
    wallet: account.address,
    publicKey: "0x" + "06".repeat(32),
    expiresAt: Date.now() + 3500000,
  };
  const payload: PerplReadKeyPayloadDto = {
    typedData: {
      types: structuredClone(
        PERPL_READ_KEY_TYPES,
      ) as unknown as PerplReadKeyPayloadDto["typedData"]["types"],
      primaryType: "PerplRegisterApiKey",
      domain: {
        name: "perpl.xyz",
        version: "1",
        chainId: "0x279f",
        verifyingContract: ("0x" + "0".repeat(40)) as "0x0000000000000000000000000000000000000000",
        salt: "0x" + "1".repeat(64),
      },
      message: {
        signer: account.address,
        statement:
          "I authorize the creation of Perpl API key with the specified scope and parameters",
        publicKey: Buffer.from(publicBytes).toString("base64url"),
        scope: "1",
        label: PERPL_READ_KEY_LABEL,
        expiresAt: String(input.expiresAt),
        ipCidrs: "",
        origin: PERPL_DASHBOARD_ORIGIN,
        builderId: "0",
        maxBuilderFeePer100K: "0",
        time: String(Date.now()),
      },
    },
    mac: "0x" + "2".repeat(64),
  };
  const prf = new Uint8Array(32).fill(7);
  const privateBytes = new Uint8Array(32).fill(9);
  let ended = 0;
  let prompted = 0;
  const deps = {
    input,
    payload,
    current: () => true,
    prf: async () => {
      prompted++;
      return { credentialId: "controlled", prfOutput: prf };
    },
    kit: {
      privateKeyFromPrf: () => privateBytes,
      openKey: () => ({
        address: account.address,
        signMessage: async () => "unused",
        signTypedData: account.signTypedData,
        end: () => {
          ended++;
        },
      }),
    },
  };
  return { deps, prf, privateBytes, ended: () => ended, prompted: () => prompted };
}
test("Mera signs the narrow read contract and wipes the derived key and PRF before returning", async () => {
  const x = await setup();
  const signature = await signMeraPerplRead(x.deps);
  assert.match(signature, /^0x[0-9a-f]{130}$/i);
  assert.equal(x.ended(), 1);
  assert.ok(x.prf.every((b) => b === 0));
  assert.ok(x.privateBytes.every((b) => b === 0));
});
test("trade scope, fees and a changed wallet are rejected before any passkey prompt", async () => {
  for (const change of [
    { scope: "3" },
    { maxBuilderFeePer100K: "10" },
    { signer: "0x" + "9".repeat(40) },
  ]) {
    const x = await setup();
    Object.assign(x.deps.payload.typedData.message, change);
    await assert.rejects(signMeraPerplRead(x.deps));
    assert.equal(x.prompted(), 0);
  }
});
test("a rejected signature still wipes all ceremony material", async () => {
  const x = await setup();
  x.deps.kit.openKey = () => ({
    address: account.address,
    signMessage: async () => "unused",
    signTypedData: async () => {
      throw new Error("cancelled");
    },
    end: () => {},
  });
  await assert.rejects(signMeraPerplRead(x.deps), /cancelled/);
  assert.ok(x.prf.every((b) => b === 0));
  assert.ok(x.privateBytes.every((b) => b === 0));
});
