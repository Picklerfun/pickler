// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {PicklerCurveDeployer} from "./PicklerCurveDeployer.sol";
import {PicklerBondingCurve} from "./PicklerBondingCurve.sol";
import {PicklerGraduationAdapterKuru} from "./PicklerGraduationAdapterKuru.sol";
import {PicklerLaunchFactory} from "./PicklerLaunchFactory.sol";
import {PicklerPreset} from "./libraries/PicklerPreset.sol";

/// @notice New presets must bind the Kuru policy; old V4 deployers and presets are unaffected.
contract PicklerCurveDeployerKuru is PicklerCurveDeployer {
    error InvalidKuruPreset();
    bytes32 public immutable venueConfigHash;
    address public immutable quoteToken;

    constructor(PicklerGraduationAdapterKuru adapter_, address escrow_)
        PicklerCurveDeployer(address(adapter_), escrow_)
    {
        if (escrow_ != address(adapter_.escrow())) {
            revert InvalidKuruPreset();
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
                || preset.lpFeeTier != 0 || preset.lpTickSpacing != 0
                || PicklerLaunchFactory(msg.sender).presetVenueHash(preset.presetId, preset.version) != venueConfigHash
        ) revert InvalidKuruPreset();
        PicklerBondingCurve deployed = new PicklerBondingCurve(preset, graduationAdapter, feeEscrow);
        deployed.initialize(token);
        emit CurveDeployed(token, address(deployed));
        return address(deployed);
    }
}
