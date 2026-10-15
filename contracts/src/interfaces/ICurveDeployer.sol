// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {PicklerPreset} from "../libraries/PicklerPreset.sol";

/// @title Curve deployer
/// @notice How the factory obtains a curve for a launch.
/// @dev The factory deliberately knows nothing about what a curve does — only where to send
///      the supply. That keeps the two contracts independently reviewable, and lets the curve
///      change without touching the authorization and registry rules the factory enforces.
interface ICurveDeployer {
    /// @param token The launch's ERC-20. The curve receives its entire supply immediately after.
    /// @param preset The economic configuration, already validated by the factory.
    /// @return curve The deployed curve.
    function deployCurve(address token, PicklerPreset.LaunchPreset calldata preset) external returns (address curve);
}
