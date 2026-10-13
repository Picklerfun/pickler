// x402 v1 `exact` for paid advice (docs/specs/agent-advice-x402-v1.md §3.2, fee split §2/§4): the
// 402 is checked against the app's own constants before anything is signed, the buyer signs an
// EIP-3009 ReceiveWithAuthorization to the PicklerAdviceSplitter, and X-PAYMENT carries it with the
// salt that binds the agent wallet. What this writes is what core's decodePaymentHeader reads.
import { bytesToHex, encodeAbiParameters, isAddress, keccak256 } from "viem";
import { AUSD_ADDRESS, CHAIN } from "../config/chain";
import type { Authorization, Hex, PaymentError, Terms } from "./types";

export const X402_NETWORK = "monad-testnet";
export const NONCE_DERIVATION = "keccak256(abi.encode(payee,salt))";
const TOKEN_NAME = "Agora Dollar";
const TOKEN_VERSION = "1";
const PRIMARY_TYPE = "ReceiveWithAuthorization";
const CREATOR_BPS = 6500;
const PROTOCOL_BPS = 3500;
/** The server refuses an authorization valid for more than this. */
const MAX_TIMEOUT_SECONDS = 300;
/** How long the app's authorization stays valid: under the server's 300 s, with room for Face ID. */
export const VALIDITY_SECONDS = 240;
const HEADER_REQUIRED = "X-PAYMENT header is required";
const PAYMENT_ERRORS: readonly PaymentError[] = [
  "invalid_payment", "invalid_signature", "wrong_amount", "wrong_recipient", "expired", "nonce_used",
  "insufficient_funds", "payer_not_linked", "settlement_failed",
];
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^\d{1,78}$/;

type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);
const s = (v: unknown): v is string => typeof v === "string";
const n = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// The header requirement is a fresh 402 (null); a refusal the app does not know reads as
// invalid_payment, so it is never mistaken for a first ask.
function paymentError(v: unknown): PaymentError | null {
  if (v === HEADER_REQUIRED) return null;
  return (PAYMENT_ERRORS as readonly unknown[]).includes(v) ? (v as PaymentError) : "invalid_payment";
}

function termsOf(x402Version: unknown, a: Rec): Terms | null {
  const extra = obj(a.extra);
  if (!extra || !n(x402Version)) return null;
  const { scheme, network, maxAmountRequired, resource, payTo, maxTimeoutSeconds, asset } = a;
  if (!s(scheme) || !s(network) || !s(maxAmountRequired) || !UINT.test(maxAmountRequired) || !s(resource)) return null;
  if (!s(payTo) || !n(maxTimeoutSeconds) || !s(asset)) return null;
  const { name, version, chainId, primaryType, payee, creatorBps, protocolBps, nonceDerivation } = extra;
  if (!s(name) || !s(version) || !n(chainId) || !s(primaryType) || !s(payee)) return null;
  if (!n(creatorBps) || !n(protocolBps) || !s(nonceDerivation)) return null;
  return {
    payTo: payTo as Hex, payee: payee as Hex, value: BigInt(maxAmountRequired), maxTimeoutSeconds, resource,
    x402Version, scheme, network, asset, name, version, chainId, primaryType, creatorBps, protocolBps, nonceDerivation,
  };
}

/**
 * The 402 body (x402's own shape, no envelope). `terms` is null when `accepts` is not exactly one
 * well-formed set of terms; `error` is null only for the first 402 of an Ask (no X-PAYMENT sent).
 */
export function parsePaymentRequired(json: unknown): { terms: Terms | null; error: PaymentError | null } {
  const body = obj(json);
  if (!body) return { terms: null, error: "invalid_payment" };
  const error = paymentError(body.error);
  const accepts = Array.isArray(body.accepts) && body.accepts.length === 1 ? obj(body.accepts[0]) : null;
  return { terms: accepts ? termsOf(body.x402Version, accepts) : null, error };
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Whether the 402 may be signed. "untrusted" when anything but the price differs from the app's
 * constants (asset, chain, token domain, primary type, shares, network, scheme, window, addresses —
 * payTo and payee must be lowercase or correctly checksummed, as viem encodes them later)
 * or `payTo` is not `splitter`, the app's own pinned splitter (src/config/advice.ts): the `to` of a
 * ReceiveWithAuthorization can redeem it, so the 402 never chooses it. "price_changed" when only
 * the amount differs from what the agent row showed. Untrusted wins.
 */
export function checkTerms(terms: Terms, expectedMicro: bigint, splitter: Hex): "ok" | "price_changed" | "untrusted" {
  const trusted =
    sameAddress(terms.payTo, splitter) &&
    terms.x402Version === 1 &&
    terms.scheme === "exact" &&
    terms.network === X402_NETWORK &&
    sameAddress(terms.asset, AUSD_ADDRESS) &&
    terms.name === TOKEN_NAME &&
    terms.version === TOKEN_VERSION &&
    terms.chainId === CHAIN.id &&
    terms.primaryType === PRIMARY_TYPE &&
    terms.creatorBps === CREATOR_BPS &&
    terms.protocolBps === PROTOCOL_BPS &&
    terms.nonceDerivation === NONCE_DERIVATION &&
    Number.isInteger(terms.maxTimeoutSeconds) &&
    terms.maxTimeoutSeconds > 0 &&
    terms.maxTimeoutSeconds <= MAX_TIMEOUT_SECONDS &&
    ADDRESS.test(terms.payTo) && isAddress(terms.payTo) &&
    ADDRESS.test(terms.payee) && isAddress(terms.payee) &&
    !sameAddress(terms.payee, terms.payTo);
  if (!trusted) return "untrusted";
  return terms.value === expectedMicro ? "ok" : "price_changed";
}

/** `keccak256(abi.encode(payee, salt))`: the nonce the splitter recomputes for the agent wallet. */
export function nonceFor(payee: Hex, salt: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [payee, salt]));
}

/** 32 random bytes (crypto.getRandomValues, polyfilled by expo-crypto in src/polyfills.ts). */
export function randomSalt(): Hex {
  return bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * The authorization for checked terms: the full price to the splitter, valid from 0 until `now`
 * (ms) + 240 s (less if the terms allow less), with the nonce bound to the agent wallet.
 */
export function buildAuthorization(input: { from: Hex; terms: Terms; now: number; salt: Hex }): Authorization {
  const { from, terms, now, salt } = input;
  const window = Math.min(VALIDITY_SECONDS, terms.maxTimeoutSeconds);
  return {
    from, to: terms.payTo, value: terms.value, validAfter: 0n,
    validBefore: BigInt(Math.floor(now / 1000) + window), nonce: nonceFor(terms.payee, salt), salt,
  };
}

/** EIP-712 for `wallet.account.signTypedData`. The domain is the app's, never the 402's. */
export function typedData(a: Authorization) {
  return {
    domain: { name: TOKEN_NAME, version: TOKEN_VERSION, chainId: CHAIN.id, verifyingContract: AUSD_ADDRESS },
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: PRIMARY_TYPE,
    message: { from: a.from, to: a.to, value: a.value, validAfter: a.validAfter, validBefore: a.validBefore, nonce: a.nonce },
  } as const;
}

/** The `X-PAYMENT` header: base64 JSON, numbers as decimal strings, hex lowercase. */
export function encodePayment(a: Authorization, signature: Hex): string {
  const payment = {
    x402Version: 1,
    scheme: "exact",
    network: X402_NETWORK,
    payload: {
      signature: signature.toLowerCase(),
      authorization: {
        from: a.from.toLowerCase(), to: a.to.toLowerCase(), value: a.value.toString(),
        validAfter: a.validAfter.toString(), validBefore: a.validBefore.toString(),
        nonce: a.nonce.toLowerCase(), salt: a.salt.toLowerCase(),
      },
    },
  };
  return btoa(JSON.stringify(payment));
}

/** `X-PAYMENT-RESPONSE` on the 202 of the request that settled; null when absent or not that shape. */
export function decodeSettlement(header: string | null): { transaction: string; payer: string } | null {
  if (header === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(header.trim()));
  } catch {
    return null;
  }
  const r = obj(parsed);
  if (!r || r.success !== true || r.network !== X402_NETWORK) return null;
  if (!s(r.transaction) || !TX_HASH.test(r.transaction) || !s(r.payer) || !ADDRESS.test(r.payer)) return null;
  return { transaction: r.transaction, payer: r.payer };
}

/** The split the splitter pays: the creator's floor of 65%, the rest to Pickler. */
export function shares(micro: bigint): { creator: bigint; protocol: bigint } {
  const creator = (micro * BigInt(CREATOR_BPS)) / 10_000n;
  return { creator, protocol: micro - creator };
}
