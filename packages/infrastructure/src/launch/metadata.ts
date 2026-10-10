import { keccak256, stringToHex } from "viem";
import { AVATAR_PATTERNS, type TokenContext, type TokenDraft } from "@pickler/core";
/** Only the object operations needed by immutable internal writes and public hash reads. */
export interface TokenMetadataBucket {
  get(key: string): Promise<{ text(): Promise<string>; size: number } | null>;
  put(
    key: string,
    value: string,
    options: { onlyIf: Headers; httpMetadata: { contentType: string; cacheControl: string } },
  ): Promise<unknown>;
}
const COLORS: Record<string, string> = {
  lime: "#c8f03a",
  cyan: "#5b3ce0",
  amber: "#ffc93f",
  orange: "#ff7a3d",
  magenta: "#ff5fa2",
  blue: "#5b8cff",
  violet: "#9b7bff",
};
export function frozenTokenAvatar(context: TokenContext): string {
  const pattern = AVATAR_PATTERNS[context.avatarPattern];
  const color = COLORS[context.accent];
  if (!pattern || !color) {
    throw new Error("INVALID_AVATAR");
  }
  const cells = pattern
    .split("")
    .flatMap((cell, i) =>
      cell === "1"
        ? [
            `<rect x="${16 + (i % 4) * 28}" y="${16 + Math.floor(i / 4) * 28}" width="20" height="20" rx="4"/>`,
          ]
        : [],
    );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="${color}"/><g fill="#0b0d19">${cells.join("")}</g></svg>`;
}
export function createTokenMetadata(bucket: TokenMetadataBucket, origin: string) {
  const base = new URL("/api/v1/token-assets/", origin).href;
  async function immutable(content: string, extension: "svg" | "json") {
    const hash = keccak256(stringToHex(content));
    const key = `tokens/${hash.slice(2)}.${extension}`;
    await bucket.put(key, content, {
      onlyIf: new Headers({ "If-None-Match": "*" }),
      httpMetadata: {
        contentType: extension === "svg" ? "image/svg+xml" : "application/json",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    const stored = await bucket.get(key);
    if (!stored || stored.size > 32768 || keccak256(stringToHex(await stored.text())) !== hash) {
      throw new Error("METADATA_INTEGRITY_FAILED");
    }
    return { hash, uri: base + key.slice(7) };
  }
  return {
    async freeze(context: TokenContext, draft: TokenDraft) {
      const avatar = await immutable(frozenTokenAvatar(context), "svg");
      const metadata = JSON.stringify({
        version: 1,
        name: draft.name,
        symbol: draft.ticker,
        description: "A fixed-supply Pickler agent token.",
        image: avatar.uri,
        attributes: { accent: context.accent, pattern: context.avatarPattern },
      });
      return { ...(await immutable(metadata, "json")), imageUri: avatar.uri };
    },
    async read(file: string) {
      if (!/^[0-9a-f]{64}\.(json|svg)$/.test(file)) {
        return null;
      }
      const object = await bucket.get("tokens/" + file);
      if (!object || object.size > 32768) {
        return null;
      }
      const body = await object.text();
      if (keccak256(stringToHex(body)).slice(2) !== file.split(".")[0]) {
        throw new Error("METADATA_INTEGRITY_FAILED");
      }
      return { body, contentType: file.endsWith(".svg") ? "image/svg+xml" : "application/json" };
    },
  };
}
