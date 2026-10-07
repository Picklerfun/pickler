/** A route must prove its client mounted before a design measurement can pass. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export const READY_MS = 10_000;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const OUTPUT = fileURLToPath(new URL("../.shots/diagnostics/", import.meta.url));

/** Install before navigation; a client throw must not be mistaken for slow hydration. */
export function observeClient(page) {
  const errors = [];
  const consoleErrors = [];
  let reportFailure;
  const failure = new Promise((resolve) => {
    reportFailure = resolve;
  });
  const onError = (error) => {
    const message = String(error.message).slice(0, 4000);
    if (errors.length < 20) {
      errors.push(message);
    }
    reportFailure(message);
  };
  const onConsole = (message) => {
    if (message.type() === "error" && consoleErrors.length < 20) {
      consoleErrors.push(message.text().slice(0, 4000));
    }
  };
  page.on("pageerror", onError);
  page.on("console", onConsole);
  return {
    errors,
    consoleErrors,
    failure,
    dispose() {
      page.off("pageerror", onError);
      page.off("console", onConsole);
    },
  };
}

/** Wait for the exact proof. Neither a missing screen nor a client throw is a pass. */
export async function ready(page, selector, client, timeout = READY_MS) {
  const mounted = page
    .locator(selector)
    .first()
    .waitFor({ state: "attached", timeout })
    .then(
      () => null,
      () => `${selector} did not appear within ${timeout}ms`,
    );
  const result = await Promise.race([
    mounted,
    client.failure.then((error) => `client error: ${error}`),
  ]);
  if (client.errors.length) {
    return `client error: ${client.errors[0]}`;
  }
  return result;
}

/** Diagnostics are permitted only for local controlled fixtures, never deployed accounts. */
export async function saveBlocked(page, route, client, detail, output = OUTPUT) {
  const url = page.url();
  if (!LOOPBACK.has(new URL(url).hostname)) {
    return null;
  }
  mkdirSync(output, { recursive: true });
  const stem = `${route.name.replace(/[^a-zA-Z0-9_-]/g, "-")}-${randomUUID()}`;
  const screenshot = path.join(output, `${stem}.png`);
  const record = {
    route: route.path,
    url,
    selector: route.proves,
    detail,
    clientErrors: client.errors,
    consoleErrors: client.consoleErrors,
  };
  try {
    await page.screenshot({ path: screenshot, timeout: 5000 });
    record.screenshot = screenshot;
  } catch (error) {
    record.screenshotError = String(error.message);
  }
  const file = path.join(output, `${stem}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  return file;
}
