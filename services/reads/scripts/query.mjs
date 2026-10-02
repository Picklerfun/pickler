import fs from "node:fs";
import { runQuery } from "./api.mjs";
import { loadEnv } from "./env.mjs";

const args = process.argv.slice(2);
const readOnly = args.includes("--read-only");
const fileIx = args.indexOf("--file");
const sql = fileIx >= 0 ? fs.readFileSync(args[fileIx + 1], "utf8") : args.filter((a) => !a.startsWith("--")).join(" ");
if (!sql.trim()) { console.error("uso: node scripts/query.mjs [--read-only] (--file x.sql | \"select 1\")"); process.exit(2); }
const rows = await runQuery(loadEnv(), sql, { readOnly });
console.log(JSON.stringify(rows, null, 2));
