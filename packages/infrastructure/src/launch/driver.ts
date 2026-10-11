import {
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  parseTransaction,
  serializeTransaction,
  toHex,
  erc20Abi,
  type Abi,
  type Hex,
} from "viem";
import {
  PicklerLaunchFactoryAbi,
  PicklerCurveDeployerKuruAbi,
  PicklerCurveDeployerV4V2Abi,
  PicklerGraduationAdapterV4V2Abi,
  PicklerLiquidityLockerV2Abi,
  IUniswapV4ReadAbi,
  PicklerGraduationAdapterKuruAbi,
  PicklerBondingCurveAbi,
  PicklerFeeEscrowV2Abi,
  PicklerKuruLiquidityLockerAbi,
} from "@pickler/chain";
import {
  AGENT_WALLET_ACTIVITY_TYPES,
  TokenTradeError,
  TokenPreparationError,
  isTokenTradeAction,
  tokenTradeMinimumOutput,
  type TokenTradeQuote,
  type AgentWalletActivityBuilders,
  type SignedActivityForwarder,
  type TurnkeyActivity,
  type TurnkeyReader,
  type TokenIntent,
  type TokenOperationDriver,
  type TokenPreparedTransaction,
} from "@pickler/core";
import {
  pendingNonce,
  quoteFees,
  FeeQuoteLimitExceededError,
  verifySignedTransfer,
  transactionHash,
  broadcastTransaction,
} from "../chain/deposit-tx.js";
import { JsonRpcError, type Rpc } from "../chain/erc20.js";
import { tokenAgentKey } from "../studio/token-launch-store.js";
import { tokenLaunchAllowsAgent, type TokenLaunchPolicy } from "./policy.js";

function completed(activity: TurnkeyActivity) {
  if (!activity.id) {
    throw new Error("MISSING_ACTIVITY_ID");
  }
  if (["ACTIVITY_STATUS_REJECTED", "ACTIVITY_STATUS_FAILED"].includes(activity.status)) {
    return { activityId: activity.id, status: "rejected" as const };
  }
  if (activity.status !== "ACTIVITY_STATUS_COMPLETED") {
    return { activityId: activity.id, status: "pending" as const };
  }
  const raw = activity.result?.signTransactionResult?.signedTransaction;
  if (typeof raw !== "string" || !/^(0x)?[0-9a-f]+$/i.test(raw)) {
    throw new Error("INVALID_SIGNED_RESULT");
  }
  return {
    activityId: activity.id,
    status: "completed" as const,
    rawTransaction: raw.startsWith("0x") ? raw : "0x" + raw,
  };
}
/** Factory/master targets are constructed here. The client never supplies calldata or an address. */
export function createTokenOperationDriver(deps: {
  policy: TokenLaunchPolicy;
  rpc: Rpc;
  organization(scope: { userId: string }): Promise<string>;
  activities: AgentWalletActivityBuilders;
  forwarder: SignedActivityForwarder;
  reader: TurnkeyReader;
  reserveRpc(operationId: string, limit: number): Promise<void>;
}): TokenOperationDriver {
  const { policy } = deps;
  const configurationHash = keccak256(toHex(JSON.stringify(policy)));
  const rpcFor = (id: string, recovery = false): Rpc => ({
    async call(method, params) {
      try {
        await deps.reserveRpc(
          id,
          recovery ? policy.rpcRequestsPerOperation : policy.rpcRequestsPerOperation - 100,
        );
      } catch (error) {
        if (error instanceof Error && error.message === "TOKEN_RPC_BUDGET_EXHAUSTED") {
          throw new TokenPreparationError("RPC_BUDGET_EXHAUSTED");
        }
        throw error;
      }
      try {
        return await deps.rpc.call(method, params);
      } catch (error) {
        // Preserve the shared fee reader's explicit unsupported-method fallback.
        if (
          method === "eth_maxPriorityFeePerGas" &&
          error instanceof JsonRpcError &&
          (error.code === -32601 || /method not found/i.test(error.message))
        ) {
          throw error;
        }
        const simulating =
          method === "eth_estimateGas" ||
          (method === "eth_call" &&
            typeof params[0] === "object" &&
            params[0] !== null &&
            "from" in params[0]);
        if (simulating && error instanceof JsonRpcError) {
          if (/insufficient funds/i.test(error.message)) {
            throw new TokenPreparationError("INSUFFICIENT_GAS_BALANCE");
          }
          if (error.code === 3 || error.code === -32000 || error.code === -32015) {
            throw new TokenPreparationError("SIMULATION_REJECTED");
          }
        }
        throw new TokenPreparationError("RPC_UNAVAILABLE");
      }
    },
  });
  async function policyFees(rpc: Rpc) {
    try {
      return await quoteFees(rpc, BigInt(policy.maxFeePerGas));
    } catch (error) {
      if (error instanceof FeeQuoteLimitExceededError) {
        throw new TokenPreparationError("GAS_LIMIT_EXCEEDED");
      }
      throw error;
    }
  }
  async function read(
    rpc: Rpc,
    address: string,
    abi: readonly unknown[],
    functionName: string,
    args: unknown[] = [],
  ) {
    const data = encodeFunctionData({ abi: abi as Abi, functionName, args });
    const result = await rpc.call("eth_call", [{ to: address, data }, "latest"]);
    if (typeof result !== "string" || !/^0x[0-9a-f]+$/i.test(result)) {
      throw new Error("INVALID_CHAIN_READ");
    }
    return decodeFunctionResult({ abi: abi as Abi, functionName, data: result as Hex });
  }
  const adapterAbi =
    policy.venue === "uniswap_v4"
      ? PicklerGraduationAdapterV4V2Abi
      : PicklerGraduationAdapterKuruAbi;
  const deployerAbi =
    policy.venue === "uniswap_v4" ? PicklerCurveDeployerV4V2Abi : PicklerCurveDeployerKuruAbi;
  const lockerAbi =
    policy.venue === "uniswap_v4" ? PicklerLiquidityLockerV2Abi : PicklerKuruLiquidityLockerAbi;
  async function verifyDeployment(rpc: Rpc) {
    if (BigInt(String(await rpc.call("eth_chainId", []))) !== 10143n) {
      throw new Error("WRONG_CHAIN");
    }
    for (const contract of [
      policy.factory,
      policy.deployer,
      policy.adapter,
      policy.escrow,
      policy.locker,
      ...(policy.venue === "uniswap_v4"
        ? [
            policy.poolManager,
            policy.positionManager,
            policy.stateView,
            policy.permit2,
            policy.quote,
          ]
        : [policy.router, policy.accountCore]),
    ]) {
      const code = await rpc.call("eth_getCode", [contract.address, "latest"]);
      if (
        typeof code !== "string" ||
        code === "0x" ||
        keccak256(code as Hex) !== contract.codeHash
      ) {
        throw new Error("DEPLOYMENT_CHANGED");
      }
      if (contract.implementation) {
        const slot = await rpc.call("eth_getStorageAt", [
          contract.address,
          contract.implementation.slot,
          "latest",
        ]);
        if (
          typeof slot !== "string" ||
          slot.toLowerCase().slice(-40) !== contract.implementation.address.slice(2)
        ) {
          throw new Error("IMPLEMENTATION_CHANGED");
        }
        const implementation = await rpc.call("eth_getCode", [
          contract.implementation.address,
          "latest",
        ]);
        if (
          typeof implementation !== "string" ||
          keccak256(implementation as Hex) !== contract.implementation.codeHash
        ) {
          throw new Error("IMPLEMENTATION_CHANGED");
        }
      }
    }
    const [authority, operator, venue, preset, enabled, factoryVenue, presetTerms] =
      await Promise.all([
        read(rpc, policy.factory.address, PicklerLaunchFactoryAbi, "launchAuthority"),
        read(rpc, policy.factory.address, PicklerLaunchFactoryAbi, "operator"),
        read(rpc, policy.adapter.address, adapterAbi, "venueConfigHash"),
        read(rpc, policy.factory.address, PicklerLaunchFactoryAbi, "getPresetConfigHash", [
          policy.preset.id,
          policy.preset.version,
        ]),
        read(rpc, policy.factory.address, PicklerLaunchFactoryAbi, "launchesEnabled"),
        read(rpc, policy.factory.address, PicklerLaunchFactoryAbi, "presetVenueHash", [
          policy.preset.id,
          policy.preset.version,
        ]),
        read(rpc, policy.factory.address, PicklerLaunchFactoryAbi, "getPreset", [
          policy.preset.id,
          policy.preset.version,
        ]),
      ]);
    const bindings: Array<[string, readonly unknown[], string, string]> = [
      [policy.factory.address, PicklerLaunchFactoryAbi, "curveDeployer", policy.deployer.address],
      [policy.deployer.address, deployerAbi, "graduationAdapter", policy.adapter.address],
      [policy.deployer.address, deployerAbi, "feeEscrow", policy.escrow.address],
      [policy.adapter.address, adapterAbi, "escrow", policy.escrow.address],
      [policy.adapter.address, adapterAbi, "locker", policy.locker.address],
      [policy.locker.address, lockerAbi, "adapter", policy.adapter.address],
      [policy.locker.address, lockerAbi, "escrow", policy.escrow.address],
      [policy.escrow.address, PicklerFeeEscrowV2Abi, "factory", policy.factory.address],
      [policy.escrow.address, PicklerFeeEscrowV2Abi, "locker", policy.locker.address],
      [policy.escrow.address, PicklerFeeEscrowV2Abi, "treasury", policy.treasury],
    ];
    if (policy.venue === "uniswap_v4") {
      bindings.push(
        [policy.adapter.address, adapterAbi, "poolManager", policy.poolManager.address],
        [policy.adapter.address, adapterAbi, "positionManager", policy.positionManager.address],
        [policy.adapter.address, adapterAbi, "stateView", policy.stateView.address],
        [policy.adapter.address, adapterAbi, "permit2", policy.permit2.address],
        [policy.locker.address, lockerAbi, "positionManager", policy.positionManager.address],
        [
          policy.positionManager.address,
          IUniswapV4ReadAbi,
          "poolManager",
          policy.poolManager.address,
        ],
        [policy.positionManager.address, IUniswapV4ReadAbi, "permit2", policy.permit2.address],
        [policy.stateView.address, IUniswapV4ReadAbi, "poolManager", policy.poolManager.address],
      );
      const config = (await read(rpc, policy.adapter.address, adapterAbi, "config")) as Record<
        string,
        unknown
      >;
      const expectedConfig = {
        version: 1,
        quoteToken: policy.preset.quoteAddress,
        ...policy.liquidity,
      };
      for (const key of [
        "version",
        "quoteToken",
        "feeTier",
        "tickSpacing",
        "sqrtPriceToleranceBps",
      ] as const) {
        if (String(config[key]).toLowerCase() !== String(expectedConfig[key])) {
          throw new Error("VENUE_CONFIGURATION_CHANGED");
        }
      }
    } else {
      bindings.push(
        [policy.adapter.address, adapterAbi, "router", policy.router.address],
        [policy.adapter.address, adapterAbi, "accountCore", policy.accountCore.address],
        [policy.locker.address, lockerAbi, "accountCore", policy.accountCore.address],
      );
    }
    const actualBindings = await Promise.all(
      bindings.map(([target, abi, name]) => read(rpc, target, abi, name)),
    );
    if (
      actualBindings.some((v, i) => String(v).toLowerCase() !== bindings[i]![3]) ||
      factoryVenue !== policy.approvedVenueConfigHash
    ) {
      throw new Error("BINDING_CHANGED");
    }
    const terms = presetTerms as Record<string, unknown>;
    const required = {
      quoteToken: policy.preset.quoteAddress,
      totalSupply: policy.preset.totalSupply,
      saleAllocation: policy.preset.saleAllocation,
      lpAllocation: policy.preset.lpAllocation,
      virtualTokenReserve: "22400000000000000000000000",
      virtualQuoteReserve: "10666666666",
      buyFeeBps: 100,
      sellFeeBps: 100,
      protocolShareBps: 5000,
      lpCreatorShareBps: 5000,
      lpFeeTier: policy.venue === "uniswap_v4" ? policy.liquidity.feeTier : 0,
      lpTickSpacing: policy.venue === "uniswap_v4" ? policy.liquidity.tickSpacing : 0,
      launchFee: 0,
      roundingPolicyVersion: 2,
    };
    if (
      Object.entries(required).some(([key, v]) => String(terms[key]).toLowerCase() !== String(v))
    ) {
      throw new Error("PRESET_CHANGED");
    }
    if (
      String(authority).toLowerCase() !== policy.authority ||
      String(operator).toLowerCase() === policy.authority ||
      venue !== policy.approvedVenueConfigHash ||
      preset !== policy.preset.configHash ||
      enabled !== true
    ) {
      throw new Error("POLICY_CHANGED");
    }
  }
  function inspect(prepared: TokenPreparedTransaction) {
    if (policy.venue === "uniswap_v4" && prepared.configurationHash !== configurationHash) {
      throw new Error("POLICY_CHANGED");
    }
    const tx = parseTransaction(prepared.unsignedTransaction as Hex);
    if (
      tx.type !== "eip1559" ||
      tx.r ||
      tx.chainId !== 10143 ||
      tx.to?.toLowerCase() !== prepared.destination.toLowerCase() ||
      (tx.value ?? 0n) !== 0n ||
      (tx.accessList?.length ?? 0) !== 0 ||
      serializeTransaction(tx) !== prepared.unsignedTransaction ||
      tx.gas?.toString() !== prepared.gas ||
      tx.maxFeePerGas?.toString() !== prepared.maxFeePerGas ||
      !tx.gas ||
      !tx.maxFeePerGas ||
      tx.gas > BigInt(policy.maxGas) ||
      tx.maxFeePerGas > BigInt(policy.maxFeePerGas) ||
      (tx.maxPriorityFeePerGas ?? 0n) > tx.maxFeePerGas ||
      tx.gas * tx.maxFeePerGas > BigInt(policy.maxGasCost) ||
      (tx.gas * tx.maxFeePerGas).toString() !== prepared.maximumGasCost
    ) {
      throw new Error("INVALID_PREPARED_TRANSACTION");
    }
    const body = JSON.parse(prepared.activity.body) as {
      organizationId?: string;
      type?: string;
      parameters?: { signWith?: string; unsignedTransaction?: string; type?: string };
    };
    if (
      body.organizationId !== prepared.activity.organizationId ||
      body.type !== AGENT_WALLET_ACTIVITY_TYPES.signTransaction ||
      body.parameters?.signWith?.toLowerCase() !== prepared.sender.toLowerCase() ||
      body.parameters.unsignedTransaction !== prepared.unsignedTransaction ||
      body.parameters.type !== "TRANSACTION_TYPE_ETHEREUM" ||
      tx.nonce !== prepared.transactionNonce
    ) {
      throw new Error("ACTIVITY_MISMATCH");
    }
    return tx;
  }
  return {
    ready: true,
    checkReadiness: (id) => verifyDeployment(rpcFor(id)),
    async prepare(scope, intent: TokenIntent) {
      if (!tokenLaunchAllowsAgent(policy, scope.agentId)) {
        throw new Error("TESTNET_AGENT_NOT_ADMITTED");
      }
      const rpc = rpcFor(intent.id);
      await verifyDeployment(rpc);
      let to = policy.factory.address;
      let data: Hex;
      let quote: TokenTradeQuote | undefined;
      if (intent.action === "launch") {
        const g = intent.authorization;
        if (
          !g ||
          g.factory !== to ||
          g.chainId !== 10143 ||
          g.params.expectedConfigHash !== policy.preset.configHash ||
          g.params.creator.toLowerCase() !== intent.context.masterAddress?.toLowerCase() ||
          g.params.creatorFeeRecipient.toLowerCase() !== g.params.creator.toLowerCase() ||
          g.params.presetId !== policy.preset.id ||
          g.params.presetVersion !== policy.preset.version
        ) {
          throw new Error("INVALID_GRANT");
        }
        data = encodeFunctionData({
          abi: PicklerLaunchFactoryAbi,
          functionName: "createLaunch",
          args: [
            {
              ...g.params,
              agentKey: g.params.agentKey as Hex,
              creator: g.params.creator as Hex,
              creatorFeeRecipient: g.params.creatorFeeRecipient as Hex,
              metadataHash: g.params.metadataHash as Hex,
              expectedConfigHash: g.params.expectedConfigHash as Hex,
              nonce: BigInt(g.params.nonce),
              deadline: BigInt(g.params.deadline),
            },
            "0x",
            BigInt(g.grantNonce),
            BigInt(g.grantDeadline),
            g.signature as Hex,
          ],
        });
      } else {
        const token = intent.context.token?.address as Hex | undefined;
        if (!token) {
          throw new Error("TOKEN_NOT_CONFIRMED");
        }
        const launch = (await read(rpc, to, PicklerLaunchFactoryAbi, "getLaunch", [token])) as {
          creator: string;
          curve: Hex;
          creatorFeeRecipient: string;
          agentKey: string;
          token: string;
          quoteToken: string;
          presetHash: string;
        };
        if (
          launch.creator.toLowerCase() !== intent.context.masterAddress?.toLowerCase() ||
          launch.creatorFeeRecipient.toLowerCase() !== launch.creator.toLowerCase()
        ) {
          throw new Error("FEE_RECIPIENT_CHANGED");
        }
        if (
          policy.venue === "uniswap_v4" &&
          (intent.context.token?.chainId !== 10143 ||
            launch.token.toLowerCase() !== token.toLowerCase() ||
            launch.quoteToken.toLowerCase() !== policy.preset.quoteAddress ||
            launch.presetHash !== policy.preset.configHash)
        ) {
          throw new Error("TOKEN_VENUE_MISMATCH");
        }
        if (isTokenTradeAction(intent.action)) {
          if (
            !intent.trade ||
            launch.agentKey !== tokenAgentKey(10143, scope.agentId) ||
            launch.token.toLowerCase() !== token.toLowerCase() ||
            launch.quoteToken.toLowerCase() !== policy.preset.quoteAddress ||
            launch.presetHash !== policy.preset.configHash ||
            intent.context.token?.chainId !== 10143
          ) {
            throw new Error("TOKEN_VENUE_MISMATCH");
          }
          const buying = intent.action === "buy" || intent.action === "approve_buy";
          const approval = intent.action === "approve_buy" || intent.action === "approve_sell";
          const amount = BigInt(intent.trade.amount);
          const inputAsset = buying ? (policy.preset.quoteAddress as Hex) : token;
          const owner = intent.context.masterAddress as Hex;
          const phase = await read(rpc, launch.curve, PicklerBondingCurveAbi, "phase");
          if (phase !== 0) {
            throw new TokenTradeError("CURVE_CLOSED");
          }
          const [balance, allowance, expectedOutput, remaining] = (await Promise.all([
            read(rpc, inputAsset, erc20Abi, "balanceOf", [owner]),
            read(rpc, inputAsset, erc20Abi, "allowance", [owner, launch.curve]),
            read(rpc, launch.curve, PicklerBondingCurveAbi, buying ? "quoteBuy" : "quoteSell", [
              amount,
            ]),
            read(rpc, launch.curve, PicklerBondingCurveAbi, "remainingTokens"),
          ])) as bigint[];
          if (balance! < amount) {
            throw new TokenTradeError("INSUFFICIENT_TOKEN_BALANCE");
          }
          if (expectedOutput! <= 0n) {
            throw new TokenTradeError("TRADE_TOO_SMALL");
          }
          if (buying && expectedOutput! > remaining!) {
            throw new TokenTradeError("EXCEEDS_CURVE_INVENTORY");
          }
          if (approval && allowance! >= amount) {
            throw new TokenTradeError("APPROVAL_NOT_REQUIRED");
          }
          if (!approval && allowance! < amount) {
            throw new TokenTradeError("APPROVAL_REQUIRED");
          }
          const minimumOutput = tokenTradeMinimumOutput(expectedOutput!, intent.trade.slippageBps);
          quote = {
            ...intent.trade,
            side: buying ? "buy" : "sell",
            approval,
            expectedOutput: expectedOutput!.toString(),
            minimumOutput: minimumOutput.toString(),
            balance: balance!.toString(),
            allowance: allowance!.toString(),
            feeBps: buying ? policy.preset.buyFeeBps : policy.preset.sellFeeBps,
          };
          to = approval ? inputAsset : launch.curve;
          data = approval
            ? encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [launch.curve, amount],
              })
            : encodeFunctionData({
                abi: PicklerBondingCurveAbi,
                functionName: buying ? "buyExactInput" : "sellExactInput",
                args: [amount, minimumOutput, owner, BigInt(intent.deadline)],
              });
        } else if (intent.action === "graduate") {
          if (!intent.context.venue?.readyToGraduate || intent.context.venue.status !== "curve") {
            throw new Error("CURVE_NOT_READY");
          }
          to = policy.adapter.address;
          data = encodeFunctionData({
            abi: adapterAbi,
            functionName: "finalizeGraduation",
            args: [launch.curve],
          });
        } else if (intent.action === "collect_curve_fees") {
          to = launch.curve;
          data = encodeFunctionData({ abi: PicklerBondingCurveAbi, functionName: "remitFees" });
        } else if (intent.action === "collect_lp_fees") {
          if (
            policy.venue === "uniswap_v4" &&
            (intent.context.venue?.status !== "uniswap_v4" ||
              intent.context.venue.vault !== policy.locker.address ||
              intent.context.venue.market !== policy.poolManager.address ||
              !intent.context.venue.liquidityLocked)
          ) {
            throw new Error("TOKEN_VENUE_MISMATCH");
          }
          to = policy.locker.address;
          data = encodeFunctionData({
            abi: lockerAbi,
            functionName: "collectFees",
            args: [token],
          });
        } else if (intent.action === "claim_fees") {
          to = policy.escrow.address;
          const asset = intent.asset === "agent" ? token : policy.preset.quoteAddress;
          data = encodeFunctionData({
            abi: PicklerFeeEscrowV2Abi,
            functionName: "claim",
            args: [asset as Hex, intent.context.masterAddress as Hex],
          });
        } else {
          throw new Error("UNSUPPORTED_TOKEN_ACTION");
        }
      }
      const from = intent.context.masterAddress!;
      const [nonce, fees, estimate, organizationId] = await Promise.all([
        pendingNonce(rpc, from),
        policyFees(rpc),
        rpc.call("eth_estimateGas", [{ from, to, data, value: "0x0" }]),
        deps.organization(scope),
      ]);
      if (typeof estimate !== "string" || !/^0x[0-9a-f]+$/i.test(estimate)) {
        throw new Error("INVALID_GAS_ESTIMATE");
      }
      const gas = (BigInt(estimate) * 12n + 9n) / 10n;
      if (
        gas > BigInt(policy.maxGas) ||
        fees.maxFeePerGas > BigInt(policy.maxFeePerGas) ||
        gas * fees.maxFeePerGas > BigInt(policy.maxGasCost)
      ) {
        throw new TokenPreparationError("GAS_LIMIT_EXCEEDED");
      }
      const unsignedTransaction = serializeTransaction({
        type: "eip1559",
        chainId: 10143,
        nonce,
        to: to as Hex,
        value: 0n,
        data,
        gas,
        ...fees,
      });
      const prepared = {
        operationId: intent.id,
        configurationHash,
        chainId: 10143,
        sender: from,
        destination: to,
        unsignedTransaction,
        transactionNonce: nonce,
        gas: gas.toString(),
        maxFeePerGas: fees.maxFeePerGas.toString(),
        maximumGasCost: (gas * fees.maxFeePerGas).toString(),
        deadline: intent.deadline,
        ...(quote ? { quote } : {}),
        activity: deps.activities.signTransaction({
          subOrganizationId: organizationId,
          signWith: from,
          unsignedTransaction,
        }),
      };
      inspect(prepared);
      return prepared;
    },
    async preflight(prepared) {
      const rpc = rpcFor(prepared.operationId);
      const tx = inspect(prepared);
      await verifyDeployment(rpc);
      const [nonce, balance, block] = await Promise.all([
        pendingNonce(rpc, prepared.sender),
        rpc.call("eth_getBalance", [prepared.sender, "latest"]),
        rpc.call("eth_getBlockByNumber", ["latest", false]),
      ]);
      const header = block as { timestamp?: string; baseFeePerGas?: string } | null;
      const timestamp = header?.timestamp;
      const baseFee = header?.baseFeePerGas;
      if (
        !baseFee ||
        !/^0x[0-9a-f]+$/i.test(baseFee) ||
        BigInt(baseFee) + (tx.maxPriorityFeePerGas ?? 0n) > tx.maxFeePerGas! ||
        !timestamp ||
        BigInt(timestamp) >= BigInt(prepared.deadline) ||
        nonce !== tx.nonce ||
        BigInt(String(balance)) < BigInt(prepared.maximumGasCost)
      ) {
        throw new Error("TRANSACTION_NOT_SENDABLE");
      }
      // Re-simulate the exact swap/approval after the passkey delay; slippage, balances,
      // allowance and curve phase remain on-chain constraints, never a fresh rewritten quote.
      if (prepared.quote) {
        await rpc.call("eth_call", [
          { from: prepared.sender, to: tx.to, data: tx.data, value: "0x0" },
          "latest",
        ]);
      }
    },
    async sign(prepared, request) {
      if (request.url !== prepared.activity.url || request.body !== prepared.activity.body) {
        throw new Error("ACTIVITY_MISMATCH");
      }
      const result = await deps.forwarder.forward(request, {
        organizationId: prepared.activity.organizationId,
        allowedActivityTypes: [AGENT_WALLET_ACTIVITY_TYPES.signTransaction],
      });
      if (
        result.organizationId !== prepared.activity.organizationId ||
        result.type !== AGENT_WALLET_ACTIVITY_TYPES.signTransaction
      ) {
        throw new Error("ACTIVITY_MISMATCH");
      }
      return completed(result);
    },
    async activity(prepared, id) {
      const result = await deps.reader.getActivity(prepared.activity.organizationId, id);
      if (
        result.id !== id ||
        result.organizationId !== prepared.activity.organizationId ||
        result.type !== AGENT_WALLET_ACTIVITY_TYPES.signTransaction
      ) {
        throw new Error("ACTIVITY_MISMATCH");
      }
      return completed(result);
    },
    async verify(prepared, raw) {
      inspect(prepared);
      await verifySignedTransfer({
        signedTransaction: raw,
        unsignedTransaction: prepared.unsignedTransaction,
        signer: prepared.sender,
      });
      return transactionHash(raw);
    },
    broadcast: async (raw, prepared) => broadcastTransaction(rpcFor(prepared.operationId), raw),
    async receipt(hash, prepared) {
      const rpc = rpcFor(prepared.operationId, true);
      const receipt = (await rpc.call("eth_getTransactionReceipt", [hash])) as {
        transactionHash?: string;
        blockHash?: string;
        blockNumber?: string;
        status?: string;
      } | null;
      if (!receipt) {
        return null;
      }
      if (
        receipt.transactionHash !== hash ||
        !receipt.blockHash ||
        !receipt.blockNumber ||
        !["0x0", "0x1"].includes(receipt.status ?? "")
      ) {
        throw new Error("INVALID_RECEIPT");
      }
      const canonical = (await rpc.call("eth_getBlockByNumber", [receipt.blockNumber, false])) as {
        hash?: string;
      } | null;
      if (canonical?.hash !== receipt.blockHash) {
        return null;
      }
      const head = BigInt(String(await rpc.call("eth_blockNumber", [])));
      const final = head >= BigInt(receipt.blockNumber) + BigInt(policy.confirmations);
      if (receipt.status === "0x0" && !final) {
        return null;
      }
      return {
        status: receipt.status === "0x1" ? (final ? "finalized" : "included") : "reverted",
        blockHash: receipt.blockHash,
      };
    },
  };
}
