import { readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { config } from "dotenv";
const [command, ...args] = process.argv.slice(2);
config({ quiet: true });
if (command === "init") {
  const template = await readFile(".env.example", "utf8");
  await writeFile(
    ".env",
    template
      .replace("TENANT_ALPHA_TOKEN=", `TENANT_ALPHA_TOKEN=${randomBytes(32).toString("hex")}`)
      .replace("TENANT_BETA_TOKEN=", `TENANT_BETA_TOKEN=${randomBytes(32).toString("hex")}`),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    "Created .env with distinct local tokens. Fill in database connection URLs and the four provider variables before starting.",
  );
} else if (command === "concurrency") {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the operator command");
  }
  const { setConcurrency } = await import("./composition/set-concurrency");
  await setConcurrency(databaseUrl, Number(args[0]), Number(args[1]));
  console.log("Shared concurrency policy updated; active research was not aborted.");
} else {
  const tenant = args[0] ?? "alpha";
  if (!["alpha", "beta"].includes(tenant)) {
    throw new Error("Choose alpha or beta");
  }
  const token = process.env[`TENANT_${tenant.toUpperCase()}_TOKEN`];
  if (!token) {
    throw new Error("Run init and configure .env first");
  }
  const agent = `pickle-${tenant}`;
  let path: string;
  let method = "GET";
  let body: unknown;
  switch (command) {
    case "trading-account":
      path = `/agents/${agent}/trading/account`;
      break;
    case "trading-orders":
      path = `/agents/${agent}/trading/orders`;
      break;
    case "trading-positions":
      path = `/agents/${agent}/trading/positions`;
      break;
    case "trading-prepare":
      path = `/agents/${agent}/trading/prepare`;
      method = "POST";
      body = JSON.parse(await readFile(args[1] ?? "buy.json", "utf8"));
      break;
    case "trading-submit":
      path = `/trading/orders/${encodeURIComponent(args[1] ?? "")}/submit`;
      method = "POST";
      body = {};
      break;
    case "trading-result":
      path = `/trading/orders/${encodeURIComponent(args[1] ?? "")}`;
      break;
    case "trading-run":
      path = `/runs/${encodeURIComponent(args[1] ?? "")}/live-order`;
      method = "POST";
      body = {};
      break;
    case "agents":
      path = "/agents";
      break;
    case "market-categories":
      path = "/market-categories";
      break;
    case "categories":
      path = "/categories";
      break;
    case "check":
      path = "/connections/check";
      method = "POST";
      break;
    case "configure":
      path = `/agents/${agent}/config`;
      method = "PUT";
      body = JSON.parse(await readFile(args[1] ?? "config.json", "utf8"));
      break;
    case "run":
      path = `/agents/${agent}/runs`;
      method = "POST";
      body = args[1] ? { marketId: args[1] } : {};
      break;
    case "paper-buy":
      path = `/runs/${encodeURIComponent(args[1] ?? "")}/paper-order`;
      method = "POST";
      body = {};
      break;
    case "paper-result":
      path = `/runs/${encodeURIComponent(args[1] ?? "")}/paper-order`;
      break;
    case "result":
      path = `/runs/${encodeURIComponent(args[1] ?? "")}`;
      break;
    case "events":
      path = `/runs/${encodeURIComponent(args[1] ?? "")}/events`;
      break;
    case "schedule":
      path = `/agents/${agent}/schedule`;
      method = "PUT";
      if (!["on", "off"].includes(args[1] ?? "")) {
        throw new Error("Use on or off");
      }
      body = { enabled: args[1] === "on" };
      break;
    case "pause":
    case "resume":
      path = `/agents/${agent}/pause`;
      method = "PUT";
      body = { paused: command === "pause" };
      break;
    default:
      throw new Error(
        "Commands: init, agents, categories, market-categories, check, configure, run, result, events, paper-buy, paper-result, trading-account, trading-orders, trading-positions, trading-prepare, trading-submit, trading-result, trading-run, schedule, pause, resume. Each accepts alpha|beta (default alpha).",
      );
  }
  const response = await fetch(`http://127.0.0.1:4111/pilot${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": ["trading-prepare", "trading-submit", "trading-run"].includes(command)
        ? (args[2] ?? `live:${args[1] ?? ""}`)
        : command === "paper-buy"
          ? (args[2] ?? `paper:${args[1] ?? ""}`)
          : randomUUID(),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(240_000),
  });
  console.log(JSON.stringify(await response.json(), null, 2));
  if (!response.ok) {
    process.exitCode = 1;
  }
}
