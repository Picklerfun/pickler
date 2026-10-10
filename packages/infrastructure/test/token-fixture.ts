/** Controlled local acceptance only; the API host never imports this signer. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  DEFAULT_BRIEF,
  STARTER_CAPS,
  createTokenLaunchService,
  prepareDraft,
  type TokenGrantIssuer,
} from "@pickler/core";
import { PostgresStudioDirectory } from "../src/studio/directory.js";
import { PostgresTokenLaunchStore, tokenAgentKey } from "../src/studio/token-launch-store.js";
import { createTestStore } from "./database.js";

export const controlledFactory = `0x${"1".repeat(40)}` as const;
export const controlledMaster = `0x${"5".repeat(40)}` as const;
export const controlledAuthority = privateKeyToAccount(`0x${"0".repeat(62)}01`);
export function controlledIssuer() {
  let calls = 0;
  const issuer: TokenGrantIssuer = {
    factory: controlledFactory,
    preset: {
      id: 1,
      version: 1,
      configHash: `0x${"a".repeat(64)}`,
      quoteAddress: `0x${"4".repeat(40)}`,
      totalSupply: "21000000000000000000000000",
      saleAllocation: "16800000000000000000000000",
      lpAllocation: "4200000000000000000000000",
      buyFeeBps: 100,
      sellFeeBps: 100,
      protocolShareBps: 5000,
      lpCreatorShareBps: 5000,
      launchFee: "0",
    },
    async issue({ scope, context, draft, chainId, deadline, nonce }) {
      calls++;
      const metadata = JSON.stringify({
        name: draft.name,
        symbol: draft.ticker,
        avatar: { accent: context.accent, pattern: context.avatarPattern },
      });
      const params = {
        agentKey: tokenAgentKey(chainId, scope.agentId),
        creator: context.masterAddress!,
        creatorFeeRecipient: context.masterAddress!,
        name: draft.name,
        symbol: draft.ticker,
        metadataURI: "ipfs://controlled-only",
        metadataHash: keccak256(stringToHex(metadata)),
        presetId: issuer.preset.id,
        presetVersion: issuer.preset.version,
        expectedConfigHash: issuer.preset.configHash,
        nonce,
        deadline,
      };
      const grantNonce = nonce;
      const paramsHash = keccak256(
        encodeAbiParameters(
          [
            { type: "bytes32" },
            { type: "bytes32" },
            { type: "bytes32" },
            { type: "bytes32" },
            { type: "uint32" },
            { type: "uint32" },
            { type: "bytes32" },
            { type: "uint256" },
            { type: "uint256" },
          ],
          [
            keccak256(stringToHex(params.name)),
            keccak256(stringToHex(params.symbol)),
            keccak256(stringToHex(params.metadataURI)),
            params.metadataHash,
            params.presetId,
            params.presetVersion,
            params.expectedConfigHash as Hex,
            BigInt(params.nonce),
            BigInt(deadline),
          ],
        ),
      );
      const signature = await controlledAuthority.signTypedData({
        domain: { name: "Pickler", version: "2", chainId, verifyingContract: controlledFactory },
        primaryType: "LaunchGrant",
        types: {
          LaunchGrant: [
            { name: "agentKey", type: "bytes32" },
            { name: "creator", type: "address" },
            { name: "creatorFeeRecipient", type: "address" },
            { name: "paramsHash", type: "bytes32" },
            { name: "grantNonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        message: {
          agentKey: params.agentKey as Hex,
          creator: params.creator as Hex,
          creatorFeeRecipient: params.creatorFeeRecipient as Hex,
          paramsHash,
          grantNonce: BigInt(grantNonce),
          deadline: BigInt(deadline),
        },
      });
      return {
        chainId,
        factory: controlledFactory,
        params,
        grantNonce,
        grantDeadline: deadline,
        signature,
      };
    },
  };
  return { issuer, calls: () => calls };
}
export async function tokenFixture(t: TestContext) {
  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      "postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler",
  );
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
    "controlled token suite requires loopback PostgreSQL",
  );
  const store = await createTestStore(t);
  const directory = new PostgresStudioDirectory(store.pool);
  const userId = randomUUID();
  await store.pool.query("SELECT identity.create_profile($1,'Controlled',$2)", [
    userId,
    `owner_${randomUUID().slice(0, 8)}`,
  ]);
  await directory.onboard(userId);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  const access = (await directory.access(userId, null))!;
  const walletId = `controlled-${randomUUID()}`;
  await store.pool.query(
    "INSERT INTO wallets.wallets(user_id,wallet_id,sub_organization_id,kind,name,approved_policy_ids) VALUES($1,$2,'controlled','agent','Agent',ARRAY['p1','p2','p3'])",
    [userId, walletId],
  );
  await store.pool.query(
    "INSERT INTO wallets.wallet_accounts(wallet_id,chain,address,address_format,path) VALUES($1,'monad',$2,'ADDRESS_FORMAT_ETHEREUM','m/44')",
    [walletId, `0x${"6".repeat(40)}`],
  );
  const handle = `agent_${randomUUID().slice(0, 8)}`;
  const data = prepareDraft({
    name: "Controlled",
    handle,
    markets: ["BTC"],
    voice: "analyst",
    avatar: { accent: "lime", pattern: 1 },
    sources: { web: null },
    brief: DEFAULT_BRIEF,
    caps: STARTER_CAPS,
    walletId,
  });
  const created = await directory.createDraft(access, userId, {
    ...data,
    name: "Controlled",
    handle,
    walletId,
  });
  const agentId = created.productId;
  const masterId = `master-${randomUUID()}`;
  await store.pool.query(
    "INSERT INTO wallets.wallets(user_id,wallet_id,sub_organization_id,kind,name) VALUES($1,$2,'controlled','master','Master')",
    [userId, masterId],
  );
  await store.pool.query(
    "INSERT INTO wallets.wallet_accounts(wallet_id,chain,address,address_format,path) VALUES($1,'monad',$2,'ADDRESS_FORMAT_ETHEREUM','m/44')",
    [masterId, controlledMaster],
  );
  await store.pool.query(
    "INSERT INTO wallets.turnkey_orgs(user_id,sub_organization_id,master_wallet_id,root_user_id) VALUES($1,$2,$3,'controlled-root')",
    [userId, `controlled-${userId}`, masterId],
  );
  await store.pool.query(
    "UPDATE agents.agents SET visibility='public',published_at=now(),status='active' WHERE id=$1",
    [agentId],
  );
  const scope = { userId, workspaceId: access.workspaceId, agentId };
  const signer = controlledIssuer();
  const repository = new PostgresTokenLaunchStore(store.pool);
  const service = createTokenLaunchService({ repository, chainId: 10143, issuer: signer.issuer });
  return { store, directory, access, scope, service, repository, signer, handle };
}
