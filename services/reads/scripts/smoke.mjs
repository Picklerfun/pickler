// agents-list → reads-list (20 créditos) → read-request → read-get → reads-list → read-get con otra dirección (401).
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SUPABASE_URL } from "./env.mjs";

const BASE = `${SUPABASE_URL}/functions/v1`;
const [marketId = "16", agentId = "jesus"] = process.argv.slice(2);
const account = privateKeyToAccount(process.env.READS_TEST_KEY ?? generatePrivateKey());
const address = account.address.toLowerCase();
const ts = Date.now();
const sig = await account.signMessage({ message: `pickler-reads:${address}:${ts}` });
const H = { "x-pickler-address": address, "x-pickler-ts": String(ts), "x-pickler-sig": sig };

async function call(name, path, init = {}) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/${path}`, init);
  const body = await res.json().catch(() => null);
  console.log(`→ ${name}: HTTP ${res.status} · ${Date.now() - t0} ms\n${JSON.stringify(body, null, 2)}`);
  return { status: res.status, body };
}

console.log(`wallet de prueba ${address}`);
const agents = await call("agents-list", "agents-list");
const list0 = await call("reads-list (wallet nueva)", "reads-list", { headers: H });
const req = await call("read-request", "read-request", {
  method: "POST", headers: { ...H, "content-type": "application/json" },
  body: JSON.stringify({ marketId: Number(marketId), levelBps: 100, horizonMin: 60, agentId }),
});
if (req.status !== 200) { console.log("SMOKE FAILED (read-request)"); process.exit(1); }
const get = await call("read-get", `read-get?id=${req.body.read.id}`, { headers: H });
const list1 = await call("reads-list", `reads-list?marketId=${marketId}`, { headers: H });
const bad = await call("read-get con otra dirección", `read-get?id=${req.body.read.id}`, { headers: { ...H, "x-pickler-address": "0x0000000000000000000000000000000000000001" } });

const checks = {
  "3 agentes": agents.body?.agents?.length === 3,
  "20 créditos iniciales": list0.body?.credits === 20 && list0.body?.reads?.length === 0,
  "read open con 3 razones": req.body.read.status === "open" && req.body.read.reasons?.length === 3 && req.body.read.probability > 0 && req.body.read.probability < 1,
  "19 créditos tras la read": req.body.credits === 19,
  "read-get devuelve la misma read": get.body?.read?.id === req.body.read.id,
  "reads-list la lista": list1.body?.reads?.[0]?.id === req.body.read.id && list1.body?.credits === 19,
  "otra dirección → 401": bad.status === 401,
};
for (const [k, v] of Object.entries(checks)) console.log(`${v ? "✓" : "✗"} ${k}`);
const ok = Object.values(checks).every(Boolean);
console.log(ok ? "SMOKE OK" : "SMOKE FAILED");
process.exit(ok ? 0 : 1);
