import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeFunctionData,
  encodeFunctionResult,
  parseTransaction,
  type Abi,
  type Hex,
} from "viem";
import {
  PicklerLaunchFactoryAbi,
  PicklerCurveDeployerKuruAbi,
  PicklerGraduationAdapterKuruAbi,
  PicklerKuruLiquidityLockerAbi,
  PicklerFeeEscrowV2Abi,
} from "@pickler/chain";
import { createActivityBuilders } from "../src/turnkey/turnkey-activities.js";
import { createTokenOperationDriver } from "../src/launch/driver.js";
import { createPlatformTokenIssuer } from "../src/launch/grant-issuer.js";
import { createTokenMetadata } from "../src/launch/metadata.js";
import {
  launchPolicy,
  launchKey,
  launcherMaster,
  deploymentCode,
  metadataBucket,
} from "./launch-policy-fixture.js";
import type { TokenIntent } from "@pickler/core";
const context = {
  ownerUserId: "owner",
  enabled: true,
  visibility: "public" as const,
  published: true,
  killed: false,
  name: "Agent",
  handle: "agent",
  accent: "lime",
  avatarPattern: 1,
  masterAddress: launcherMaster.address.toLowerCase(),
  token: null,
  confirmationPending: false,
};
const scope = {
  userId: "owner",
  workspaceId: "workspace",
  agentId: "11111111-1111-4111-8111-111111111111",
};
function controlled() {
  const p = launchPolicy();
  let wrong = false,
    nonce = "0x0",
    reservations = 0,
    reads = 0;
  const abis: Record<string, Abi> = {
    [p.factory.address]: PicklerLaunchFactoryAbi,
    [p.deployer.address]: PicklerCurveDeployerKuruAbi,
    [p.adapter.address]: PicklerGraduationAdapterKuruAbi,
    [p.locker.address]: PicklerKuruLiquidityLockerAbi,
    [p.escrow.address]: PicklerFeeEscrowV2Abi,
  } as Record<string, Abi>;
  const bindings: Record<string, Record<string, unknown>> = {
    [p.factory.address]: {
      launchAuthority: p.authority,
      operator: p.treasury,
      launchesEnabled: true,
      curveDeployer: p.deployer.address,
      presetVenueHash: p.approvedVenueConfigHash,
      getPresetConfigHash: p.preset.configHash,
      getPreset: {
        presetId: 1,
        version: 3,
        quoteToken: p.preset.quoteAddress,
        totalSupply: BigInt(p.preset.totalSupply),
        saleAllocation: BigInt(p.preset.saleAllocation),
        lpAllocation: BigInt(p.preset.lpAllocation),
        virtualTokenReserve: 22400000000000000000000000n,
        virtualQuoteReserve: 10666666666n,
        buyFeeBps: 100,
        sellFeeBps: 100,
        protocolShareBps: 5000,
        lpCreatorShareBps: 5000,
        lpFeeTier: 0,
        lpTickSpacing: 0,
        launchFee: 0n,
        roundingPolicyVersion: 2,
      },
    },
    [p.deployer.address]: { graduationAdapter: p.adapter.address, feeEscrow: p.escrow.address },
    [p.adapter.address]: {
      router: p.router.address,
      accountCore: p.accountCore.address,
      escrow: p.escrow.address,
      locker: p.locker.address,
      venueConfigHash: p.approvedVenueConfigHash,
    },
    [p.locker.address]: {
      adapter: p.adapter.address,
      accountCore: p.accountCore.address,
      escrow: p.escrow.address,
    },
    [p.escrow.address]: {
      factory: p.factory.address,
      locker: p.locker.address,
      treasury: p.treasury,
    },
  };
  const rpc = {
    async call(method: string, params: unknown[]) {
      reads++;
      assert.ok(reservations >= reads);
      if (method === "eth_chainId") {
        return wrong ? "0x8f" : "0x279f";
      }
      if (method === "eth_getCode") {
        return deploymentCode;
      }
      if (method === "eth_getTransactionCount") {
        return nonce;
      }
      if (method === "eth_maxPriorityFeePerGas") {
        return "0x1";
      }
      if (method === "eth_getBlockByNumber") {
        return { baseFeePerGas: "0x1", timestamp: "0x1", hash: "0x" + "c".repeat(64) };
      }
      if (method === "eth_estimateGas") {
        return "0x10000";
      }
      if (method === "eth_getBalance") {
        return "0xffffffffffffffff";
      }
      if (method === "eth_call") {
        const q = params[0] as { to: string; data: Hex };
        const abi = abis[q.to]!;
        const decoded = decodeFunctionData({ abi, data: q.data });
        return encodeFunctionResult({
          abi,
          functionName: decoded.functionName,
          result: bindings[q.to]![decoded.functionName],
        });
      }
      throw new Error("Unexpected controlled RPC: " + method);
    },
  };
  const driver = createTokenOperationDriver({
    policy: p,
    rpc,
    activities: createActivityBuilders(),
    organization: async () => "org",
    reserveRpc: async () => {
      reservations++;
    },
    forwarder: {
      async forward() {
        throw new Error("No real signing");
      },
    },
    reader: {
      async getActivity() {
        throw new Error("No provider");
      },
    },
  } as Parameters<typeof createTokenOperationDriver>[0]);
  return {
    p,
    driver,
    bindings,
    wrong: () => {
      wrong = true;
    },
    nonce: () => {
      nonce = "0x1";
    },
  };
}
test("policy refuses legacy, missing evidence, mainnet and insufficient RPC capacity", () => {
  for (const patch of [
    { chainId: 143 },
    { venue: "legacy" },
    { evidence: {} },
    { allowedAgents: [] },
    { rpcRequestsPerOperation: 20 },
  ]) {
    assert.throws(() => {
      const p = launchPolicy();
      Object.assign(p, patch);
      return importPolicy(JSON.stringify(p));
    });
  }
});
import { parseTokenLaunchPolicy as importPolicy } from "../src/launch/policy.js";
test("immutable metadata keeps the frozen identity and rejects corruption", async () => {
  const bucket = metadataBucket();
  const m = createTokenMetadata(bucket, "https://app.pickler.fun");
  const draft = {
    id: "draft",
    version: 1,
    name: "Frozen",
    ticker: "FRZN",
    status: "draft" as const,
  };
  const frozen = await m.freeze(context, draft);
  const again = await m.freeze(context, draft);
  assert.deepEqual(again, frozen);
  const object = await m.read(frozen.uri.split("/").at(-1)!);
  assert.equal(JSON.parse(object!.body).name, "Frozen");
  context.name = "Edited";
  assert.equal(JSON.parse((await m.read(frozen.uri.split("/").at(-1)!))!.body).name, "Frozen");
  bucket.objects.set("tokens/" + frozen.uri.split("/").at(-1), "corrupt");
  await assert.rejects(m.read(frozen.uri.split("/").at(-1)!));
  assert.equal(await m.read("../secret"), null);
});
test("driver checks the complete binding graph, prepares exact factory calldata and rejects nonce changes", async () => {
  const f = controlled();
  const issuer = createPlatformTokenIssuer(
    f.p,
    launchKey,
    createTokenMetadata(metadataBucket(), f.p.metadataOrigin),
    f.driver.checkReadiness!,
  );
  const draft = {
    id: "draft",
    version: 1,
    name: "Agent",
    ticker: "AGENT",
    status: "draft" as const,
  };
  const auth = await issuer.issue({
    scope,
    context,
    draft,
    chainId: 10143,
    deadline: "9999999999",
    nonce: "1",
    operationId: "controlled",
  });
  const intent = {
    id: "controlled",
    action: "launch",
    context,
    deadline: "9999999999",
    authorization: auth,
  } as TokenIntent;
  const prepared = await f.driver.prepare(scope, intent);
  await f.driver.preflight(prepared);
  const tx = parseTransaction(prepared.unsignedTransaction as Hex);
  assert.equal(tx.to?.toLowerCase(), f.p.factory.address);
  assert.equal(
    decodeFunctionData({ abi: PicklerLaunchFactoryAbi, data: tx.data! }).functionName,
    "createLaunch",
  );
  const raw = await launcherMaster.signTransaction(
    tx as Parameters<typeof launcherMaster.signTransaction>[0],
  );
  assert.match(await f.driver.verify(prepared, raw), /^0x[0-9a-f]{64}$/);
  f.nonce();
  await assert.rejects(f.driver.preflight(prepared));
});
test("an unrelated deployer and a modified preset never issue a grant", async () => {
  for (const kind of ["deployer", "preset", "chain", "operator"]) {
    const f = controlled();
    if (kind === "deployer") {
      f.bindings[f.p.factory.address]!.curveDeployer = f.p.escrow.address;
    } else if (kind === "preset") {
      (
        f.bindings[f.p.factory.address]!.getPreset as Record<string, unknown>
      ).roundingPolicyVersion = 1;
    } else if (kind === "operator") {
      f.bindings[f.p.factory.address]!.operator = f.p.authority;
    } else {
      f.wrong();
    }
    await assert.rejects(f.driver.checkReadiness!("controlled"));
  }
});

test("fee and graduation transactions resolve only registered contracts, assets and master beneficiaries", async () => {
  const f = controlled();
  const token = ("0x" + "9".repeat(40)) as Hex;
  const curve = ("0x" + "a".repeat(40)) as Hex;
  f.bindings[f.p.factory.address]!.getLaunch = {
    token,
    curve,
    creator: context.masterAddress,
    creatorFeeRecipient: context.masterAddress,
    quoteToken: f.p.preset.quoteAddress,
    agentKey: "0x" + "a".repeat(64),
    presetHash: f.p.preset.configHash,
    creationBlock: 10n,
  };
  for (const action of [
    "graduate",
    "collect_curve_fees",
    "collect_lp_fees",
    "claim_fees",
  ] as const) {
    for (const asset of action === "claim_fees"
      ? (["ausd", "agent"] as const)
      : (["ausd"] as const)) {
      const intent: TokenIntent = {
        id: "controlled",
        key: "controlled",
        version: 0,
        draftVersion: 0,
        nonce: "1",
        draft: null,
        status: "preparing",
        authorization: null,
        prepared: null,
        activityId: null,
        rawTransaction: null,
        txHash: null,
        blockHash: null,
        error: null,
        action,
        asset,
        deadline: "9999999999",
        context: {
          ...context,
          token: {
            name: "Agent",
            ticker: "AGENT",
            chainId: 10143,
            address: token,
            imageUri: null,
            avatar: { accent: "lime", pattern: 1 },
          },
          venue: {
            status: "curve",
            readyToGraduate: true,
            market: null,
            vault: null,
            accountId: null,
            positions: [],
            liquidityLocked: false,
          },
        },
      };
      const prepared = await f.driver.prepare(scope, intent);
      const tx = parseTransaction(prepared.unsignedTransaction as Hex);
      if (action === "graduate") {
        assert.equal(tx.to?.toLowerCase(), f.p.adapter.address);
        assert.deepEqual(
          decodeFunctionData({ abi: PicklerGraduationAdapterKuruAbi, data: tx.data! }).args!.map(
            (value) => String(value).toLowerCase(),
          ),
          [curve],
        );
      } else if (action === "collect_curve_fees") {
        assert.equal(tx.to?.toLowerCase(), curve);
      } else if (action === "collect_lp_fees") {
        assert.equal(tx.to?.toLowerCase(), f.p.locker.address);
        assert.deepEqual(
          decodeFunctionData({ abi: PicklerKuruLiquidityLockerAbi, data: tx.data! }).args!.map(
            (value) => String(value).toLowerCase(),
          ),
          [token],
        );
      } else {
        assert.equal(tx.to?.toLowerCase(), f.p.escrow.address);
        const args = decodeFunctionData({ abi: PicklerFeeEscrowV2Abi, data: tx.data! }).args!.map(
          (a) => String(a).toLowerCase(),
        );
        assert.deepEqual(args, [
          asset === "agent" ? token : f.p.preset.quoteAddress,
          context.masterAddress,
        ]);
      }
    }
  }
  await assert.rejects(
    f.driver.prepare({ ...scope, agentId: "22222222-2222-4222-8222-222222222222" }, {
      id: "controlled",
    } as TokenIntent),
    /TESTNET_AGENT_NOT_ADMITTED/,
  );
});
