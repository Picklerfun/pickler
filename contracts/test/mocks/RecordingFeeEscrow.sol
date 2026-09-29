// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {IPicklerFeeEscrow} from "../../src/interfaces/IPicklerFeeEscrow.sol";

/// A fee escrow that only records. Stands in wherever a test cares that fees arrived and are
/// attributed, but not how they are split — the escrow's own suite covers that.
contract RecordingFeeEscrow is IPicklerFeeEscrow {
    uint256 public curveSyncs;
    uint256 public poolSyncs;

    address public lastLaunchToken;
    address public lastAsset;

    function syncCurveFees(address launchToken, address asset) external {
        curveSyncs++;
        lastLaunchToken = launchToken;
        lastAsset = asset;
    }

    function syncPoolFees(address launchToken, address asset) external {
        poolSyncs++;
        lastLaunchToken = launchToken;
        lastAsset = asset;
    }
}
