import { assertEquals } from "jsr:@std/assert@1";
import { APNS_TOPIC, decodeJwt, importP8, makeProviderJwt, pemToPkcs8, sendPush } from "./apns.ts";

async function testKeyPem(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\n");
  return { pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}

Deno.test("pemToPkcs8 quita cabeceras y saltos", async () => {
  const { pem } = await testKeyPem();
  const der = pemToPkcs8(pem);
  assertEquals(der[0], 0x30); // SEQUENCE
});

Deno.test("makeProviderJwt: header ES256+kid, claims iss+iat, firma verificable con la pública", async () => {
  const { pem, publicKey } = await testKeyPem();
  const jwt = await makeProviderJwt(await importP8(pem), "ABC123DEFG", "2PBQJ37Q8W", 1_790_000_000);
  const { header, payload } = decodeJwt(jwt);
  assertEquals(header, { alg: "ES256", kid: "ABC123DEFG" });
  assertEquals(payload, { iss: "2PBQJ37Q8W", iat: 1_790_000_000 });
  const [h, p, s] = jwt.split(".");
  const sig = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, sig, new TextEncoder().encode(`${h}.${p}`));
  assertEquals(ok, true);
});

Deno.test("sendPush: host por entorno, cabeceras APNs y payload aps.alert", async () => {
  let url = "", init: RequestInit = {};
  const fake = async (u: string, i: RequestInit) => { url = u; init = i; return new Response(JSON.stringify({ reason: "BadDeviceToken" }), { status: 400 }); };
  const r = await sendPush({ token: "abc", env: "sandbox", title: "T", body: "B", data: { kind: "read", readId: "r1" } }, "jwt.x.y", fake);
  assertEquals(r, { status: 400, reason: "BadDeviceToken" });
  assertEquals(url, "https://api.sandbox.push.apple.com/3/device/abc");
  const h = new Headers(init.headers);
  assertEquals(h.get("authorization"), "bearer jwt.x.y");
  assertEquals(h.get("apns-topic"), APNS_TOPIC);
  assertEquals(h.get("apns-push-type"), "alert");
  assertEquals(JSON.parse(init.body as string), { aps: { alert: { title: "T", body: "B" }, sound: "default" }, pickler: { kind: "read", readId: "r1" } });
  await sendPush({ token: "abc", env: "production", title: "T", body: "B" }, "j", fake);
  assertEquals(url, "https://api.push.apple.com/3/device/abc");
});
