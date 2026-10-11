import { readFile } from "node:fs/promises";
import { parse } from "dotenv";
import { PilotError } from "@pickler/core";
/** v7 accepts a dedicated database-only file; never parses model or trading settings. */
export async function localStudyDatabase(path: string) {
  const lines = (await readFile(path, "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#"));
  if (lines.length !== 1 || !/^\s*DATABASE_URL\s*=/.test(lines[0]!)) {
    throw new PilotError("INVALID_INPUT", "Provide a dedicated DATABASE_URL-only environment file");
  }
  const url = parse(lines[0]!).DATABASE_URL;
  if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
    throw new PilotError("INVALID_INPUT", "Explicit loopback PostgreSQL required");
  }
  return url;
}
