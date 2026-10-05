import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

const directory = process.argv[2];
const { identity } = JSON.parse(await readFile(join(directory, "controlled-stack.json"), "utf8"));
const status = JSON.parse(await readFile(join(directory, "status.json"), "utf8"));
const database = new URL(status.DB_URL);
if (
  database.hostname !== "127.0.0.1" ||
  database.port !== "55522" ||
  database.pathname !== "/postgres" ||
  database.search
) {
  throw new Error("Refusing an uncontrolled database");
}
const pool = new Pool({ connectionString: status.DB_URL, max: 1 });
const marker = await pool.query(
  "SELECT identity FROM pickler_worker_test.identity WHERE singleton=true",
);
if (marker.rows.length !== 1 || marker.rows[0].identity !== identity) {
  throw new Error("Wrong disposable database identity");
}
const original = JSON.parse(
  await readFile(
    new URL("../../packages/perpl-context/test/fixtures/context.json", import.meta.url),
    "utf8",
  ),
);
let scenario = "open";
let funded = true;
const calls = [];
const fundingTime = Date.now() - 120000;
const address = () => `0x${randomUUID().replaceAll("-", "")}00000000`;

function perpl(url) {
  const now = Date.now();
  const at = { b: 63177463, t: now };
  const context = structuredClone(original);
  for (const market of context.markets) {
    market.config.at = at;
    if (market.state) {
      market.state.at = at;
      const p =
        (market.size_units === "BTC" ? 60000 : market.size_units === "ETH" ? 3000 : 100) *
        10 ** market.config.price_decimals;
      Object.assign(market.state, { orl: p, mrk: p, lst: p, mid: p, bid: p - 1, ask: p + 1 });
    }
  }
  if (url.pathname.endsWith("/context")) {
    return context;
  }
  const id = Number(url.pathname.match(/market-data\/(\d+)/)?.[1]);
  const market = context.markets.find((item) => item.id === id);
  if (!market) {
    throw new Error("Unknown controlled market");
  }
  const units = 10 ** market.config.price_decimals;
  const price = (market.size_units === "BTC" ? 60000 : 3000) * units;
  if (scenario === "stale") {
    at.t -= 60000;
  }
  if (url.pathname.endsWith("/ticker")) {
    return {
      mt: 9,
      sn: 1,
      d: {
        [id]: {
          at,
          orl: price,
          mrk: price,
          lst: price,
          bid: price - units,
          ask: price + units,
          oi: 1,
        },
      },
    };
  }
  if (url.pathname.endsWith("/book")) {
    return {
      mt: 15,
      sn: 1,
      at,
      bid: [{ p: price - units, s: 100 * 10 ** market.config.size_decimals, o: 1 }],
      ask: [{ p: price + units, s: 100 * 10 ** market.config.size_decimals, o: 1 }],
    };
  }
  if (url.pathname.includes("/funding/")) {
    return {
      mt: 1,
      at,
      m: id,
      d: [{ at: { b: 63100000, t: fundingTime }, feb: 63100000, rate: 0, idx: price }],
    };
  }
  const candle = url.pathname.match(/candles\/(\d+)\/(\d+)-(\d+)/);
  if (candle) {
    const [, resolution, from, to] = candle.map(Number);
    const d = [];
    for (let t = from, i = 0; t <= to; t += resolution * 1000, i++) {
      const slope =
        scenario === "close" && market.size_units === "ETH"
          ? 0
          : market.size_units === "BTC"
            ? 20
            : 2;
      const c = price + (scenario === "close" ? -1 : 1) * (i - 60) * units * slope;
      d.push({ t, o: c, h: c + units, l: c - units, c, v: "1000000", n: 1 });
    }
    return { at, r: resolution, d };
  }
  throw new Error("Unconfigured Perpl operation");
}

function turnkey(body) {
  const kind = body.type;
  const wallet = { walletId: randomUUID(), addresses: [address()] };
  let result;
  if (kind.includes("CREATE_SUB_ORGANIZATION")) {
    result = {
      createSubOrganizationResultV8: {
        subOrganizationId: randomUUID(),
        rootUserIds: [randomUUID()],
        wallet,
      },
    };
  } else if (kind.includes("CREATE_USERS")) {
    result = { createUsersResult: { userIds: body.parameters.users.map(() => randomUUID()) } };
  } else if (kind.includes("CREATE_WALLET")) {
    result = { createWalletResult: wallet };
  } else if (kind.includes("CREATE_POLICIES")) {
    result = {
      createPoliciesResult: { policyIds: body.parameters.policies.map(() => randomUUID()) },
    };
  } else {
    throw new Error("Unconfigured custody operation; transfers are forbidden");
  }
  return {
    activity: {
      id: randomUUID(),
      status: "ACTIVITY_STATUS_COMPLETED",
      type: kind,
      organizationId: body.organizationId,
      result,
    },
  };
}

async function model(body, raw, jev) {
  const hash = createHash("sha256").update(raw).digest("hex");
  const recorded = await pool.query(
    "SELECT check_id,key,status FROM pickler.perps_check_calls WHERE request_sha256=$1 AND status='started'",
    [hash],
  );
  if (recorded.rows.length !== 1) {
    throw new Error("Model request missing its pre-transport cost record");
  }
  calls.push({ ...recorded.rows[0], hash, provider: jev ? "jev" : "deepseek", scenario });
  if (scenario === "transport") {
    throw new Error("Controlled transport failure");
  }
  if (jev) {
    const answers = {};
    for (const [key, question] of Object.entries(body.questions)) {
      const choices = Object.keys(question.criteria);
      let choice = choices[0];
      if (choices.includes("CONSISTENT")) {
        choice = scenario === "veto" ? "CONTRADICTED" : "CONSISTENT";
      } else if (key.endsWith("_long")) {
        choice =
          scenario === "uncertain" ? "UNKNOWN" : scenario === "close" ? "UNSUPPORTED" : "SUPPORTED";
      } else if (key.endsWith("_short")) {
        choice = "UNSUPPORTED";
      } else if (key.endsWith("_thesis")) {
        choice = scenario === "close" ? "INVALIDATED" : "INTACT";
      } else if (key.endsWith("_ref")) {
        choice = body.state.evidence.sourceIds[0] ?? "NONE";
      } else if (choices.includes("MET")) {
        choice = key.includes("_entries_") ? "MET" : "NOT_MET";
      }
      answers[key] = {
        type: "choice",
        choice,
        confidence: 1,
        probabilities: Object.fromEntries(
          choices.map((value) => [value, value === choice ? 1 : 0]),
        ),
      };
    }
    return { model: body.model, usage: { input_tokens: 100, output_tokens: 10 }, answers };
  }
  const context = JSON.parse(body.messages[1].content);
  const sourceIds =
    scenario === "bad-citation" ? ["nonexistent"] : context.evidence.sourceIds.slice(0, 1);
  const actions = context.markets.map((symbol) => ({
    symbol,
    action: scenario === "close" ? "close" : scenario === "hold" ? "hold" : "open-long",
    reason: "Controlled acceptance evidence",
    sourceIds,
    brief: Object.fromEntries(
      Object.entries({
        entries: context.brief.entersWhen,
        exits: context.brief.exitsWhen,
        never: context.brief.never,
      }).map(([section, lines]) => [
        section,
        lines.map((_, index) => ({
          index: index + 1,
          state: section === "entries" ? "met" : "not-met",
          reason: "Controlled evidence",
          sourceIds,
        })),
      ]),
    ),
  }));
  return {
    model: body.model,
    ...(scenario === "unknown-cost"
      ? {}
      : { usage: { prompt_tokens: 100, completion_tokens: 10 } }),
    choices: [
      {
        finish_reason: "stop",
        message: { content: scenario === "format" ? "invalid" : JSON.stringify({ actions }) },
      },
    ],
  };
}

const server = createServer(async (req, res) => {
  try {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 200000) {
        throw new Error("Controlled request too large");
      }
    }
    const payload = raw ? JSON.parse(raw) : {};
    let result;
    if (req.url === "/rpc") {
      const rpc = (item) => {
        if (!["eth_getBalance", "eth_call", "eth_chainId"].includes(item.method)) {
          throw new Error("Controlled RPC forbids signing and broadcasting");
        }
        return {
          jsonrpc: "2.0",
          id: item.id,
          result:
            item.method === "eth_chainId"
              ? "0x279f"
              : item.method === "eth_getBalance"
                ? "0xde0b6b3a7640000"
                : funded
                  ? "0x3b9aca00"
                  : "0x0",
        };
      };
      result = Array.isArray(payload) ? payload.map(rpc) : rpc(payload);
    } else {
      if (req.headers["x-controlled-identity"] !== identity) {
        res.writeHead(403).end();
        return;
      }
      if (req.url === "/control") {
        if (payload.scenario) {
          if (
            ![
              "open",
              "hold",
              "close",
              "veto",
              "stale",
              "uncertain",
              "format",
              "transport",
              "bad-citation",
              "unknown-cost",
            ].includes(payload.scenario)
          ) {
            throw new Error("Unknown controlled scenario");
          }
          scenario = payload.scenario;
        }
        funded = payload.funded ?? funded;
        result = { scenario, funded, calls };
      } else if (req.url === "/provider") {
        const url = new URL(payload.url);
        const body = payload.body ? JSON.parse(payload.body) : null;
        if (url.origin === "https://api.turnkey.com") {
          result = turnkey(body);
        } else if (["https://testnet.perpl.xyz", "https://app.perpl.xyz"].includes(url.origin)) {
          result = perpl(url);
        } else if (["https://controlled.invalid", "https://api.typesafe.ai"].includes(url.origin)) {
          result = await model(body, payload.body, url.origin === "https://api.typesafe.ai");
        } else {
          throw new Error("Unconfigured external provider");
        }
      } else {
        res.writeHead(404).end();
        return;
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    res
      .writeHead(503, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: "CONTROLLED_PROVIDER_FAILURE" }));
  }
});
server.listen(8798, "127.0.0.1", () => console.log("Controlled providers listening on loopback"));
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => pool.end().then(() => process.exit())));
}
