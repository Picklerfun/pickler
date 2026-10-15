// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Minimal Perpl owner account, collateral and forwarding interface.
/// @dev Signatures follow Perpl's integration flow and the existing mobile onboarding adapter.
interface IPerplExchange {
    function createAccount(uint256 amount) external returns (uint256);
    function allowOrderForwarding(bool allow) external;
    function depositCollateral(uint256 amount) external;
    function withdrawCollateral(uint256 amount) external;
}
