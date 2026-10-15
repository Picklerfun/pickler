import { PilotError } from "@pickler/core";

export const perplHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export function perplBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[a-f\d]{2})+$/i.test(hex)) {
    throw new PilotError("PERPL_KEY_UNAVAILABLE", "Invalid encrypted credential");
  }
  return Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));
}
export const perplBase64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
export function createPerplKeyVault(secret: string) {
  if (!/^[a-f\d]{64}$/i.test(secret)) {
    throw new PilotError("PERPL_KEY_UNAVAILABLE", "Perpl encryption key is unavailable");
  }
  const key = crypto.subtle.importKey("raw", perplBytes(secret), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  const text = new TextEncoder();
  return {
    async seal(value: string, binding: string) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: text.encode(binding) },
        await key,
        text.encode(value),
      );
      return JSON.stringify({
        version: 1,
        iv: perplHex(iv),
        body: perplHex(new Uint8Array(encrypted)),
      });
    },
    async open(value: string, binding: string) {
      try {
        const parsed = JSON.parse(value) as { version: number; iv: string; body: string };
        if (parsed.version !== 1) {
          throw new Error();
        }
        const raw = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: perplBytes(parsed.iv), additionalData: text.encode(binding) },
          await key,
          perplBytes(parsed.body),
        );
        return new TextDecoder("utf-8", { fatal: true }).decode(raw);
      } catch {
        throw new PilotError(
          "PERPL_KEY_UNAVAILABLE",
          "Could not read this account's trading credential",
        );
      }
    },
  };
}
