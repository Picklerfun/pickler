import type { PerplReadKeyInputDto, PerplReadKeyPayloadDto } from "@pickler/api-schema";
import { recoverTypedDataAddress, type TypedDataDefinition } from "viem";
export async function perplReadTypedData(
  payload: PerplReadKeyPayloadDto,
  input: PerplReadKeyInputDto,
) {
  const { checkPerplReadPayload } = await import("@pickler/api-schema");
  const bytes = Uint8Array.from(input.publicKey.slice(2).match(/../g) ?? [], (part) =>
    parseInt(part, 16),
  );
  const key = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const checked = checkPerplReadPayload(payload, input, key);
  const types = { PerplRegisterApiKey: checked.typedData.types.PerplRegisterApiKey };
  return {
    ...checked.typedData,
    types,
    domain: { ...checked.typedData.domain, chainId: 10143 },
    message: { ...checked.typedData.message, time: BigInt(checked.typedData.message.time) },
  } as TypedDataDefinition;
}
export async function verifyPerplReadSignature(
  payload: PerplReadKeyPayloadDto,
  input: PerplReadKeyInputDto,
  signature: string,
) {
  if (!/^0x[\da-fA-F]{130}$/.test(signature)) {
    throw new Error("The wallet returned an invalid signature.");
  }
  const address = await recoverTypedDataAddress({
    ...(await perplReadTypedData(payload, input)),
    signature: signature as `0x${string}`,
  });
  if (address.toLowerCase() !== input.wallet.toLowerCase()) {
    throw new Error("Wallet changed. Authorize read-only access again.");
  }
  return signature;
}
