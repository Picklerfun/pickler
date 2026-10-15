import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { Pool } from "pg";
import {
  assertControlledDatabase,
  assertControlledDatabaseUrl,
} from "@pickler/infrastructure/testing/controlled-worker";

const directory = process.argv[2];
const status = JSON.parse(await readFile(join(directory, "status.json"), "utf8"));
const { identity } = JSON.parse(await readFile(join(directory, "controlled-stack.json"), "utf8"));
assertControlledDatabaseUrl(status.DB_URL);
const pool = new Pool({ connectionString: status.DB_URL, max: 1 });
try {
  await assertControlledDatabase(pool, identity);
} finally {
  await pool.end();
}
const env = JSON.parse(await readFile(join(directory, "web-build.json"), "utf8"));
if (!["http://127.0.0.1:55521", "http://127.0.0.1:55531"].includes(env.NEXT_PUBLIC_SUPABASE_URL)) {
  throw new Error("Studio acceptance requires dedicated local authentication");
}
const child = spawn("npm", ["run", "build:worker", "--workspace=@pickler/web"], {
  env: { ...process.env, ...env },
  stdio: "inherit",
});
child.on("error", () => process.exit(1));
child.on("exit", (code) => process.exit(code ?? 1));
