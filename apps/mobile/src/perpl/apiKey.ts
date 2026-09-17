import { ed25519 } from "@noble/curves/ed25519.js";
import { base64urlnopad } from "@scure/base";
import { bytesToHex, type Hex, hashTypedData, hexToBytes, type TypedDataDefinition } from "viem";
import type { Wallet } from "../wallet/wallet";
import { ENROLL_TIMEOUT_MS, PERPL_CHAIN_ID, TRADING_KEY_LABEL, TRADING_KEY_SCOPE } from "./config";

export type KeyPair = { privateKey: Uint8Array; publicKeyHex: Hex };

export function generateTradingKey(): KeyPair {
  const privateKey = ed25519.utils.randomSecretKey();
  return { privateKey, publicKeyHex: bytesToHex(ed25519.getPublicKey(privateKey)) };
}

/** Cuatro campos unidos por "\n" (api-docs/websocket.md). */
export function wsSigninCanonical(chainId: number, timestampMs: string, nonce: string): string {
  return [chainId, "trading-ws-signin", timestampMs, nonce].join("\n");
}

export function signWsSignin(privateKey: Uint8Array, chainId: number, now = Date.now(), nonceBytes = crypto.getRandomValues(new Uint8Array(16))): { timestamp: string; nonce: string; signature: string } {
  const timestamp = now.toString();
  const nonce = base64urlnopad.encode(nonceBytes);
  const signature = base64urlnopad.encode(ed25519.sign(new TextEncoder().encode(wsSigninCanonical(chainId, timestamp, nonce)), privateKey));
  return { timestamp, nonce, signature };
}

type Rec = Record<string, unknown>;

/** El payload trae `EIP712Domain` en `types` y `chainId`/`time` como hex; viem quiere lo contrario. */
export function normalizeTypedData(typedData: unknown): TypedDataDefinition {
  if (typedData === null || typeof typedData !== "object") throw new Error("Perpl sent no typed data");
  const { types, primaryType, domain, message } = typedData as Rec;
  if (types === null || typeof types !== "object" || typeof primaryType !== "string" || domain === null || typeof domain !== "object" || message === null || typeof message !== "object") {
    throw new Error("Perpl typed data is malformed");
  }
  const { EIP712Domain: _domain, ...rest } = types as Rec;
  const d = domain as Rec;
  const m = message as Rec;
  return {
    types: rest as TypedDataDefinition["types"],
    primaryType,
    domain: { ...d, chainId: BigInt(String(d.chainId)) } as TypedDataDefinition["domain"],
    message: { ...m, time: BigInt(String(m.time)) },
  } as TypedDataDefinition;
}

export function describeEnrollError(status: number): string {
  switch (status) {
    case 404: return "Create the trading account first.";
    case 409: return "This trading key already exists. Try again.";
    case 423: return "Too many trading keys. Revoke one at testnet.perpl.xyz/apikeys.";
    default: return `Perpl rejected the enrolment (${status}).`;
  }
}

async function post(url: string, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENROLL_TIMEOUT_MS);
  try {
    // Sin header Origin: con uno propio Perpl responde 422 (docs/investigacion/perpl.md).
    return await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** payload → firma EIP-712 con la wallet → PoP Ed25519 sobre el digest → enroll. Devuelve el token `api_key`. */
export async function enrollTradingKey(wallet: Pick<Wallet, "address" | "account">, publicKeyHex: Hex, privateKey: Uint8Array, rest: string): Promise<string> {
  const p = await post(`${rest}/v1/api-key/payload`, {
    chain_id: PERPL_CHAIN_ID, address: wallet.address, public_key: publicKeyHex, scope_mask: TRADING_KEY_SCOPE, label: TRADING_KEY_LABEL,
  });
  if (!p.ok) throw new Error(describeEnrollError(p.status));
  const { typed_data, mac } = (await p.json()) as { typed_data?: unknown; mac?: unknown };
  if (typeof mac !== "string") throw new Error("Perpl sent no mac");
  const td = normalizeTypedData(typed_data);
  if (!wallet.account.signTypedData) throw new Error("This wallet can't sign typed data");
  const signature = await wallet.account.signTypedData(td);
  const popSignature = bytesToHex(ed25519.sign(hexToBytes(hashTypedData(td)), privateKey));
  const e = await post(`${rest}/v1/api-key/enroll`, {
    chain_id: PERPL_CHAIN_ID, address: wallet.address, typed_data, mac, signature, pop_signature: popSignature,
  });
  if (!e.ok) throw new Error(describeEnrollError(e.status));
  const body = (await e.json()) as { api_key?: { api_key?: unknown } };
  const key = body.api_key?.api_key;
  if (typeof key !== "string" || key === "") throw new Error("Perpl sent no api_key");
  return key;
}
