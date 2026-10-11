/** Loopback-only landing discovery acceptance; no wallets, providers or production data. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBrowser } from "./lib/browser.mjs";
import { listening } from "./lib/servers.mjs";
import { createSampleAgentDirectory } from "./fixtures/sample-agent-directory.mts";
import {
  toDirectoryAgentDto,
  toAgentPersonaDto,
} from "../../workers/api/src/growth/agent-responses.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "scripts/design/.shots/diagnostics/token-discovery");
const webPort = 3012;
const apiPort = 8802;
const base = `http://localhost:${webPort}`;
const token = {
  name: "Controlled agent token",
  ticker: "$HALF",
  chainId: 10143,
  address: "0x1111111111111111111111111111111111111111",
  imageUri: null,
  avatar: { accent: "lime", pattern: 1 },
};
const directory = createSampleAgentDirectory({ now: () => new Date("2026-10-11T12:00:00Z") });
const entries = (await directory.listDirectory()).map(toDirectoryAgentDto);
const entry = entries[0];
assert.ok(entry);
const persona = await directory.getPersona(entry.agent.handle);
assert.ok(persona);
const scenarios = [],
  errors = [],
  forbidden = [];
let state = "empty",
  browser,
  page,
  web;
mkdirSync(output, { recursive: true });
assert.equal(await listening(webPort), false, "Acceptance web port is occupied.");
assert.equal(await listening(apiPort), false, "Acceptance API port is occupied.");
const api = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    forbidden.push(`${req.method} ${req.url}`);
    res.writeHead(405).end("{}");
  } else if (req.url === "/v1/marketplace/activity") {
    res.end("[]");
  } else if (req.url === "/v1/marketplace/directory") {
    if (state === "error") {
      res.writeHead(503).end('{"error":"controlled_unavailable"}');
    } else {
      res.end(JSON.stringify([{ ...entry, launchedToken: state === "confirmed" ? token : null }]));
    }
  } else if (req.url === `/v1/marketplace/personas/${entry.agent.handle}`) {
    res.end(
      JSON.stringify(
        toAgentPersonaDto({ ...persona, launchedToken: token, tokenConfirmation: "confirmed" }),
      ),
    );
  } else {
    forbidden.push(`${req.method} ${req.url}`);
    res.writeHead(404).end("{}");
  }
});
try {
  await new Promise((resolve) => api.listen(apiPort, "127.0.0.1", resolve));
  const log = openSync(path.join(output, "server.log"), "a");
  try {
    web = spawn(
      process.execPath,
      [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(webPort)],
      {
        cwd: path.join(root, "apps/web"),
        detached: true,
        stdio: ["ignore", log, log],
        env: {
          ...process.env,
          PICKLER_API_LOCAL_URL: `http://127.0.0.1:${apiPort}`,
          NEXT_PUBLIC_SUPABASE_URL: "",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
        },
      },
    );
  } finally {
    closeSync(log);
  }
  const until = Date.now() + 30000;
  let ready = false;
  while (Date.now() < until) {
    try {
      ready = (await fetch(base)).ok;
    } catch {
      /* Startup only, never a provider retry. */
    }
    if (ready) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Production web did not start.");
  browser = await openBrowser();
  const context = await browser.newContext();
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["localhost", "127.0.0.1"].includes(url.hostname)) {
      await route.continue();
    } else {
      forbidden.push(url.origin + url.pathname);
      await route.abort();
    }
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const next of ["empty", "error", "confirmed"]) {
      state = next;
      await page.goto(base);
      const section = page.locator("#tokens");
      await section.getByRole("heading", { name: "Agent tokens", exact: true }).waitFor();
      if (next === "empty") {
        assert.match(await section.innerText(), /No confirmed agent tokens yet/);
      } else if (next === "error") {
        assert.match(await section.getByRole("status").innerText(), /temporarily unavailable/);
        assert.doesNotMatch(await section.innerText(), /No confirmed/);
      } else {
        const card = section.getByRole("link", { name: /Controlled agent token/ });
        assert.equal(await card.getAttribute("href"), `/agents/${entry.agent.handle}`);
        await card.focus();
        assert.equal(await card.evaluate((element) => element === document.activeElement), true);
        await section.screenshot({ path: path.join(output, `tokens-${width}.png`) });
        await card.press("Enter");
        await page.getByRole("region", { name: "Trade token publicly", exact: true }).waitFor();
      }
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        `${next} overflow at ${width}`,
      );
      scenarios.push({ width, state: next, status: "passed" });
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  writeFileSync(
    path.join(output, "result.json"),
    JSON.stringify({ scenarios, errors, forbidden }, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: scenarios.length,
      errors: errors.length,
      forbidden: forbidden.length,
    }),
  );
} catch (error) {
  writeFileSync(
    path.join(output, "failure.json"),
    JSON.stringify({ scenarios, errors, forbidden, error: error.message }, null, 2),
  );
  await page
    ?.screenshot({ path: path.join(output, "failure.png"), fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  if (web?.pid) {
    try {
      process.kill(-web.pid, "SIGTERM");
    } catch {
      /* Already closed. */
    }
  }
  await new Promise((resolve) => api.close(resolve));
}
