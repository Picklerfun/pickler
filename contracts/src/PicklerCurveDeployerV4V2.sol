// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {PicklerCurveDeployer} from "./PicklerCurveDeployer.sol";
import {PicklerBondingCurve} from "./PicklerBondingCurve.sol";
import {PicklerGraduationAdapterV4V2} from "./PicklerGraduationAdapterV4V2.sol";
import {PicklerLaunchFactory} from "./PicklerLaunchFactory.sol";
import {PicklerPreset} from "./libraries/PicklerPreset.sol";

/// @notice New presets must bind the V4 policy; old V4 deployers and presets are unaffected.
contract PicklerCurveDeployerV4V2 is PicklerCurveDeployer {
    error InvalidV4Preset();
    bytes32 public immutable venueConfigHash;
    address public immutable quoteToken;

    constructor(PicklerGraduationAdapterV4V2 adapter_, address escrow_)
        PicklerCurveDeployer(address(adapter_), escrow_)
    {
        if (escrow_ != address(adapter_.escrow())) {
            revert InvalidV4Preset();
        }
        venueConfigHash = adapter_.venueConfigHash();
        quoteToken = adapter_.config().quoteToken;
    }

    function deployCurve(address token, PicklerPreset.LaunchPreset calldata preset)
        external
        override
        returns (address)
    {
        if (
            preset.roundingPolicyVersion != 2 || preset.lpCreatorShareBps != 5000 || preset.quoteToken != quoteToken
                || preset.lpFeeTier != 10_000 || preset.lpTickSpacing != 200
                || PicklerLaunchFactory(msg.sender).presetVenueHash(preset.presetId, preset.version) != venueConfigHash
        ) revert InvalidV4Preset();
        PicklerBondingCurve deployed = new PicklerBondingCurve(preset, graduationAdapter, feeEscrow);
        deployed.initialize(token);
        emit CurveDeployed(token, address(deployed));
        return address(deployed);
    }
}
