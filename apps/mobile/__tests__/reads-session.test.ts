import { privateKeyToAccount } from "viem/accounts";
import {
  canonicalMessage, createSession, isStaleAccount, isUsable, parseSession, SESSION_RENEW_BEFORE_MS, SESSION_TTL_MS, serializeSession, sessionFor, signedHeaders,
} from "../src/reads/session";

const account = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000001");
const ADDRESS = account.address; // checksummed: la sesión lo guarda en minúsculas
const NOW = 1_789_600_000_000;
const SIG = `0x${"ab".repeat(65)}` as const;

test("the canonical message is pickler-reads:<lowercase address>:<ts> (D6)", () => {
  expect(canonicalMessage(ADDRESS, NOW)).toBe(`pickler-reads:${ADDRESS.toLowerCase()}:${NOW}`);
});

test("createSession signs the canonical message with the wallet account", async () => {
  const s = await createSession((m) => account.signMessage({ message: m }), ADDRESS, NOW);
  expect(s.address).toBe(ADDRESS.toLowerCase());
  expect(s.ts).toBe(NOW);
  expect(s.sig).toMatch(/^0x[0-9a-f]{130}$/);
  expect(s.sig).toBe(await account.signMessage({ message: canonicalMessage(ADDRESS, NOW) }));
});

test("a session is usable for 23 h and belongs to one address", () => {
  const s = { address: ADDRESS.toLowerCase(), ts: NOW, sig: SIG };
  expect(isUsable(s, NOW)).toBe(true);
  expect(isUsable(s, NOW + SESSION_TTL_MS - SESSION_RENEW_BEFORE_MS - 1)).toBe(true);
  expect(isUsable(s, NOW + SESSION_TTL_MS - SESSION_RENEW_BEFORE_MS)).toBe(false); // renueva con 1 h de margen (P2)
  expect(isUsable(s, NOW - 6 * 60_000)).toBe(false); // reloj atrasado más de 5 min: el servidor la rechazaría
  expect(sessionFor(s, ADDRESS, NOW)).toEqual(s); // compara en minúsculas
  expect(sessionFor(s, "0x2222222222222222222222222222222222222222", NOW)).toBeUndefined();
  expect(sessionFor(undefined, ADDRESS, NOW)).toBeUndefined();
});

test("serialize/parse round-trips and rejects malformed entries", () => {
  const s = { address: ADDRESS.toLowerCase(), ts: NOW, sig: SIG };
  expect(parseSession(serializeSession(s))).toEqual(s);
  for (const raw of [
    "{",
    JSON.stringify({ address: ADDRESS, ts: NOW, sig: SIG }), // no minúsculas
    JSON.stringify({ address: ADDRESS.toLowerCase(), ts: "x", sig: SIG }),
    JSON.stringify({ address: ADDRESS.toLowerCase(), ts: NOW, sig: "0x12" }),
    JSON.stringify({}),
  ]) expect(parseSession(raw)).toBeUndefined();
});

test("isStaleAccount discards responses once the account changed mid-flight (I1)", () => {
  const OTHER = "0x2222222222222222222222222222222222222222";
  expect(isStaleAccount(ADDRESS, ADDRESS)).toBe(false);
  expect(isStaleAccount(ADDRESS, ADDRESS.toLowerCase())).toBe(false); // compara en minúsculas
  expect(isStaleAccount(ADDRESS, OTHER)).toBe(true); // A → B: la respuesta de A no se pinta bajo B
  expect(isStaleAccount(ADDRESS, null)).toBe(true); // cuenta borrada/bloqueada sin dirección
  expect(isStaleAccount(null, ADDRESS)).toBe(true);
  expect(isStaleAccount(null, null)).toBe(false);
});

test("signedHeaders are the three x-pickler-* headers", () => {
  expect(signedHeaders({ address: ADDRESS.toLowerCase(), ts: NOW, sig: SIG })).toEqual({
    "x-pickler-address": ADDRESS.toLowerCase(), "x-pickler-ts": String(NOW), "x-pickler-sig": SIG,
  });
});
