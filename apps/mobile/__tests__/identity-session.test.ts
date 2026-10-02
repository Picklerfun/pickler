import { base64urlnopad, utf8 } from "@scure/base";
import { recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { DoFetch } from "../src/identity/api";
import { EXPIRY_MARGIN_MS, sessionFor, signInWithWallet, tokenExpiry } from "../src/identity/session";
import { gateOpen, identityFor, parseIdentity, serializeIdentity } from "../src/identity/state";

const account = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000001");
const BASE = "https://pickler.fun/api/v1";
const NOW = 1_790_000_000_000;

const b64 = (o: unknown) => base64urlnopad.encode(utf8.decode(JSON.stringify(o)));
const jwt = (payload: unknown) => `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;

/** La API: entrega un mensaje para la dirección y sólo da sesión si la firma es de esa dirección sobre ese mensaje. */
function api() {
  const calls: string[] = [];
  let issued = "";
  const doFetch: DoFetch = async (url, init) => {
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    calls.push(url.replace(BASE, ""));
    if (url.endsWith("/nonce")) {
      issued = `pickler.fun wants you to sign in with your Ethereum account:\n${body.address}\n\nSign in to Pickler\n\nNonce: n1\n`;
      return { ok: true, status: 200, json: async () => ({ data: { nonce: "n1", message: issued } }) } as Response;
    }
    const signer = await recoverMessageAddress({ message: body.raw!, signature: body.signature as `0x${string}` });
    const ok = body.raw === issued && signer === account.address && body.kind === "mera";
    return ok
      ? ({ ok: true, status: 200, json: async () => ({ data: { userId: "user-1", session: { accessToken: jwt({ sub: "user-1", exp: NOW / 1000 + 3600 }) } } }) } as Response)
      : ({ ok: false, status: 401, json: async () => ({ message: "bad signature" }) } as Response);
  };
  return { calls, doFetch };
}

test("signing in signs the server's message unchanged with the wallet, and gets that account's session", async () => {
  const { calls, doFetch } = api();
  const session = await signInWithWallet({ base: BASE, address: account.address, chainId: 10143, sign: (message) => account.signMessage({ message }) }, doFetch);
  expect(calls).toEqual(["/auth/wallet/nonce", "/auth/wallet/verify"]);
  expect(session.userId).toBe("user-1");
  expect(session.address).toBe(account.address.toLowerCase());
  expect(tokenExpiry(session.token)).toBe(NOW + 3_600_000);
});

test("a signature that is not the wallet's is refused, not a session", async () => {
  const other = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000002");
  await expect(
    signInWithWallet({ base: BASE, address: account.address, chainId: 10143, sign: (message) => other.signMessage({ message }) }, api().doFetch),
  ).rejects.toMatchObject({ status: 401 });
});

test("a token is used only by its address and until a minute before it expires", () => {
  const token = jwt({ exp: NOW / 1000 + 3600 });
  const s = { address: account.address.toLowerCase(), userId: "u", token };
  expect(sessionFor(s, account.address, NOW)).toBe(s); // compara en minúsculas
  expect(sessionFor(s, account.address, NOW + 3_600_000 - EXPIRY_MARGIN_MS)).toBeUndefined();
  expect(sessionFor(s, "0x2222222222222222222222222222222222222222", NOW)).toBeUndefined();
  expect(sessionFor(undefined, account.address, NOW)).toBeUndefined();
  // Un vencimiento que no se puede leer no se reusa: se entra de nuevo.
  expect(sessionFor({ ...s, token: "not-a-jwt" }, account.address, NOW)).toBeUndefined();
  expect(tokenExpiry(jwt({ exp: "soon" }))).toBeNull();
});

test("only an account known to have no username opens the gate", () => {
  expect(gateOpen({ status: "none" })).toBe(true);
  for (const identity of [{ status: "off" }, { status: "unknown" }, { status: "checking" }, { status: "unreachable" }, { status: "has", handle: "nightowl" }] as const) {
    expect(gateOpen(identity)).toBe(false);
  }
});

test("the stored username belongs to one address on one API, and a malformed entry is nothing", () => {
  const raw = serializeIdentity({ address: account.address, handle: "nightowl", api: BASE });
  const stored = parseIdentity(raw)!;
  expect(stored).toEqual({ address: account.address.toLowerCase(), handle: "nightowl", api: BASE });
  expect(identityFor(stored, account.address, BASE)).toEqual(stored);
  expect(identityFor(stored, "0x2222222222222222222222222222222222222222", BASE)).toBeUndefined();
  expect(identityFor(stored, null, BASE)).toBeUndefined();
  // Una cuenta de staging no es la de producción: otro build vuelve a preguntar.
  expect(identityFor(stored, account.address, "https://staging.example/api/v1")).toBeUndefined();
  const lower = account.address.toLowerCase();
  for (const bad of ["", "{", "null", "{}", JSON.stringify({ address: "0xABC", handle: "x", api: BASE }), JSON.stringify({ address: lower, handle: "", api: BASE }), JSON.stringify({ address: lower, handle: "nightowl" })]) {
    expect(parseIdentity(bad)).toBeUndefined();
  }
});
