import { assertEquals } from "jsr:@std/assert@1";
import { generatePrivateKey, privateKeyToAccount } from "npm:viem@2.56.8/accounts";
import { authenticate, canonicalMessage, SESSION_FUTURE_MS, SESSION_MAX_AGE_MS } from "./auth.ts";

const account = privateKeyToAccount(generatePrivateKey());
const NOW = 1_790_000_000_000;

async function headersFor(ts: number, address = account.address, signer = account): Promise<Headers> {
  const sig = await signer.signMessage({ message: canonicalMessage(address, ts) });
  return new Headers({ "x-pickler-address": address, "x-pickler-ts": String(ts), "x-pickler-sig": sig });
}

Deno.test("canonicalMessage usa la dirección en minúsculas", () => {
  assertEquals(canonicalMessage("0xABCDEF0000000000000000000000000000000001", 5), "pickler-reads:0xabcdef0000000000000000000000000000000001:5");
});

Deno.test("firma válida → ok con la dirección en minúsculas", async () => {
  const r = await authenticate(await headersFor(NOW - 1000), NOW);
  assertEquals(r, { ok: true, address: account.address.toLowerCase() });
});

Deno.test("firma de hace más de 24 h → signature_expired", async () => {
  const r = await authenticate(await headersFor(NOW - SESSION_MAX_AGE_MS - 1), NOW);
  assertEquals(r, { ok: false, status: 401, error: "signature_expired" });
});

Deno.test("timestamp más de 5 min en el futuro → signature_expired", async () => {
  const r = await authenticate(await headersFor(NOW + 6 * 60_000), NOW);
  assertEquals(r, { ok: false, status: 401, error: "signature_expired" });
});

Deno.test("firma de otra wallet → bad_signature", async () => {
  const other = privateKeyToAccount(generatePrivateKey());
  const r = await authenticate(await headersFor(NOW, account.address, other), NOW);
  assertEquals(r, { ok: false, status: 401, error: "bad_signature" });
});

Deno.test("headers ausentes o malformados → missing_signature", async () => {
  assertEquals(await authenticate(new Headers(), NOW), { ok: false, status: 401, error: "missing_signature" });
  const h = await headersFor(NOW);
  h.set("x-pickler-sig", "0x1234");
  assertEquals(await authenticate(h, NOW), { ok: false, status: 401, error: "missing_signature" });
});

Deno.test("los límites exactos de la ventana se aceptan (intervalo cerrado)", async () => {
  const oldest = await authenticate(await headersFor(NOW - SESSION_MAX_AGE_MS), NOW);
  assertEquals(oldest, { ok: true, address: account.address.toLowerCase() });
  const newest = await authenticate(await headersFor(NOW + SESSION_FUTURE_MS), NOW);
  assertEquals(newest, { ok: true, address: account.address.toLowerCase() });
});
