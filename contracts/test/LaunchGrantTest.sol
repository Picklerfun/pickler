// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {PicklerLaunchFactory} from "../src/PicklerLaunchFactory.sol";

/// Controlled test authority only. No operational signing key is configured by this suite.
abstract contract LaunchGrantTest is Test {
    uint256 internal constant PLATFORM_KEY = 0xC0FFEE;

    function _platformGrant(PicklerLaunchFactory target, PicklerLaunchFactory.LaunchParams memory p)
        internal
        view
        returns (bytes memory)
    {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Pickler"),
                keccak256("2"),
                block.chainid,
                address(target)
            )
        );
        bytes32 paramsHash = keccak256(
            abi.encode(
                keccak256(bytes(p.name)),
                keccak256(bytes(p.symbol)),
                keccak256(bytes(p.metadataURI)),
                p.metadataHash,
                p.presetId,
                p.presetVersion,
                p.expectedConfigHash,
                p.nonce,
                p.deadline
            )
        );
        bytes32 grantHash = keccak256(
            abi.encode(
                keccak256(
                    "LaunchGrant(bytes32 agentKey,address creator,address creatorFeeRecipient,bytes32 paramsHash,uint256 grantNonce,uint256 deadline)"
                ),
                p.agentKey,
                p.creator,
                p.creatorFeeRecipient,
                paramsHash,
                uint256(p.agentKey),
                p.deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(PLATFORM_KEY, keccak256(abi.encodePacked(hex"1901", domain, grantHash)));
        return abi.encodePacked(r, s, v);
    }
}
