import type { PublicTokenTradePreparedDto } from "@pickler/api-schema";
import type { MeraKit, PrfSource } from "./mera-ceremony";
import { WrongPasskeyError } from "./mera-ceremony";
import {
  validatePublicTokenTransaction,
  verifySignedPublicTokenTransaction,
  publicWalletRpc,
  submitSignedPublicTokenTransaction,
} from "./public-token-transaction";
/** No provider wait while a derived key is alive. Wipe it before broadcasting the exact signed bytes. */
export async function sendMeraTokenTransaction(deps: {
  prepared: PublicTokenTradePreparedDto;
  wallet: string;
  token: string;
  kit: MeraKit;
  prf: PrfSource;
  current: () => boolean;
  rpc?: typeof publicWalletRpc;
  submit?: typeof submitSignedPublicTokenTransaction;
}) {
  const { prepared, wallet, token } = deps;
  await validatePublicTokenTransaction(prepared, wallet, token);
  const tx = prepared.transaction;
  const rpc = deps.rpc ?? publicWalletRpc;
  const nonce = await rpc("eth_getTransactionCount", [wallet, "pending"]);
  if (BigInt(String(nonce)) !== BigInt(tx.nonce)) {
    throw new Error("Wallet activity changed. Review the trade again.");
  }
  await rpc("eth_call", [{ from: tx.from, to: tx.to, data: tx.data, value: tx.value }, "latest"]);
  const passkey = await deps.prf();
  if (!passkey) {
    throw Object.assign(new Error("Signature cancelled."), { code: 4001 });
  }
  let key: Uint8Array | undefined;
  let opened: ReturnType<MeraKit["openKey"]> | undefined;
  let raw: `0x${string}`;
  try {
    key = deps.kit.privateKeyFromPrf(passkey.prfOutput);
    passkey.prfOutput.fill(0);
    opened = deps.kit.openKey(key);
    if (!deps.current() || opened.address.toLowerCase() !== wallet.toLowerCase()) {
      throw new WrongPasskeyError();
    }
    if (Date.parse(prepared.expiresAt) <= Date.now() || !opened.signTransaction) {
      throw new Error("Review the trade again.");
    }
    raw = await opened.signTransaction(tx);
  } finally {
    passkey.prfOutput.fill(0);
    try {
      opened?.end();
    } finally {
      key?.fill(0);
    }
  }
  if (!deps.current()) {
    throw new Error("Wallet disconnected. The signed transaction was not sent.");
  }
  await verifySignedPublicTokenTransaction(raw, prepared);
  if (Date.parse(prepared.expiresAt) <= Date.now()) {
    throw new Error("The review expired. The signed transaction was not sent.");
  }
  return (deps.submit ?? submitSignedPublicTokenTransaction)(raw);
}
