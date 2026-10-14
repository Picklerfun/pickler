import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { perplTradingRequest } from "../src/perpl.js";
import type { Env } from "../src/index.js";
import { emptyPerplLiveDocument } from "@pickler/trading/perpl-live";
import { perplStateDto } from "../src/perpl-dto.js";

test("the trading Worker rejects missing or invalid user JWT before composition", async () => {
  let composed = 0;
  const runtime = () => {
    composed++;
    throw new Error("Must not compose");
  };
  for (const headers of [
    {},
    { "X-API-Key": "controlled" },
    { Authorization: "Bearer invalid-token" },
  ]) {
    const response = await perplTradingRequest(
      new Request("https://trading.internal/perpl/start", { method: "POST", headers, body: "{}" }),
      { JWT_ISSUER: "https://controlled.invalid/auth/v1" } as Env,
      runtime,
    );
    assert.equal(response.status, 401);
  }
  assert.equal(composed, 0);
});
test("a verified JWT cannot select another user's scope", async () => {
  let composed = 0;
  const runtime = () => {
    composed++;
    throw new Error("Must not compose");
  };
  const response = await perplTradingRequest(
    new Request("https://trading.internal/perpl/start", {
      method: "POST",
      body: JSON.stringify({ scope: { userId: randomUUID(), productAgentId: randomUUID() } }),
    }),
    {} as Env,
    runtime,
    async () => randomUUID(),
  );
  assert.equal(response.status, 404);
  assert.equal(composed, 0);
});
test("wire state excludes encrypted credentials, lease owners and private signal attribution", () => {
  const scope = { userId: randomUUID(), productAgentId: randomUUID() };
  const document = emptyPerplLiveDocument("0x" + "11".repeat(20), scope.productAgentId);
  document.encryptedKey = "secret-encrypted-key";
  document.encryptedToken = "secret-encrypted-token";
  document.lease = { owner: "secret-lease", expiresAt: Date.now() + 60_000 };
  const dto = perplStateDto({
    available: true,
    admissionsEnabled: false,
    requirements: {
      minimumAccountMicros: "100000000",
      minimumDepositMicros: "10000000",
      maximumCollateralMicros: "100000000",
    },
    document,
    authority: {
      scope,
      tenantId: "private-tenant",
      agentId: "private-runtime",
      address: document.address,
      organizationId: "private-org",
      configVersion: 1,
      enabled: true,
      paused: false,
      killed: false,
      network: "testnet",
      markets: ["BTC"],
      perCallMicros: "25000000",
      perDayMicros: "100000000",
    },
  });
  const json = JSON.stringify(dto);
  assert.deepEqual(dto.requirements, {
    minimumAccountAusd: "100.000000",
    minimumDepositAusd: "10.000000",
    maximumCollateralAusd: "100.000000",
  });
  for (const privateValue of [
    "secret-encrypted-key",
    "secret-encrypted-token",
    "secret-lease",
    "private-tenant",
    "private-runtime",
    "private-org",
    "controlled-sequence-v1",
  ]) {
    assert.equal(json.includes(privateValue), false);
  }
});
