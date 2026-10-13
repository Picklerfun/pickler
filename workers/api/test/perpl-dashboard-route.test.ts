import test from "node:test";
import assert from "node:assert/strict";
import { AuthenticationRequiredError } from "@pickler/core";
import { PerplDashboardGateway } from "@pickler/infrastructure";
import { createApp } from "../src/app.js";
import { documentationServices } from "../src/openapi/composition.js";
import { controlledPerpl } from "../../../packages/infrastructure/test/perpl-dashboard-fixture.js";
function setup(authenticated = false) {
  const fake = controlledPerpl();
  const app = createApp({
    ...documentationServices({}),
    perplDashboard: {
      gateway: new PerplDashboardGateway(fake.fetcher),
      authenticate: async () => {
        if (!authenticated) {
          throw new AuthenticationRequiredError("Sign in");
        }
        return { principal: { kind: "user", userId: "controlled" }, workspace: null } as never;
      },
    },
  });
  return { app, fake };
}
test("market read is public, portfolio/enrollment need user authentication and no-store", async () => {
  const { app, fake } = setup();
  const market = await app.request("/v1/perpl/markets");
  assert.equal(market.status, 200);
  assert.equal(market.headers.get("Cache-Control"), "private, no-store");
  for (const path of ["portfolio", "read-key/payload", "read-key/enroll"]) {
    const response = await app.request("/v1/perpl/" + path, { method: "POST", body: "{}" });
    assert.equal(response.status, 401);
  }
  assert.equal(fake.calls.length, 1);
});
test("unknown write targets, caller URLs and trade scope cannot reach Perpl", async () => {
  const { app, fake } = setup(true);
  const response = await app.request("/v1/perpl/read-key/payload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet: "0x" + "1".repeat(40),
      publicKey: "0x" + "2".repeat(64),
      expiresAt: Date.now() + 3000000,
      scope: 3,
      url: "https://other.test",
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(fake.calls.length, 0);
  assert.equal((await app.request("/v1/perpl/orders", { method: "POST" })).status, 404);
});
