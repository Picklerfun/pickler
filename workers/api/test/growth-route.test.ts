import test from "node:test";
import assert from "node:assert/strict";
import {
  createGetApplicant,
  createJoinWaitlist,
  createSubmitApplication,
  createCheckTicker,
} from "@pickler/core";
import { createInMemoryApplicantStore } from "@pickler/infrastructure";
import { growthRoutes } from "../src/routes/growth.js";
import type { createGrowthServices } from "../src/growth/services.js";

function fixture() {
  const store = createInMemoryApplicantStore({ initialCount: 0, reservedTickers: [] });
  return growthRoutes({
    joinWaitlist: createJoinWaitlist(store.waitlist, store.applicants),
    getApplicant: createGetApplicant(store.applicants),
    submitApplication: createSubmitApplication(store.applicants),
    checkTicker: createCheckTicker(store.applicants),
  } as ReturnType<typeof createGrowthServices>);
}
const env = { APP_ENV: "staging", ALLOWED_ORIGINS: "https://web.example" } as never;
test("waitlist preserves its contract and secure apply cookie without exposing the bearer token", async () => {
  const app = fixture();
  const response = await app.request(
    "/waitlist",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://web.example" },
      body: JSON.stringify({ email: "test@example.com" }),
    },
    env,
  );
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")!;
  assert.match(cookie, /pk_apply=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.deepEqual(Object.keys((await response.json()) as object).sort(), [
    "alreadyJoined",
    "canApply",
    "position",
  ]);
  const applicant = await app.request(
    "/applications",
    { headers: { Cookie: cookie.split(";")[0]! } },
    env,
  );
  assert.equal(applicant.status, 200);
  assert.equal(applicant.headers.get("cache-control"), "private, no-store");
  const anonymous = await app.request("/applications", {}, env);
  assert.equal(anonymous.status, 401);
});

test("growth refuses cross-site writes and malformed input", async () => {
  const app = fixture();
  const blocked = await app.request(
    "/waitlist",
    {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
      body: '{"email":"test@example.com"}',
    },
    env,
  );
  assert.equal(blocked.status, 403);
  const invalid = await app.request("/waitlist", { method: "POST", body: "not json" }, env);
  assert.equal(invalid.status, 400);
  const ticker = await app.request("/tickers/availability?ticker=TOOLONGTOOLONGTOOLONG", {}, env);
  assert.equal(ticker.status, 400);
});
