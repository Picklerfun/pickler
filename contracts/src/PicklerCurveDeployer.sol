// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ICurveDeployer} from "./interfaces/ICurveDeployer.sol";
import {PicklerBondingCurve} from "./PicklerBondingCurve.sol";
import {PicklerPreset} from "./libraries/PicklerPreset.sol";

/// @title Pickler curve deployer
/// @notice Deploys a bonding curve and binds it to its token, in one call.
/// @dev Exists so the factory can stay ignorant of what a curve is. It also closes the only
///      window in which a curve could be bound to the wrong token: construction and binding
///      happen here, in the same transaction, and the curve accepts a binding from nobody
///      else.
///
///      The graduation adapter and the fee escrow are fixed at deployment of this contract,
///      not chosen per launch, so no caller can point a launch's reserve at an address of
///      their own.
contract PicklerCurveDeployer is ICurveDeployer {
    // forge-lint: disable-next-item(screaming-snake-case-immutable)
    address public immutable graduationAdapter;
    // forge-lint: disable-next-item(screaming-snake-case-immutable)
    address public immutable feeEscrow;

    event CurveDeployed(address indexed token, address indexed curve);

    constructor(address graduationAdapter_, address feeEscrow_) {
        graduationAdapter = graduationAdapter_;
        feeEscrow = feeEscrow_;
    }

    /// @inheritdoc ICurveDeployer
    function deployCurve(address token, PicklerPreset.LaunchPreset calldata preset) external returns (address curve) {
        PicklerBondingCurve deployed = new PicklerBondingCurve(preset, graduationAdapter, feeEscrow);
        deployed.initialize(token);

        emit CurveDeployed(token, address(deployed));

        return address(deployed);
    }
}
