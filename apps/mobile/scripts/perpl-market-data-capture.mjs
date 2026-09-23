#!/usr/bin/env node
// Graba frames crudos de `order-book@<market>` del WebSocket público de market-data de Perpl (spec D11, plan F3 P3).
// Uso: node scripts/perpl-market-data-capture.mjs [--market 16] [--seconds 20] [--url wss://testnet.perpl.xyz/ws/v1/market-data] [--out __tests__/fixtures/perpl/market-data-frames.json]
// Node ≥ 22 (WebSocket global). Sin cuenta, sin firma, sin gas: datos públicos. Gasta 1 de los 10 requests/min de la conexión.
import { writeFileSync } from "node:fs";

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? def : process.argv[i + 1]; };
const market = Number(arg("market", "16"));
const seconds = Number(arg("seconds", "20"));
const url = arg("url", "wss://testnet.perpl.xyz/ws/v1/market-data");
const out = arg("out", "__tests__/fixtures/perpl/market-data-frames.json");
const stream = `order-book@${market}`;
if (typeof WebSocket === "undefined") { console.error("Node 22+ required (global WebSocket)"); process.exit(1); }

const frames = [];
const ws = new WebSocket(url);
ws.onopen = () => ws.send(JSON.stringify({ mt: 5, subs: [{ stream, subscribe: true }] }));
ws.onmessage = (ev) => { try { frames.push(JSON.parse(String(ev.data))); } catch { console.error("non-JSON frame ignored"); } };
ws.onclose = (ev) => { if (ev.code !== 1000 && ev.code !== 1005) console.error(`closed ${ev.code} ${ev.reason}`); };
ws.onerror = () => {};

setTimeout(() => {
  ws.close();
  const counts = {};
  for (const f of frames) counts[f.mt] = (counts[f.mt] ?? 0) + 1;
  const capturedAt = new Date().toISOString();
  const head = { _source: `Capturado contra ${url} (${stream}) el ${capturedAt} durante ${seconds} s con scripts/perpl-market-data-capture.mjs. Datos públicos, sin cuenta.`, url, stream, capturedAt };
  const body = frames.map((f) => "    " + JSON.stringify(f)).join(",\n");
  writeFileSync(out, JSON.stringify(head, null, 2).replace(/\n}$/, ",\n  \"frames\": [\n" + body + "\n  ]\n}\n"));
  console.log(`${frames.length} frames → ${out}`, counts);
  if (!counts[15] || !counts[16]) { console.error("missing snapshot (mt 15) or update (mt 16): run longer (--seconds 60)"); process.exit(2); }
}, seconds * 1000);
