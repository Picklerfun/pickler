/** Compiled-product route acceptance; reuses a synthetic actor from the full controlled suite. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { createServerClient } from "@supabase/ssr";
import {
  assertControlledDatabase,
  assertControlledDatabaseUrl,
} from "@pickler/infrastructure/testing/controlled-worker";
import { openBrowser } from "../design/lib/browser.mjs";

const [directory, runDirectory] = process.argv.slice(2);
assert.ok(directory && runDirectory, "Supply the private stack and a completed acceptance run");
const status = JSON.parse(await readFile(join(directory, "status.json"), "utf8"));
const { identity } = JSON.parse(await readFile(join(directory, "controlled-stack.json"), "utf8"));
assertControlledDatabaseUrl(status.DB_URL);
const database = new URL(status.DB_URL);
assert.equal(status.API_URL, `http://127.0.0.1:${Number(database.port) - 1}`);
const accepted = JSON.parse(await readFile(join(runDirectory, "acceptance.json"), "utf8"));
assert.equal(accepted.fullAcceptance, true);
assert.equal(accepted.externalProviders, "controlled");
const actor = JSON.parse(await readFile(join(runDirectory, "combined-actor.json"), "utf8"));
assert.equal(actor.session.user.id, actor.userId);
const pool = new Pool({ connectionString: status.DB_URL, max: 1 });
try {
  await assertControlledDatabase(pool, identity);
} finally {
  await pool.end();
}
const base = "http://localhost:8790";
const api = async (path, body) => {
  const response = await fetch(`${base}/api/v1/studio/${path}`, {
    method: body ? "PUT" : "GET",
    headers: {
      Authorization: `Bearer ${actor.session.access_token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal(response.status, 200, path);
  return response.json();
};
const { agents } = await api("agents");
assert.equal(agents.length, 1);
const agent = agents[0];
const id = agent.productId ?? agent.id;
assert.equal(agent.scheduleEnabled, false);
assert.equal((await api(`agents/${id}/perps/positions`)).open.length, 0);
const cookies = [];
const client = createServerClient(status.API_URL, status.ANON_KEY, {
  cookieOptions: { secure: false },
  cookies: {
    getAll: () => cookies,
    setAll: (values) => cookies.splice(0, cookies.length, ...values),
  },
});
const login = await client.auth.setSession(actor.session);
assert.equal(login.error, null);
const browser = await openBrowser();
const context = await browser.newContext();
await context.addCookies(
  cookies.map(({ name, value }) => ({ name, value, url: base, sameSite: "Lax" })),
);
const requests = [];
const errors = [];
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (![new URL(base).origin, status.API_URL].includes(url.origin)) {
    return route.abort("blockedbyclient");
  }
  return route.continue();
});
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  const path = new URL(response.url()).pathname;
  if (path.startsWith("/api/")) {
    requests.push({ path, method: response.request().method(), status: response.status() });
  }
});
const artifacts = join(directory, "routing", randomUUID());
await mkdir(artifacts, { recursive: true, mode: 0o700 });
try {
  await page.goto(`${base}/studio/agents/${id}/brief`);
  const input = page.locator("#live-brief-thesis");
  await input.waitFor();
  const original = await input.inputValue();
  const edited = "Temporary route acceptance; this text must never overwrite concurrent setup.";
  await input.fill(edited);
  await page.locator("#live-rail-skills").click();
  await page.locator("#live-rail-brief").click();
  assert.equal(await input.inputValue(), edited);
  await page.locator("[data-account-menu] > button").click();
  await page.getByRole("menuitem", { name: "My profile", exact: true }).click();
  await page.getByRole("link", { name: "Back to studio", exact: false }).click();
  await input.waitFor();
  assert.equal(new URL(page.url()).pathname, `/studio/agents/${id}/brief`);
  assert.equal(await input.inputValue(), edited);

  const before = await api(`agents/${id}`);
  await api(`agents/${id}/setup`, {
    expectedVersion: before.version,
    voice: before.config.voice === "analyst" ? "contrarian" : "analyst",
  });
  await page.getByRole("button", { name: /^Apply as v/ }).click();
  const discard = page.getByRole("button", { name: "Discard edits and reload", exact: true });
  await discard.waitFor();
  assert.equal(await input.inputValue(), edited);
  await discard.click();
  assert.equal(await input.inputValue(), original);
  assert.equal((await api(`agents/${id}`)).version, before.version + 1);

  const foreign = accepted.results.find((result) => result.productId !== id);
  assert.ok(foreign, "The full run must include an independent creator");
  await page.goto(`${base}/studio/agents/${foreign.productId}/brief`);
  await page.getByRole("heading", { name: "NOTHING HERE.", exact: true }).waitFor();
  assert.equal(await page.locator("#live-studio, #draft-studio").count(), 0);
  await page.goto(`${base}/studio/agents/${randomUUID()}/brief`);
  await page.getByRole("heading", { name: "NOTHING HERE.", exact: true }).waitFor();
  assert.equal(await page.locator("#live-studio, #draft-studio").count(), 0);
  await page.goto(`${base}/studio/agents/${id}/not-a-section`);
  await page.getByRole("heading", { name: "NOTHING HERE.", exact: true }).waitFor();
  assert.equal(await page.locator("#live-studio, #draft-studio").count(), 0);
  const anonymous = await browser.newContext();
  const anonymousPage = await anonymous.newPage();
  const requested = `/studio/agents/${id}/brief?check=route-check`;
  await anonymousPage.goto(base + requested);
  await anonymousPage.waitForURL("**/signin?next=*");
  assert.equal(new URL(anonymousPage.url()).searchParams.get("next"), requested);
  await anonymous.close();
  assert.deepEqual(errors, []);
  assert.equal(
    requests.filter(
      ({ path, method }) =>
        /\/x\/posts$/.test(path) || (method === "POST" && /\/perps\/checks$/.test(path)),
    ).length,
    0,
  );
  assert.ok(
    requests.some(
      ({ path, method, status }) => path.endsWith("/setup") && method === "PUT" && status === 409,
    ),
  );
  await writeFile(
    join(artifacts, "result.json"),
    JSON.stringify({ externalProviders: "controlled", status: "passed", requests }, null, 2),
  );
  console.log(
    "PASS: compiled route/profile draft retention, real 409 recovery, invalid destinations, anonymous guard and zero execution/X-post requests.",
  );
} catch (error) {
  await page.screenshot({ path: join(artifacts, "failure.png"), fullPage: true });
  await writeFile(
    join(artifacts, "failure.json"),
    JSON.stringify({ error: String(error), errors, requests }, null, 2),
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
}
