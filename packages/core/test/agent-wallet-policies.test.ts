import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agentWalletPolicies,
  delegatedSelfDeletePolicy,
  VENUE_CONTRACTS,
} from "../src/features/wallets/domain/agent-wallet-policies.js";

test("three policies when the venue list is non-empty, two when it is empty", () => {
  assert.equal(
    agentWalletPolicies({
      delegatedUserId: "da",
      walletId: "w1",
      venueContracts: ["0x1111111111111111111111111111111111111111"],
    }).length,
    3,
  );

  const none = agentWalletPolicies({ delegatedUserId: "da", walletId: "w1", venueContracts: [] });

  assert.equal(none.length, 2);
  assert.ok(none.every((p) => p.effect === "EFFECT_DENY"));
});

test("the allow policy names the wallet and every venue address, the deny names both selectors, the guard fences policies", () => {
  const [allow, deny, guard] = agentWalletPolicies({
    delegatedUserId: "da",
    walletId: "w1",
    venueContracts: ["0xaaaa", "0xbbbb"],
  });

  assert.match(allow!.condition, /wallet\.id == 'w1'/);
  assert.match(allow!.condition, /eth\.tx\.to == '0xaaaa' \|\| eth\.tx\.to == '0xbbbb'/);
  assert.equal(allow!.consensus, "approvers.any(user, user.id == 'da')");
  assert.match(deny!.condition, /0xa9059cbb/);
  assert.match(deny!.condition, /0x095ea7b3/);
  assert.match(deny!.condition, /wallet\.id == 'w1'/);
  assert.equal(deny!.effect, "EFFECT_DENY");
  assert.equal(guard!.effect, "EFFECT_DENY");
  assert.match(guard!.condition, /activity\.resource == 'POLICY'/);
});

test("venue addresses are lowercased before they are written into a condition", () => {
  const [allow] = agentWalletPolicies({
    delegatedUserId: "da",
    walletId: "w1",
    venueContracts: ["0xABCDEF"],
  });

  assert.match(allow!.condition, /eth\.tx\.to == '0xabcdef'/);
});

test("the self-delete policy lets the delegated user remove itself and nobody else", () => {
  const p = delegatedSelfDeletePolicy("da");

  assert.equal(p.effect, "EFFECT_ALLOW");
  assert.equal(p.consensus, "approvers.any(user, user.id == 'da')");
  assert.match(p.condition, /ACTIVITY_TYPE_DELETE_USERS/);
  assert.match(p.condition, /user_ids\.count\(\) == 1/);
  assert.match(p.condition, /'da' in activity\.params\.user_ids/);
});

test("ids are quoted safely: a wallet id with a quote is refused", () => {
  assert.throws(() =>
    agentWalletPolicies({ delegatedUserId: "da", walletId: "w'1", venueContracts: [] }),
  );
  assert.throws(() =>
    agentWalletPolicies({ delegatedUserId: "d a", walletId: "w1", venueContracts: [] }),
  );
  assert.throws(() =>
    agentWalletPolicies({
      delegatedUserId: "da",
      walletId: "w1",
      venueContracts: ["0x11' || true || '"],
    }),
  );
  assert.throws(() => delegatedSelfDeletePolicy("da') || ('x"));
});

test("no venue is listed until live trading exists", () => {
  assert.deepEqual(VENUE_CONTRACTS, []);
});
