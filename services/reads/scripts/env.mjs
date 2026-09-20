import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_REF = "yvdipvcrpbqvofayteqf";
export const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const here = path.dirname(fileURLToPath(import.meta.url));
const worktreeRoot = path.resolve(here, "../../..");

/** `.env.pickler` vive en el checkout principal (gitignored): en un worktree se busca vía git-common-dir. */
export function envFile() {
  if (process.env.PICKLER_ENV_FILE) return process.env.PICKLER_ENV_FILE;
  const local = path.join(worktreeRoot, ".env.pickler");
  if (fs.existsSync(local)) return local;
  const common = execSync("git rev-parse --path-format=absolute --git-common-dir", { cwd: worktreeRoot, encoding: "utf8" }).trim();
  return path.join(path.dirname(common), ".env.pickler");
}

export function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

export function loadEnv() {
  const file = envFile();
  if (!fs.existsSync(file)) throw new Error(`No existe ${file}`);
  return parseEnv(fs.readFileSync(file, "utf8"));
}
