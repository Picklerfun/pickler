import { randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, unlink, chmod } from "node:fs/promises";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/** Operator-only local file operation; no network, account deployment or funding. */
export async function initializeTradingWallet(path: string, generate = generatePrivateKey) {
  const lock = await open(`${path}.wallet-lock`, "wx", 0o600);
  try {
    let content = "";
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("Environment target must be a regular file");
      }
      content = await readFile(path, "utf8");
    } catch (e) {
      if (!(typeof e === "object" && e && "code" in e && e.code === "ENOENT")) {
        throw e;
      }
    }
    const read = (name: string) => {
      const matches = [...content.matchAll(new RegExp(`^${name}=(.*)$`, "gm"))];
      if (matches.length > 1) {
        throw new Error("Duplicate wallet environment fields");
      }
      return matches[0]?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
    };
    const existing = read("POLYMARKET_SIGNER_PRIVATE_KEY");
    const address = read("POLYMARKET_SIGNER_ADDRESS");
    if (Boolean(existing) !== Boolean(address)) {
      throw new Error("Incomplete existing wallet configuration; refusing replacement");
    }
    const key = existing || generate();
    if (!/^0x[0-9a-f]{64}$/i.test(key)) {
      throw new Error("Invalid wallet configuration");
    }
    let derived: string;
    try {
      derived = privateKeyToAccount(key as `0x${string}`).address;
    } catch {
      throw new Error("Invalid wallet configuration");
    }
    if (address && address.toLowerCase() !== derived.toLowerCase()) {
      throw new Error("Wallet address and key mismatch");
    }
    if (existing) {
      await chmod(path, 0o600);
      return { address: derived, created: false };
    }
    for (const [name, value] of [
      ["POLYMARKET_SIGNER_PRIVATE_KEY", key],
      ["POLYMARKET_SIGNER_ADDRESS", derived],
    ]) {
      const pattern = new RegExp(`^${name}=.*$`, "m");
      content = pattern.test(content)
        ? content.replace(pattern, `${name}=${value}`)
        : `${content.trimEnd()}\n${name}=${value}\n`;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(content);
      await file.sync();
      await file.close();
      await rename(temporary, path);
    } finally {
      await file.close().catch(() => {});
      await unlink(temporary).catch(() => {});
    }
    return { address: derived, created: true };
  } finally {
    await lock.close();
    await unlink(`${path}.wallet-lock`);
  }
}

/** Append operator bootstrap results without overwriting a different existing value. */
export async function saveTradingCredentials(path: string, values: Record<string, string>) {
  const allowed = new Set([
    "POLYMARKET_WALLET_ADDRESS",
    "POLYMARKET_CLOB_API_KEY",
    "POLYMARKET_CLOB_API_SECRET",
    "POLYMARKET_CLOB_API_PASSPHRASE",
  ]);
  const lock = await open(`${path}.wallet-lock`, "wx", 0o600);
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("Invalid environment target");
    }
    let text = await readFile(path, "utf8");
    for (const [key, value] of Object.entries(values)) {
      if (!allowed.has(key) || !value || /[\r\n"'`$#\s]/.test(value)) {
        throw new Error("Invalid credential field");
      }
      const pattern = new RegExp(`^${key}=(.*)$`, "gm");
      const old = [...text.matchAll(pattern)];
      if (old.length > 1 || (old[0]?.[1] && old[0][1] !== value)) {
        throw new Error("Refusing to replace existing credentials");
      }
      text = old.length
        ? text.replace(pattern, `${key}=${value}`)
        : `${text.trimEnd()}\n${key}=${value}\n`;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(text);
      await file.sync();
      await file.close();
      await rename(temporary, path);
    } finally {
      await file.close().catch(() => {});
      await unlink(temporary).catch(() => {});
    }
  } finally {
    await lock.close();
    await unlink(`${path}.wallet-lock`);
  }
}
