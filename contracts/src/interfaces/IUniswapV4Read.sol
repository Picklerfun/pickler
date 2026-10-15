// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @notice Read-only selectors used by the private verifier and canonical indexer.
/// @dev No SDK code; values are checked against the reviewed deployment and registered position.
interface IUniswapV4Read {
    function poolManager() external view returns (address);
    function permit2() external view returns (address);
    function ownerOf(uint256 tokenId) external view returns (address);
    function getPositionLiquidity(uint256 tokenId) external view returns (uint128);
    function getPoolAndPositionInfo(uint256 tokenId) external view returns (PoolKey memory, uint256);
}
