import test from "node:test";
import assert from "node:assert/strict";
import {
  createTokenLaunchService,
  type TokenContext,
  type TokenGrantIssuer,
  type TokenTransaction,
  type TokenAuthorization,
  type TokenDraft,
} from "../src/features/launch/token-launch.js";
const scope = { userId: "owner", workspaceId: "workspace", agentId: "agent" };
const address = `0x${"1".repeat(40)}`;
const hash = `0x${"a".repeat(64)}`;
function fixture() {
  const context: TokenContext = {
    ownerUserId: "owner",
    enabled: true,
    visibility: "public",
    published: true,
    killed: false,
    name: "Agent",
    handle: "agent",
    accent: "lime",
    avatarPattern: 2,
    masterAddress: address,
    token: null,
    confirmationPending: false,
  };
  let saved: TokenDraft | null = {
    id: "draft",
    version: 1,
    name: "Agent",
    ticker: "AGENT",
    status: "draft",
  };
  const grants = new Map<string, TokenAuthorization>();
  let calls = 0;
  const issuer: TokenGrantIssuer = {
    factory: address,
    preset: {
      id: 1,
      version: 1,
      configHash: hash,
      quoteAddress: address,
      totalSupply: "1000",
      saleAllocation: "800",
      lpAllocation: "200",
      buyFeeBps: 100,
      sellFeeBps: 100,
      protocolShareBps: 5000,
      lpCreatorShareBps: 5000,
      launchFee: "0",
    },
    async issue({ draft, chainId, deadline }) {
      calls++;
      return {
        chainId,
        factory: address,
        grantNonce: "1",
        grantDeadline: deadline,
        signature: "0x1234",
        params: {
          agentKey: hash,
          creator: address,
          creatorFeeRecipient: address,
          name: draft.name,
          symbol: draft.ticker,
          metadataURI: "ipfs://controlled",
          metadataHash: hash,
          presetId: 1,
          presetVersion: 1,
          expectedConfigHash: hash,
          nonce: "1",
          deadline,
        },
      };
    },
  };
  const tx: TokenTransaction = {
    context,
    now: new Date("2026-10-08T00:00:00Z"),
    async draft() {
      return saved;
    },
    async saveDraft(input) {
      saved = {
        id: "draft",
        version: input.expectedVersion + 1,
        status: "draft",
        name: input.name,
        ticker: input.ticker,
      };
      return saved;
    },
    async activeAuthorization() {
      return grants.size > 0;
    },
    async authorization(key) {
      return grants.get(key) ?? null;
    },
    async recordAuthorization(key, _draft, authorization) {
      grants.set(key, authorization);
    },
  };
  const repository = {
    transaction: async <T>(
      _scope: typeof scope,
      _chain: number | null,
      work: (t: TokenTransaction) => Promise<T>,
    ) => work(tx),
  };
  const service = createTokenLaunchService({ repository, chainId: 10143, issuer });
  return { context, issuer, tx, service, repository, calls: () => calls, grants };
}
test("every business admission is checked before calling the injected signer", async () => {
  for (const patch of [
    { enabled: false },
    { published: false },
    { visibility: "private" as const },
    { killed: true },
    { masterAddress: null },
    { confirmationPending: true },
    { ownerUserId: "another" },
    {
      token: {
        name: "Agent",
        ticker: "AGENT",
        address,
        chainId: 10143 as const,
        imageUri: null,
        avatar: { accent: "lime", pattern: 0 },
        slug: "agent",
      },
    },
  ]) {
    const f = fixture();
    Object.assign(f.context, patch);
    await assert.rejects(f.service.authorize(scope, 1, "controlled_launch_001"));
    assert.equal(f.calls(), 0);
  }
});
test("ordinary composition cannot issue even when the account is eligible", async () => {
  const f = fixture();
  const service = createTokenLaunchService({ repository: f.repository, chainId: 10143 });
  assert.equal((await service.state(scope)).available, false);
  await assert.rejects(
    service.authorize(scope, 1, "controlled_launch_001"),
    /TOKEN_LAUNCH_BLOCKED/,
  );
  assert.equal(f.calls(), 0);
});
test("grant lifetime is five minutes and retries do not sign again", async () => {
  const f = fixture();
  const a = await f.service.authorize(scope, 1, "controlled_launch_001");
  assert.equal(BigInt(a.grantDeadline), BigInt(f.tx.now.getTime() / 1000) + 300n);
  assert.deepEqual(await f.service.authorize(scope, 1, "controlled_launch_001"), a);
  assert.equal(f.calls(), 1);
  f.tx.now = new Date(f.tx.now.getTime() + 300000);
  await assert.rejects(
    f.service.authorize(scope, 1, "controlled_launch_001"),
    /TOKEN_AUTHORIZATION_EXPIRED/,
  );
});
test("an issuer cannot widen wallet, factory, network, preset, name or expiry", async () => {
  for (const field of [
    "creator",
    "factory",
    "chainId",
    "name",
    "symbol",
    "presetVersion",
    "expectedConfigHash",
    "grantDeadline",
    "creatorFeeRecipient",
  ]) {
    const f = fixture();
    const original = f.issuer.issue;
    f.issuer.issue = async (input) => {
      const value = await original(input);
      if (field in value) {
        Object.assign(value, {
          [field]:
            field === "chainId" ? 143 : field === "factory" ? `0x${"2".repeat(40)}` : "9999999999",
        });
      } else {
        Object.assign(value.params, {
          [field]: field === "presetVersion" ? 2 : `0x${"2".repeat(40)}`,
        });
      }
      return value;
    };
    await assert.rejects(
      f.service.authorize(scope, 1, "controlled_launch_001"),
      /TOKEN_LAUNCH_BLOCKED/,
    );
    assert.equal(f.grants.size, 0);
  }
});
test("name and ticker validation happens before persistence", async () => {
  const f = fixture();
  for (const input of [
    { name: "", ticker: "OK" },
    { name: "Agent", ticker: "x" },
    { name: "Agent", ticker: "0TOKEN" },
    { name: "x".repeat(41), ticker: "OK" },
  ]) {
    await assert.rejects(
      async () => f.service.saveDraft(scope, { ...input, expectedVersion: 0 }),
      /TOKEN_DRAFT_INVALID/,
    );
  }
  assert.equal(
    (await f.service.saveDraft(scope, { expectedVersion: 0, name: " Agent ", ticker: "$token" }))
      .ticker,
    "TOKEN",
  );
  await assert.rejects(
    async () => f.service.authorize(scope, 0, "controlled_launch_001"),
    /TOKEN_DRAFT_INVALID/,
  );
});
