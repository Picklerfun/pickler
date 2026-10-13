import {
  checkPerplReadPayload,
  perplReadKeyPayloadSchema,
  perplReadKeyResultSchema,
  type PerplReadKeyInputDto,
  type PerplReadKeyPayloadDto,
  type PerplPortfolioInputDto,
} from "@pickler/api-schema";
import { hashTypedData, hexToBytes, type TypedDataDefinition } from "viem";
import { perplRequest, PerplReadError } from "./client";
function base64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
function hex(bytes: Uint8Array) {
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export interface ReadAccess {
  scope: string;
  wallet: string;
  token: string;
  expiresAt: number;
  proofs(now?: number): Promise<PerplPortfolioInputDto>;
}
let held: ReadAccess | null = null;
export function readAccess(scope: string) {
  if (held && held.expiresAt <= Date.now()) {
    held = null;
  }
  return held?.scope === scope ? held : null;
}
export function clearReadAccess() {
  held = null;
}
export async function authorizeReadAccess(input: {
  scope: string;
  wallet: string;
  token: string;
  signal: AbortSignal;
  sign: (payload: PerplReadKeyPayloadDto, input: PerplReadKeyInputDto) => Promise<string>;
  onStage: (stage: "signing" | "authorizing") => void;
  now: number;
}) {
  // Native non-extractable Ed25519 key: never stored, exported, sent to a server or put in React state.
  let keys: CryptoKeyPair;
  try {
    keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
  } catch {
    throw new PerplReadError(
      "BROWSER_UNSUPPORTED",
      "This browser cannot create a secure read-only session. Update your browser and try again.",
    );
  }
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const wanted = {
    wallet: input.wallet,
    publicKey: hex(publicBytes),
    expiresAt: input.now + 3_570_000,
  };
  const payload = await perplRequest(
    "read-key/payload",
    perplReadKeyPayloadSchema,
    input.signal,
    input.token,
    wanted,
  );
  input.signal.throwIfAborted();
  checkPerplReadPayload(payload, wanted, base64(publicBytes));
  input.onStage("signing");
  const signature = await input.sign(payload, wanted);
  input.signal.throwIfAborted();
  const types = { PerplRegisterApiKey: payload.typedData.types.PerplRegisterApiKey };
  const typed = {
    ...payload.typedData,
    types,
    domain: { ...payload.typedData.domain, chainId: 10143 },
    message: { ...payload.typedData.message, time: BigInt(payload.typedData.message.time) },
  } as TypedDataDefinition;
  const digest = hexToBytes(hashTypedData(typed));
  const pop = new Uint8Array(
    await crypto.subtle.sign("Ed25519", keys.privateKey, new Uint8Array(digest)),
  );
  input.onStage("authorizing");
  const result = await perplRequest(
    "read-key/enroll",
    perplReadKeyResultSchema,
    input.signal,
    input.token,
    {
      wallet: input.wallet,
      typedData: payload.typedData,
      mac: payload.mac,
      signature,
      popSignature: hex(pop),
    },
  );
  input.signal.throwIfAborted();
  if (
    result.wallet.toLowerCase() !== input.wallet.toLowerCase() ||
    result.expiresAt !== wanted.expiresAt
  ) {
    throw new Error("Read access could not be verified.");
  }
  const proof = async (target: string, now: number) => {
    const timestamp = String(now);
    const nonce = base64(crypto.getRandomValues(new Uint8Array(16)));
    const message = [10143, "GET", target, timestamp, nonce, EMPTY_HASH].join("\n");
    const bytes = new TextEncoder().encode(message);
    const signed = new Uint8Array(await crypto.subtle.sign("Ed25519", keys.privateKey, bytes));
    return { apiKey: result.apiKey, timestamp, nonce, signature: base64(signed) };
  };
  const wallet = input.wallet;
  held = {
    scope: input.scope,
    wallet,
    token: input.token,
    expiresAt: result.expiresAt,
    async proofs(now = Date.now()) {
      const [walletProof, positionsProof] = await Promise.all([
        proof("/v1/trading/wallet", now),
        proof("/v1/trading/positions", now),
      ]);
      return { wallet, walletProof, positionsProof };
    },
  };
  return held;
}
