import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { createServerClient } from "@supabase/ssr";
import { openBrowser } from "../design/lib/browser.mjs";

const directory = process.argv[2];
const registered = ["combined", "rules", "deepseek", "jev"];
const strategies = process.argv.length > 3 ? process.argv.slice(3) : registered;
assert.ok(strategies.every((strategy) => registered.includes(strategy)));
assert.equal(new Set(strategies).size, strategies.length);
const { identity } = JSON.parse(await readFile(join(directory, "controlled-stack.json"), "utf8"));
const status = JSON.parse(await readFile(join(directory, "status.json"), "utf8"));
const database = new URL(status.DB_URL);
assert.equal(database.hostname, "127.0.0.1");
assert.ok(["55522", "55532"].includes(database.port));
assert.equal(database.pathname, "/postgres");
assert.equal(database.search, "");
assert.equal(status.API_URL, `http://127.0.0.1:${Number(database.port) - 1}`);
const pool = new Pool({ connectionString: status.DB_URL, max: 1 });
const marker = await pool.query(
  "SELECT identity FROM pickler_worker_test.identity WHERE singleton=true",
);
assert.equal(marker.rows.length, 1);
assert.equal(marker.rows[0].identity, identity);
const artifactDirectory = join(directory, "runs", `${Date.now()}-${randomUUID()}`);
await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
console.log(`Private acceptance evidence: ${artifactDirectory}`);
const browser = await openBrowser();
const capture = JSON.parse(
  await readFile(
    new URL("../../packages/perpl-context/test/fixtures/context.json", import.meta.url),
    "utf8",
  ),
);
const originalPrecision = (symbol) =>
  capture.markets.find((market) => market.size_units === symbol).config.size_decimals;
const results = [];
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const startedAt = new Date().toISOString();
async function run(strategy) {
  const context = await browser.newContext({ timezoneId: "UTC" });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
      return route.abort("blockedbyclient");
    }
    if (!["http://localhost:8790", "http://127.0.0.1:8790", status.API_URL].includes(url.origin)) {
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  const requests = [];
  const pageErrors = [];
  const waitForResponse = (predicate) => {
    const response = page.waitForResponse(predicate, { timeout: 120000 });
    void response.catch(() => {});
    return response;
  };
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/v1/")) {
      requests.push({
        path: url.pathname,
        method: response.request().method(),
        status: response.status(),
      });
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  try {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const email = `studio-${suffix}@example.com`;
    const password = randomUUID() + "aA1!";
    const created = await fetch(status.API_URL + "/auth/v1/admin/users", {
      method: "POST",
      headers: {
        apikey: status.SERVICE_ROLE_KEY,
        Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    assert.equal(created.status, 200);
    const user = await created.json();
    const cookies = [];
    const client = createServerClient(status.API_URL, status.ANON_KEY, {
      cookieOptions: { secure: false },
      cookies: {
        getAll: () => cookies,
        setAll: (values) => {
          cookies.splice(0, cookies.length, ...values);
        },
      },
    });
    const login = await client.auth.signInWithPassword({ email, password });
    assert.equal(login.error, null);
    await context.addCookies(
      cookies.map(({ name, value }) => ({
        name,
        value,
        url: "http://localhost:8790",
        sameSite: "Lax",
      })),
    );
    await writeFile(
      join(artifactDirectory, `${strategy}-actor.json`),
      JSON.stringify({ userId: user.id, session: login.data.session }),
      { mode: 0o600 },
    );
    await page.goto("http://localhost:8790/signup?step=passkey");
    await page.getByRole("button", { name: "Create passkey", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByPlaceholder("nightowl").fill(`s${suffix}`);
    const profileSaved = waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/profile") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    assert.equal((await profileSaved).status(), 201);
    await pool.query(
      "INSERT INTO pickler.research_access(user_id,enabled) VALUES($1,true) ON CONFLICT(user_id) DO UPDATE SET enabled=true",
      [user.id],
    );
    await page.goto("http://localhost:8790/studio");
    await page.getByLabel("Name it", { exact: true }).fill(`A${suffix} ${strategy}`);
    await page.getByRole("button", { name: "Analyst", exact: true }).click();
    const marketPicker = page.getByRole("region", { name: "Trading markets" });
    await marketPicker.getByRole("button", { name: "BTC", exact: true }).click();
    await marketPicker.getByRole("button", { name: "SOL", exact: true }).click();
    await page
      .getByRole("button", { name: "Create its wallet · 2 signatures", exact: true })
      .click();
    if (strategy === "combined") {
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM wallets.wallets WHERE user_id=$1 AND kind='agent'",
            [user.id],
          )
        ).rows[0].n,
        0,
      );
      await page
        .getByRole("button", { name: "Create its wallet · 2 signatures", exact: true })
        .click();
    }
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    if (strategy === "combined") {
      await page
        .locator('dialog[open][data-step="2"][data-phase="idle"]')
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Let Pickler trade from it · step 2", exact: true })
        .click();
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM wallets.wallets WHERE user_id=$1 AND kind='agent'",
            [user.id],
          )
        ).rows[0].n,
        1,
      );
    }
    // The delegated user's second signature requires a fresh user gesture.
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.waitForTimeout(2000);
    await page.screenshot({
      path: join(artifactDirectory, `${strategy}-wallet.png`),
      fullPage: true,
    });
    const token = login.data.session.access_token;
    const api = (
      path,
      body,
      method = body === undefined ? "GET" : "POST",
      key = randomUUID(),
      credential = token,
    ) =>
      page.evaluate(
        async ({ path, body, method, key, credential }) => {
          const response = await fetch(`/api/v1${path}`, {
            method,
            headers: {
              ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
              "Content-Type": "application/json",
              "Idempotency-Key": key,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          return { status: response.status, body: await response.json() };
        },
        { path, body, method, key, credential },
      );
    const control = async (scenario, extra = {}) => {
      const response = await fetch("http://127.0.0.1:8798/control", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Controlled-Identity": identity },
        body: JSON.stringify({ scenario, ...extra }),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    await control("open");
    console.log(`${strategy}: wallet ready; creating draft`);
    const retryMarkets = marketPicker.getByRole("button", { name: "Retry catalogue", exact: true });
    if (await retryMarkets.isVisible()) {
      await retryMarkets.click();
      await marketPicker
        .getByRole("button", { name: "SOL", exact: true })
        .waitFor({ state: "visible" });
      await page.waitForFunction(
        () =>
          document.querySelector(
            '[aria-label="Trading markets"] [aria-label="Perpl market catalogue"] button',
          )?.disabled === false,
      );
    }
    const creation = waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/studio/drafts") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: new RegExp(`^Create A${suffix}`) }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const createdDraft = await creation;
    assert.equal(createdDraft.status(), 201);
    const { productId } = await createdDraft.json();
    assert.ok(productId);
    const product = `/studio/agents/${productId}`;
    const draftBody = createdDraft.request().postDataJSON();
    const repeats = await Promise.all([
      api("/studio/drafts", draftBody),
      api("/studio/drafts", draftBody),
    ]);
    assert.ok(
      repeats.every((response) => response.status === 201 && response.body.productId === productId),
    );
    const reassigned = await api("/studio/drafts", { ...draftBody, name: "Changed owner terms" });
    assert.equal(reassigned.status, 409);
    assert.equal(reassigned.body.error, "WALLET_ASSIGNED");
    const mapping = await pool.query(
      `SELECT a.created_by,w.user_id,w.wallet_id,array_length(w.approved_policy_ids,1) AS policies,
        p.tenant_id,p.runtime_agent_id
       FROM agents.agents a JOIN pickler.product_agents p ON p.product_agent_id=a.id
       JOIN wallets.agent_wallets link ON link.agent_id=a.id
       JOIN wallets.wallets w ON w.wallet_id=link.wallet_id WHERE a.id=$1`,
      [productId],
    );
    assert.equal(mapping.rows.length, 1);
    assert.equal(mapping.rows[0].created_by, user.id);
    assert.equal(mapping.rows[0].user_id, user.id);
    assert.equal(mapping.rows[0].wallet_id, draftBody.walletId);
    assert.ok(mapping.rows[0].policies >= 3);
    for (const prior of results) {
      assert.equal((await api(`/studio/agents/${prior.productId}`)).status, 404);
      assert.equal((await api(`/studio/agents/${prior.productId}/perps/positions`)).status, 404);
    }
    const list = await api("/studio/agents");
    assert.equal(list.status, 200);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM pickler.product_agents WHERE product_agent_id=$1",
          [productId],
        )
      ).rows[0].n,
      1,
    );
    assert.equal((await api(product + "/schedule", { enabled: true }, "PUT")).status, 409);
    assert.equal((await api(product, undefined, "GET", randomUUID(), null)).status, 401);
    assert.equal((await api(product, undefined, "GET", randomUUID(), "invalid")).status, 401);

    await page.goto(`http://localhost:8790/studio?agent=${productId}`);
    await page.locator("#draft-rail-brief").click();
    console.log(`${strategy}: draft created; configuring`);
    const saved = waitForResponse(
      (response) =>
        response.url().endsWith(product + "/setup") && response.request().method() === "PUT",
    );
    if (strategy === "rules") {
      await page.getByLabel("Strategy", { exact: true }).selectOption(strategy);
      await page
        .getByRole("button", { name: "Clear conditions and save rules", exact: true })
        .click();
    } else {
      await page
        .locator("#draft-brief-thesis")
        .fill("Controlled price evidence only; virtual acceptance, not profitability.");
      await page.locator("#draft-brief-enters").fill("The controlled market trend is positive");
      await page.locator("#draft-brief-exits").fill("");
      await page.locator("#draft-brief-never").fill("");
      await page.getByRole("button", { name: "Save brief", exact: true }).click();
    }
    assert.equal((await saved).status(), 200);
    // The setup response precedes Studio's version refresh; wait for the saved UI phase.
    await page
      .locator("#draft-section-brief")
      .getByRole("button", { name: "Saved", exact: true })
      .waitFor({ state: "visible" });
    if (!["rules", "combined"].includes(strategy)) {
      const selected = waitForResponse(
        (response) =>
          response.url().endsWith(product + "/setup") && response.request().method() === "PUT",
      );
      await page.getByLabel("Strategy", { exact: true }).selectOption(strategy);
      await page.getByRole("button", { name: "Save strategy", exact: true }).click();
      assert.equal((await selected).status(), 200);
    }
    let agent = (await api(product)).body;
    assert.equal(agent.scheduleEnabled, false);
    assert.equal(agent.config.perpsStrategy?.id ?? "combined", strategy);
    assert.equal(agent.config.perpsStrategy?.version ?? "2.1.0", "2.1.0");
    await control("open", { funded: false });
    const unfunded = await api(product + "/publish", {});
    assert.equal(unfunded.status, 409, JSON.stringify(unfunded.body));
    assert.equal(unfunded.body.error, "PUBLISH_BLOCKED");
    await control("open", { funded: true });
    await page.locator("#draft-rail-overview").click();
    await page
      .getByRole("button", { name: "SKIP X FOR NOW · IT POSTS ON PICKLER ONLY", exact: true })
      .click();
    const published = waitForResponse(
      (response) =>
        response.url().endsWith(product + "/publish") && response.request().method() === "POST",
    );
    await page.locator("#draft-go-public-button").click();
    assert.equal((await published).status(), 200);
    assert.equal((await api(product)).body.scheduleEnabled, false);
    agent = (await api(product)).body;
    const setup = await api(
      product + "/setup",
      {
        expectedVersion: agent.version,
        entry: {
          mode: strategy === "combined" ? "approve" : "auto",
          meanwhile: "wait",
          smallAusd: 1,
        },
      },
      "PUT",
    );
    assert.equal(setup.status, 200, JSON.stringify(setup.body));
    agent = (await api(product)).body;

    const poll = async (path, final) => {
      const deadline = Date.now() + 205000;
      let value;
      do {
        const response = await api(path);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        value = response.body;
        if (final(value)) {
          return value;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      } while (Date.now() < deadline);
      assert.fail(`Controlled execution did not finish: ${JSON.stringify(value)}`);
    };
    const check = async (scenario) => {
      await control(scenario);
      const key = randomUUID();
      const starts = await Promise.all([
        api(product + "/perps/checks", {}, "POST", key),
        api(product + "/perps/checks", {}, "POST", key),
      ]);
      assert.equal(starts[0].status, 202, JSON.stringify(starts[0].body));
      assert.equal(starts[1].status, 202, JSON.stringify(starts[1].body));
      assert.equal(starts[0].body.checkId, starts[1].body.checkId);
      const result = await poll(
        `/studio/perps/checks/${starts[0].body.checkId}`,
        (value) => value.status === "finished",
      );
      return result;
    };
    const open = await check("open");
    assert.notEqual(open.outcome, "failed", JSON.stringify(open));
    assert.equal(open.strategyResult.protocol, "studio-perps-check-v2");
    assert.deepEqual(open.strategyResult.strategy, { id: strategy, version: "2.1.0" });
    const models = (await control("open")).calls
      .filter((call) => call.check_id === open.id)
      .map((call) => call.key);
    assert.deepEqual(
      models,
      { rules: [], deepseek: ["direct"], jev: ["jev"], combined: ["fallback", "review"] }[strategy],
    );
    assert.equal(open.costMicros, String(models.length * 11));
    const approvePending = async () => {
      if (strategy !== "combined") {
        return;
      }
      const proposals = (await api(product + "/perps/proposals")).body;
      for (const proposal of proposals.proposals) {
        const started = await api(`/studio/perps/proposals/${proposal.id}/approve`, {});
        assert.equal(started.status, 202);
        const action = await poll(`/studio/perps/actions/${started.body.actionId}`, (value) =>
          ["done", "failed", "blocked"].includes(value.status),
        );
        assert.equal(action.status, "done", JSON.stringify(action));
      }
    };
    await approvePending();
    let positions = (await api(product + "/perps/positions")).body;
    // The unchanged creator default allows only one open position across both markets.
    assert.equal(positions.open.length, 1, JSON.stringify(positions));
    for (const position of positions.open) {
      const best = position.instrument === "BTC" ? 60001 : 3001;
      assert.equal(Number(position.entryPrice), best);
      // Independent rational sizing oracle: creator's five AUSD, 1x, worst allowed price.
      const precision = originalPrecision(position.instrument);
      const expected = Math.floor((5 * 10 ** precision) / (best * 1.005)) / 10 ** precision;
      assert.equal(Number(position.quantity), expected);
      assert.equal(Number(position.notional), expected * best);
    }
    // The first market is usable but the complete selected set is not: no partial paid analysis.
    const partial = await check("partial");
    assert.equal(partial.outcome, "failed", JSON.stringify(partial));
    const partialCalls = (await control("hold")).calls.filter(
      (call) => call.check_id === partial.id,
    );
    assert.equal(partialCalls.length, 0);
    assert.equal((await api(product + "/perps/positions")).body.open.length, 1);
    // A real read transport failure must not look like confirmed runtime disablement.
    const recordPath = `**${product}/perps/record`;
    await page.route(recordPath, (route) => route.abort("failed"));
    await page.goto(`http://localhost:8790/studio?agent=${productId}`);
    await page.locator("#live-rail-console").click();
    await page.getByRole("button", { name: "Retry runtime", exact: true }).waitFor();
    assert.ok(
      (
        await page
          .getByRole("alert")
          .filter({ hasText: "Runtime availability could not be read" })
          .innerText()
      ).includes("could not be read"),
    );
    await page.unroute(recordPath);
    await page.getByRole("button", { name: "Retry runtime", exact: true }).click();
    await page
      .getByRole("button", { name: "Retry runtime", exact: true })
      .waitFor({ state: "hidden" });
    const held = await check("hold");
    assert.notEqual(held.outcome, "failed", JSON.stringify(held));
    assert.equal((await api(product + "/perps/positions")).body.open.length, 1);
    await page.goto(`http://localhost:8790/studio?agent=${productId}`);
    await page.locator("#live-rail-controls").click();
    const enabled = waitForResponse(
      (response) =>
        response.url().endsWith(product + "/schedule") && response.request().method() === "PUT",
    );
    await page.getByRole("switch", { name: "Hourly paper checks", exact: true }).click();
    assert.equal((await enabled).status(), 200);
    assert.equal((await api(product)).body.scheduleEnabled, true);
    const minute = Number(BigInt(`0x${productId.split("-")[0]}`) % 60n);
    let at = Math.floor(Date.now() / 3600000) * 3600000 + minute * 60000;
    if (at < Date.now()) {
      at += 3600000;
    }
    const dispatched = await fetch("http://127.0.0.1:8790/api/v1/__acceptance/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Controlled-Identity": identity },
      body: JSON.stringify({ at }),
    });
    assert.equal(dispatched.status, 200);
    const hourlyIds = (await dispatched.json()).checks;
    assert.ok(hourlyIds.length > 0);
    const currentHourly = await pool.query(
      `SELECT id FROM pickler.perps_checks
       WHERE product_agent_id=$1 AND id=ANY($2::uuid[]) AND trigger='hourly'`,
      [productId, hourlyIds],
    );
    assert.equal(currentHourly.rows.length, 1);
    const hourly = await poll(
      `/studio/perps/checks/${currentHourly.rows[0].id}`,
      (value) => value.status === "finished",
    );
    assert.notEqual(hourly.outcome, "failed", JSON.stringify(hourly));
    const disabled = waitForResponse(
      (response) =>
        response.url().endsWith(product + "/schedule") && response.request().method() === "PUT",
    );
    await page.getByRole("switch", { name: "Hourly paper checks", exact: true }).click();
    assert.equal((await disabled).status(), 200);
    assert.equal((await api(product)).body.scheduleEnabled, false);
    const signalClose = await check("close");
    assert.notEqual(signalClose.outcome, "failed", JSON.stringify(signalClose));
    assert.equal((await api(product + "/perps/positions")).body.open.length, 0);
    assert.equal((await api(product + "/perps/positions")).body.closed.length, 1);
    const reopened = await check("open");
    assert.notEqual(reopened.outcome, "failed", JSON.stringify(reopened));
    await approvePending();
    positions = (await api(product + "/perps/positions")).body;
    assert.equal(positions.open.length, 1, JSON.stringify(positions));
    // Edit through the actual Sources form while its removed market still has exposure.
    const removedSymbol = positions.open[0].instrument;
    const beforeEdit = (await api(product)).body;
    await page.goto(`http://localhost:8790/studio?agent=${productId}`);
    await page.locator("#live-rail-skills").click();
    const picker = page.getByRole("region", { name: "Trading markets", exact: true });
    await picker.getByRole("button", { name: `${removedSymbol} · Remove`, exact: true }).click();
    const retry = picker.getByRole("button", { name: "Retry catalogue", exact: true });
    if (await retry.isVisible()) {
      await retry.click();
    }
    const marketSaved = waitForResponse(
      (response) =>
        response.url().endsWith(product + "/setup") && response.request().method() === "PUT",
    );
    await page
      .locator("#live-sources-bar")
      .getByRole("button", { name: /^Apply as v/ })
      .click();
    assert.equal((await marketSaved).status(), 200);
    agent = (await api(product)).body;
    assert.equal(agent.version, beforeEdit.version + 1);
    assert.equal(agent.scheduleEnabled, false);
    assert.deepEqual(agent.config.perpl.markets, [removedSymbol === "BTC" ? "SOL" : "BTC"]);
    assert.deepEqual(agent.config.perpsStrategy, { id: strategy, version: "2.1.0" });
    const prepared = await pool.query(
      `SELECT m.value FROM pickler.product_agents p LEFT JOIN pickler.metadata m
       ON m.key='connections_checked:' || p.tenant_id || ':' || p.runtime_agent_id || ':' || $2
       WHERE p.product_agent_id=$1`,
      [productId, String(agent.version)],
    );
    assert.notEqual(prepared.rows[0]?.value, "true");
    const supervised = await check("hold");
    assert.notEqual(supervised.outcome, "failed", JSON.stringify(supervised));
    assert.ok(
      supervised.strategyResult.actions.every((action) => action.proposal.symbol !== removedSymbol),
    );
    assert.equal((await api(product + "/perps/positions")).body.open.length, 1);
    // The earlier partial frame already proves stale data fails without paid calls.
    // Reuse that evidence instead of exceeding the unchanged six-manual-check daily limit.
    const stale = partial;
    const staleCalls = partialCalls;
    const paused = await api(product + "/pause", { paused: true }, "PUT");
    assert.equal(paused.status, 200);
    for (const position of positions.open) {
      const started = await api(`/studio/perps/positions/${position.id}/close`, {});
      assert.equal(started.status, 202);
      const action = await poll(`/studio/perps/actions/${started.body.actionId}`, (value) =>
        ["done", "failed", "blocked"].includes(value.status),
      );
      assert.equal(action.status, "done", JSON.stringify(action));
    }
    positions = (await api(product + "/perps/positions")).body;
    assert.equal(positions.open.length, 0);
    assert.equal(positions.closed.length, 2);
    await page.goto(`http://localhost:8790/studio?agent=${productId}`);
    await page.locator("#live-rail-positions").click();
    await page.locator("#live-section-positions").waitFor({ state: "visible" });
    await page.waitForFunction(() =>
      document.querySelector("#live-positions-open")?.textContent?.includes("0 OPEN"),
    );
    await page.locator("#live-rail-record").click();
    await page.waitForFunction(
      () => document.querySelectorAll("#live-record-closed > li").length === 2,
    );
    const closedText = await page.locator("#live-record-closed").innerText();
    for (const position of positions.closed) {
      assert.ok(closedText.includes(`${position.instrument}-PERP`));
    }
    await page.waitForFunction(() =>
      document.querySelector("#live-strip")?.textContent?.includes("Last check"),
    );
    await page.screenshot({
      path: join(artifactDirectory, `${strategy}-closed.png`),
      fullPage: true,
    });
    const record = (await api(product + "/perps/record")).body;
    let expectedCashMicros = 1_000_000_000n;
    for (const position of positions.closed) {
      const best = position.instrument === "BTC" ? 60001 : 3001;
      const scale = 10n ** BigInt(originalPrecision(position.instrument));
      const lots = (5n * scale * 1000n) / (BigInt(best) * 1005n);
      const entry = (lots * BigInt(best) * 1_000_000n) / scale;
      const exit = (lots * BigInt(best - 2) * 1_000_000n) / scale;
      const fee = (notional) => (notional * 345n + 999_999n) / 1_000_000n;
      assert.equal(Number(position.entryPrice), best);
      assert.equal(Number(position.exitPrice), best - 2);
      expectedCashMicros += exit - entry - fee(entry) - fee(exit);
    }
    assert.equal(Math.round(record.cashAusd * 1_000_000), Number(expectedCashMicros));
    assert.equal(record.closedCount, positions.closed.length);
    const ledger = await pool.query(
      "SELECT status,cost_micros::text FROM pickler.perps_check_calls WHERE check_id=$1",
      [open.id],
    );
    assert.equal(ledger.rows.length, models.length);
    assert.ok(
      ledger.rows.every((call) => call.status === "completed" && call.cost_micros === "11"),
    );
    assert.deepEqual(pageErrors, [], "Compiled Studio must not recover from hydration errors");
    results.push({
      strategy,
      productId,
      version: agent.version,
      modelOrder: models,
      open: open.outcome,
      held: held.outcome,
      hourly: hourly.outcome,
      signalClose: signalClose.outcome,
      partial: { outcome: partial.outcome, calls: partialCalls.length },
      removedMarket: {
        symbol: removedSymbol,
        selected: agent.config.perpl.markets,
        outcome: supervised.outcome,
      },
      runtimeReadFailureRecovered: true,
      stale: { outcome: stale.outcome, calls: staleCalls.length },
      closed: positions.closed.length,
      cashAusd: record.cashAusd,
      expectedCashMicros: String(expectedCashMicros),
      modelCostMicros: open.costMicros,
    });
    console.log(
      `${strategy}@2.1.0: creation, configuration, Queue decisions, scheduling and paused closes passed`,
    );
  } catch (error) {
    await writeFile(
      join(artifactDirectory, `${strategy}-page.txt`),
      await page.locator("body").innerText(),
    );
    await page.screenshot({
      path: join(artifactDirectory, `${strategy}-failure.png`),
      fullPage: true,
    });
    throw error;
  } finally {
    await writeFile(
      join(artifactDirectory, `${strategy}-requests.json`),
      JSON.stringify(requests, null, 2),
    );
    await context.close();
  }
}
try {
  for (const strategy of strategies) {
    await run(strategy);
  }
  await writeFile(
    join(
      artifactDirectory,
      strategies.length === 4 ? "acceptance.json" : "acceptance-diagnostic.json",
    ),
    JSON.stringify(
      {
        sourceCommit,
        startedAt,
        completedAt: new Date().toISOString(),
        externalProviders: "controlled",
        fullAcceptance: strategies.length === 4,
        dispatchClock: "Controlled within one hour; execution clock remains real",
        configuration: {
          strategies: "2.1.0",
          markets: ["BTC", "SOL"],
          creatorMarginAusd: 5,
          maxOpenPositions: 1,
          modelUsage: { inputTokens: 100, outputTokens: 10 },
          syntheticTariffMicrosPerMillion: 100000,
          costMicrosPerModelCall: 11,
          funding: "Known historical zero-rate anchor before execution block; no eligible events",
        },
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await pool.end();
}
