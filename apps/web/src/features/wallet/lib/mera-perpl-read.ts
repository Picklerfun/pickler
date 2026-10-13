import type { PerplReadKeyInputDto, PerplReadKeyPayloadDto } from "@pickler/api-schema";
import type { MeraKit, PrfSource } from "./mera-ceremony";
import { WrongPasskeyError } from "./mera-ceremony";
import { perplReadTypedData, verifyPerplReadSignature } from "./perpl-read-authorization";
export async function signMeraPerplRead(deps: {
  payload: PerplReadKeyPayloadDto;
  input: PerplReadKeyInputDto;
  kit: MeraKit;
  prf: PrfSource;
  current: () => boolean;
}) {
  const typed = await perplReadTypedData(deps.payload, deps.input);
  const passkey = await deps.prf();
  if (!passkey) {
    throw Object.assign(new Error("Authorization cancelled."), { code: 4001 });
  }
  let key: Uint8Array | undefined;
  let opened: ReturnType<MeraKit["openKey"]> | undefined;
  let signature: string;
  try {
    key = deps.kit.privateKeyFromPrf(passkey.prfOutput);
    passkey.prfOutput.fill(0);
    opened = deps.kit.openKey(key);
    if (!deps.current() || opened.address.toLowerCase() !== deps.input.wallet.toLowerCase()) {
      throw new WrongPasskeyError();
    }
    if (!opened.signTypedData) {
      throw new Error("Read authorization is not available in this wallet.");
    }
    signature = await opened.signTypedData(typed);
  } finally {
    passkey.prfOutput.fill(0);
    try {
      opened?.end();
    } finally {
      key?.fill(0);
    }
  }
  if (!deps.current()) {
    throw new Error("Wallet disconnected. No read access was enrolled.");
  }
  return verifyPerplReadSignature(deps.payload, deps.input, signature);
}
