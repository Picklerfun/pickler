import { encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { TokenGrantIssuer } from "@pickler/core";
import { tokenAgentKey } from "../studio/token-launch-store.js";
import { tokenLaunchAllowsAgent, type TokenLaunchPolicy } from "./policy.js";
import type { createTokenMetadata } from "./metadata.js";
/** Dedicated grant key: no provider root credential, fund transfer or administrative signing. */
export function createPlatformTokenIssuer(
  policy: TokenLaunchPolicy,
  privateKey: string,
  metadata: ReturnType<typeof createTokenMetadata>,
  verifyDeployment: (operationId: string) => Promise<void>,
): TokenGrantIssuer {
  const account = privateKeyToAccount(privateKey as Hex);
  if (
    account.address.toLowerCase() !== policy.authority ||
    [
      policy.treasury,
      policy.factory.address,
      policy.adapter.address,
      policy.escrow.address,
      policy.locker.address,
      policy.deployer.address,
      ...(policy.venue === "uniswap_v4"
        ? [
            policy.poolManager.address,
            policy.positionManager.address,
            policy.stateView.address,
            policy.permit2.address,
            policy.quote.address,
          ]
        : [policy.router.address, policy.accountCore.address]),
    ].includes(policy.authority)
  ) {
    throw new Error("INVALID_LAUNCH_AUTHORITY");
  }
  return {
    allowedScope: (scope) => tokenLaunchAllowsAgent(policy, scope.agentId),
    factory: policy.factory.address,
    preset: policy.preset,
    launchVenue: {
      name: policy.venue,
      lpFeeBps: policy.venue === "uniswap_v4" ? policy.liquidity.feeTier / 100 : null,
    },
    async issue({ scope, context, draft, chainId, deadline, nonce, operationId }) {
      if (
        !tokenLaunchAllowsAgent(policy, scope.agentId) ||
        chainId !== policy.chainId ||
        context.masterAddress?.toLowerCase() === policy.authority
      ) {
        throw new Error("INVALID_LAUNCH_SCOPE");
      }
      await verifyDeployment(operationId);
      const frozen = await metadata.freeze(context, draft);
      const params = {
        agentKey: tokenAgentKey(chainId, scope.agentId),
        creator: context.masterAddress!,
        creatorFeeRecipient: context.masterAddress!,
        name: draft.name,
        symbol: draft.ticker,
        metadataURI: frozen.uri,
        metadataHash: frozen.hash,
        presetId: policy.preset.id,
        presetVersion: policy.preset.version,
        expectedConfigHash: policy.preset.configHash,
        nonce,
        deadline,
      };
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
            BigInt(nonce),
            BigInt(deadline),
          ],
        ),
      );
      const signature = await account.signTypedData({
        domain: {
          name: "Pickler",
          version: "2",
          chainId,
          verifyingContract: policy.factory.address as Hex,
        },
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
          grantNonce: BigInt(nonce),
          deadline: BigInt(deadline),
        },
      });
      return {
        imageUri: frozen.imageUri,
        avatar: { accent: context.accent, pattern: context.avatarPattern },
        chainId,
        factory: policy.factory.address,
        params,
        grantNonce: nonce,
        grantDeadline: deadline,
        signature,
      };
    },
  };
}
