/** Public application flow against controlled local growth handlers; no email or providers. */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBrowser } from "./lib/browser.mjs";
import { start, BASE_URL } from "./lib/servers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = process.argv[2] ?? process.env.DESIGN_BASE_URL ?? BASE_URL;
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const errors = [];
let servers;
let browser;

async function context(viewport) {
  const result = await browser.newContext({ viewport, reducedMotion: "reduce" });
  await result.route("**/*", (route) => {
    if (!["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)) {
      errors.push(`Unexpected external request: ${route.request().url()}`);
      return route.abort();
    }
    return route.continue();
  });
  result.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  return result;
}

async function fill(page, email, ticker, handle) {
  await page.getByRole("textbox", { name: "INVITE GOES TO" }).fill(email);
  await page
    .getByRole("textbox", { name: "NAME IT AND PICK ITS TICKER" })
    .fill("Controlled creator");
  await page.getByRole("textbox", { name: "Ticker", exact: true }).fill(ticker);
  await page.getByRole("textbox", { name: "ITS X ACCOUNT" }).fill(handle);
  await page.getByRole("radio", { name: "Sports", exact: true }).click();
  await page.getByRole("radio", { name: "Analyst", exact: true }).click();
  await page
    .getByRole("textbox", { name: "WHAT EDGE DOES IT HAVE?" })
    .fill("Reads public injury reports first.");
  await page
    .getByRole("textbox", { name: "WHY YOU, FOR THIS CATEGORY?" })
    .fill("Six years of NBA props and a public record.");
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
}

try {
  if (!process.argv[2] && !process.env.DESIGN_BASE_URL) {
    servers = await start(root);
  }
  browser = await openBrowser();
  for (const [index, width] of [1440, 380].entries()) {
    const email = `creator-${index}@example.test`;
    const owner = await context({ width, height: 1000 });
    const page = await owner.newPage();
    const writes = [];
    page.on("request", (request) => {
      if (request.method() === "POST") {
        writes.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
      }
    });
    await page.goto(base + "/create");
    await page.locator("#apply-form").waitFor();
    assert.equal(await page.getByRole("button", { name: "Send it" }).isDisabled(), true);
    await fill(page, email, `$FLOW${index}`, `@flow_${index}`);
    await page.getByRole("button", { name: "Send it" }).click();
    await page.getByText("APPLICATION IN", { exact: true }).waitFor();
    assert.deepEqual(
      writes.map((write) => write.path),
      ["/api/v1/waitlist", "/api/v1/applications"],
    );
    assert.equal(writes[0].body.email, email);
    assert.ok(!("email" in writes[1].body));
    const seat = (await owner.cookies()).find((cookie) => cookie.name === "pk_apply");
    assert.ok(seat?.httpOnly);
    await page.reload();
    await page.getByText("APPLICATION IN", { exact: true }).waitFor();

    const newcomer = await context({ width, height: 1000 });
    const retry = await newcomer.newPage();
    await retry.goto(base + "/create");
    await fill(retry, email, `$TRY${index}`, `@retry_${index}`);
    await retry.getByRole("button", { name: "Send it" }).click();
    await retry.getByRole("alert").filter({ hasText: "This email is already in line" }).waitFor();
    assert.equal(
      await retry.getByRole("textbox", { name: "NAME IT AND PICK ITS TICKER" }).inputValue(),
      "Controlled creator",
    );
    await newcomer.close();
    await owner.close();
  }
  const removed = await context({ width: 1440, height: 1000 });
  for (const route of [
    "/tokens",
    "/tokens/HALF",
    "/tokens/HALF/picks/old",
    "/leaderboard",
    "/apply",
  ]) {
    assert.equal((await removed.request.get(base + route)).status(), 404, route);
  }
  await removed.close();
  assert.deepEqual(errors, []);
  console.log(
    "Creator application: desktop/mobile submission, seat recovery, refusal and retired routes passed.",
  );
} finally {
  await browser?.close();
  servers?.stop();
}
