import test from "node:test";
import assert from "node:assert/strict";
import {
  erc20Abi,
  decodeFunctionData,
  encodeFunctionResult,
  parseTransaction,
  type Abi,
  type Hex,
} from "viem";
import {
  PicklerBondingCurveAbi,
  PicklerLaunchFactoryAbi,
  PicklerCurveDeployerV4V2Abi,
  PicklerGraduationAdapterV4V2Abi,
  PicklerLiquidityLockerV2Abi,
  PicklerFeeEscrowV2Abi,
  IUniswapV4ReadAbi,
} from "@pickler/chain";
import { createActivityBuilders } from "../src/turnkey/turnkey-activities.js";
import { createTokenOperationDriver } from "../src/launch/driver.js";
import { createPlatformTokenIssuer } from "../src/launch/grant-issuer.js";
import { createTokenMetadata } from "../src/launch/metadata.js";
import {
  uniswapLaunchPolicy as launchPolicy,
  launchKey,
  launcherMaster,
  deploymentCode,
  metadataBucket,
} from "./launch-policy-fixture.js";
import { tokenAgentKey } from "../src/studio/token-launch-store.js";
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
  let simulationFails = false;
  const simulations: unknown[] = [];
  const abis: Record<string, Abi> = {
    [p.factory.address]: PicklerLaunchFactoryAbi,
    [p.deployer.address]: PicklerCurveDeployerV4V2Abi,
    [p.adapter.address]: PicklerGraduationAdapterV4V2Abi,
    [p.locker.address]: PicklerLiquidityLockerV2Abi,
    [p.escrow.address]: PicklerFeeEscrowV2Abi,
    [p.positionManager.address]: IUniswapV4ReadAbi,
    [p.stateView.address]: IUniswapV4ReadAbi,
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
        version: 4,
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
        lpFeeTier: 10000,
        lpTickSpacing: 200,
        launchFee: 0n,
        roundingPolicyVersion: 2,
      },
    },
    [p.deployer.address]: { graduationAdapter: p.adapter.address, feeEscrow: p.escrow.address },
    [p.adapter.address]: {
      poolManager: p.poolManager.address,
      positionManager: p.positionManager.address,
      stateView: p.stateView.address,
      permit2: p.permit2.address,
      config: {
        version: 1,
        quoteToken: p.preset.quoteAddress,
        feeTier: 10000,
        tickSpacing: 200,
        sqrtPriceToleranceBps: 5,
      },
      escrow: p.escrow.address,
      locker: p.locker.address,
      venueConfigHash: p.approvedVenueConfigHash,
    },
    [p.locker.address]: {
      adapter: p.adapter.address,
      positionManager: p.positionManager.address,
      escrow: p.escrow.address,
    },
    [p.positionManager.address]: { poolManager: p.poolManager.address, permit2: p.permit2.address },
    [p.stateView.address]: { poolManager: p.poolManager.address },
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
      if (method === "eth_getStorageAt") {
        return "0x" + "0".repeat(24) + p.quote.implementation!.address.slice(2);
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
        if ((q as { from?: string }).from) {
          simulations.push(q);
          if (simulationFails) {
            throw new Error("SLIPPAGE_EXCEEDED");
          }
          return "0x";
        }
        const target = q.to.toLowerCase();
        const abi = abis[target]!;
        const decoded = decodeFunctionData({ abi, data: q.data });
        return encodeFunctionResult({
          abi,
          functionName: decoded.functionName,
          result: bindings[target]![decoded.functionName],
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
    abis,
    simulations,
    failSimulation: () => {
      simulationFails = true;
    },
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
  await assert.rejects(
    f.driver.preflight({ ...prepared, configurationHash: "0x" + "0".repeat(64) }),
    /POLICY_CHANGED/,
  );
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
  for (const kind of ["deployer", "preset", "chain", "operator", "config", "position", "state"]) {
    const f = controlled();
    if (kind === "deployer") {
      f.bindings[f.p.factory.address]!.curveDeployer = f.p.escrow.address;
    } else if (kind === "preset") {
      (
        f.bindings[f.p.factory.address]!.getPreset as Record<string, unknown>
      ).roundingPolicyVersion = 1;
    } else if (kind === "operator") {
      f.bindings[f.p.factory.address]!.operator = f.p.authority;
    } else if (kind === "config") {
      (f.bindings[f.p.adapter.address]!.config as Record<string, unknown>).feeTier = 3000;
    } else if (kind === "position") {
      f.bindings[f.p.positionManager.address]!.permit2 = f.p.factory.address;
    } else if (kind === "state") {
      f.bindings[f.p.stateView.address]!.poolManager = f.p.factory.address;
    } else {
      f.wrong();
    }
    await assert.rejects(f.driver.checkReadiness!("controlled"));
  }
});

test("fee and graduation transactions resolve only registered contracts, assets and master beneficiaries", async () => {
  const f = controlled();
  const token = ("0x" + "b".repeat(40)) as Hex;
  const curve = ("0x" + "c".repeat(40)) as Hex;
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
            status: action === "collect_lp_fees" ? "uniswap_v4" : "curve",
            readyToGraduate: true,
            market: action === "collect_lp_fees" ? f.p.poolManager.address : null,
            vault: action === "collect_lp_fees" ? f.p.locker.address : null,
            accountId: null,
            positions: [],
            liquidityLocked: action === "collect_lp_fees",
          },
        },
      };
      const prepared = await f.driver.prepare(scope, intent);
      const tx = parseTransaction(prepared.unsignedTransaction as Hex);
      if (action === "graduate") {
        assert.equal(tx.to?.toLowerCase(), f.p.adapter.address);
        assert.deepEqual(
          decodeFunctionData({ abi: PicklerGraduationAdapterV4V2Abi, data: tx.data! }).args!.map(
            (value) => String(value).toLowerCase(),
          ),
          [curve],
        );
      } else if (action === "collect_curve_fees") {
        assert.equal(tx.to?.toLowerCase(), curve);
      } else if (action === "collect_lp_fees") {
        assert.equal(tx.to?.toLowerCase(), f.p.locker.address);
        assert.deepEqual(
          decodeFunctionData({ abi: PicklerLiquidityLockerV2Abi, data: tx.data! }).args!.map(
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

test("V4 policy never admits missing quote evidence, a different LP fee, hooks or mainnet", () => {
  for (const patch of [
    { quote: {} },
    { quote: { ...launchPolicy().quote, implementation: null } },
    { liquidity: { ...launchPolicy().liquidity, feeTier: 3000 } },
    { liquidity: { ...launchPolicy().liquidity, hooks: "0x" + "1".repeat(40) } },
    { version: 1 },
    { chainId: 143 },
  ]) {
    assert.throws(() => importPolicy(JSON.stringify({ ...launchPolicy(), ...patch })));
  }
});

function tradeFixture() {
  const f = controlled();
  const token = ("0x" + "d".repeat(40)) as Hex;
  const curve = ("0x" + "e".repeat(40)) as Hex;
  f.abis[token] = erc20Abi;
  f.abis[f.p.preset.quoteAddress] = erc20Abi;
  f.abis[curve] = PicklerBondingCurveAbi;
  f.bindings[token] = { balanceOf: 10000n * 10n ** 18n, allowance: 0n };
  f.bindings[f.p.preset.quoteAddress] = { balanceOf: 100000000n, allowance: 0n };
  f.bindings[curve] = {
    phase: 0,
    quoteBuy: 2000n * 10n ** 18n,
    quoteSell: 500000n,
    remainingTokens: BigInt(f.p.preset.saleAllocation),
  };
  f.bindings[f.p.factory.address]!.getLaunch = {
    token,
    curve,
    creator: context.masterAddress,
    creatorFeeRecipient: context.masterAddress,
    quoteToken: f.p.preset.quoteAddress,
    agentKey: tokenAgentKey(10143, scope.agentId),
    presetHash: f.p.preset.configHash,
    creationBlock: 10n,
  };
  function intent(action: "buy" | "sell" | "approve_buy" | "approve_sell"): TokenIntent {
    return {
      id: "controlled",
      key: "controlled",
      version: 1,
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
      asset: "ausd",
      deadline: "9999999999",
      trade: {
        amount: action.endsWith("sell") ? (1000n * 10n ** 18n).toString() : "1000000",
        slippageBps: 50,
      },
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
      },
    };
  }
  return { ...f, token, curve, intent };
}
test("exact approvals and swaps use only the registered curve, input asset and master recipient", async () => {
  for (const action of ["approve_buy", "approve_sell", "buy", "sell"] as const) {
    const f = tradeFixture();
    const i = f.intent(action);
    const buying = action.endsWith("buy");
    const approval = action.startsWith("approve_");
    const inputAsset = buying ? f.p.preset.quoteAddress : f.token;
    if (!approval) {
      f.bindings[inputAsset]!.allowance = BigInt(i.trade!.amount);
    }
    const p = await f.driver.prepare(scope, i);
    const tx = parseTransaction(p.unsignedTransaction as Hex);
    const decoded = decodeFunctionData({
      abi: approval ? erc20Abi : PicklerBondingCurveAbi,
      data: tx.data!,
    });
    assert.equal(tx.to?.toLowerCase(), approval ? inputAsset : f.curve);
    assert.equal(
      decoded.functionName,
      approval ? "approve" : buying ? "buyExactInput" : "sellExactInput",
    );
    assert.deepEqual(
      decoded.args!.map(String).map((v) => v.toLowerCase()),
      approval
        ? [f.curve, i.trade!.amount]
        : [i.trade!.amount, p.quote!.minimumOutput, context.masterAddress, i.deadline],
    );
    assert.equal(p.quote!.feeBps, 100);
    assert.equal(p.quote!.approval, approval);
    assert.equal(p.quote!.balance, String(f.bindings[inputAsset]!.balanceOf));
    await f.driver.preflight(p);
    assert.equal(f.simulations.length, 1);
    const raw = await launcherMaster.signTransaction(
      tx as Parameters<typeof launcherMaster.signTransaction>[0],
    );
    assert.match(await f.driver.verify(p, raw), /^0x[0-9a-f]{64}$/);
    f.failSimulation();
    await assert.rejects(f.driver.preflight(p), /SLIPPAGE_EXCEEDED/);
    assert.equal(p.quote!.minimumOutput, buying ? "1990000000000000000000" : "497500");
  }
});
test("trades refuse missing allowance, funds, closed inventory and conflicting canonical identity", async () => {
  for (const kind of [
    "allowance",
    "funds",
    "closed",
    "inventory",
    "small",
    "key",
    "token",
    "quote",
    "preset",
    "already-approved",
  ]) {
    const f = tradeFixture();
    const asset = f.p.preset.quoteAddress;
    f.bindings[asset]!.allowance = 1000000n;
    const launch = f.bindings[f.p.factory.address]!.getLaunch as Record<string, unknown>;
    let expected: string;
    if (kind === "allowance") {
      f.bindings[asset]!.allowance = 0n;
      expected = "APPROVAL_REQUIRED";
    } else if (kind === "funds") {
      f.bindings[asset]!.balanceOf = 0n;
      expected = "INSUFFICIENT_TOKEN_BALANCE";
    } else if (kind === "closed") {
      f.bindings[f.curve]!.phase = 1;
      expected = "CURVE_CLOSED";
    } else if (kind === "inventory") {
      f.bindings[f.curve]!.remainingTokens = 1n;
      expected = "EXCEEDS_CURVE_INVENTORY";
    } else if (kind === "small") {
      f.bindings[f.curve]!.quoteBuy = 0n;
      expected = "TRADE_TOO_SMALL";
    } else if (kind === "already-approved") {
      expected = "APPROVAL_NOT_REQUIRED";
    } else {
      launch[
        { key: "agentKey", token: "token", quote: "quoteToken", preset: "presetHash" }[kind]!
      ] = "0x" + "8".repeat(kind === "key" || kind === "preset" ? 64 : 40);
      expected = "TOKEN_VENUE_MISMATCH";
    }
    await assert.rejects(
      f.driver.prepare(scope, f.intent(kind === "already-approved" ? "approve_buy" : "buy")),
      new RegExp(expected),
    );
  }
});
