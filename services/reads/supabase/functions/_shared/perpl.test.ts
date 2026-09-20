import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import context from "./fixtures/context.json" with { type: "json" };
import { fetchMarkets, parseMarkets, PerplUnavailable } from "./perpl.ts";

Deno.test("parseMarkets: mercados abiertos por id con mark y price_decimals del fixture", () => {
  const m = parseMarkets(context);
  assertEquals([...m.keys()], [16, 32, 48, 64, 256, 272, 320]);
  assertEquals(m.get(16), { id: 16, symbol: "BTC", name: m.get(16)!.name, priceDecimals: 1, mark: 762555, prev: m.get(16)!.prev, isOpen: true });
  assertEquals(m.get(64)?.priceDecimals, 5);
});

Deno.test("parseMarkets rechaza un payload sin markets", () => {
  let threw = false;
  try { parseMarkets({ instances: [] }); } catch { threw = true; }
  assertEquals(threw, true);
});

Deno.test("fetchMarkets: usa fetch inyectado y lanza PerplUnavailable con 5xx", async () => {
  const ok = await fetchMarkets("https://x.test/api", 1000, async () => new Response(JSON.stringify(context), { status: 200 }));
  assertEquals(ok.get(32)?.symbol, "ETH");
  await assertRejects(() => fetchMarkets("https://x.test/api", 1000, async () => new Response("nope", { status: 503 })), PerplUnavailable);
});
