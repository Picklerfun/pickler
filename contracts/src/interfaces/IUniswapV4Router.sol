// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Minimal boundary for the separately verified, deployed Universal Router.
/// @dev This interface contains no router implementation or unrestricted Pickler action.
interface IUniswapV4Router {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}
