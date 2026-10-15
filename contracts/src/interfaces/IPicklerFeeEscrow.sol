// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title Fee escrow entry points
/// @notice The minimum the curve and the locker need to know about where fees go.
/// @dev Kept as an interface so neither has to import the escrow, which imports both of them.
interface IPicklerFeeEscrow {
    /// @notice Attributes trading fees the caller has just transferred to the escrow.
    function syncCurveFees(address launchToken, address asset) external;

    /// @notice Attributes pool fees the caller has just had collected into the escrow.
    function syncPoolFees(address launchToken, address asset) external;
}
