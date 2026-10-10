// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PicklerFeeEscrowV2} from "./PicklerFeeEscrowV2.sol";

/// @notice Permanent NFT custody and fee-only collection. No principal withdrawal or upgrade exists.
/// @dev New deployments only. Historical V4 lockers retain their original accounting.
contract PicklerLiquidityLockerV2 is IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct LockedPosition {
        uint256 tokenId;
        PoolKey poolKey;
        uint128 liquidity;
        uint256 tokenRemainder;
        uint256 quoteRemainder;
        uint64 lockedAtBlock;
    }
    error NotAdapter();
    error InvalidPosition();
    error InvalidReceipt();
    IPositionManager public immutable positionManager;
    PicklerFeeEscrowV2 public immutable escrow;
    address public immutable adapter;
    mapping(address token => LockedPosition) private _positions;
    mapping(uint256 tokenId => bool) private _registered;
    event PositionLockedV2(
        address indexed token,
        uint256 indexed tokenId,
        uint128 liquidity,
        uint256 tokenRemainder,
        uint256 quoteRemainder
    );
    event PoolFeesCollected(address indexed token, uint256 indexed tokenId, uint256 tokenFees, uint256 quoteFees);

    constructor(IPositionManager manager_, PicklerFeeEscrowV2 escrow_, address adapter_) {
        positionManager = manager_;
        escrow = escrow_;
        adapter = adapter_;
    }

    function lockPosition(
        address token,
        uint256 tokenId,
        PoolKey calldata key,
        uint256 tokenRemainder,
        uint256 quoteRemainder
    ) external nonReentrant {
        if (msg.sender != adapter) revert NotAdapter();
        (PoolKey memory actual,) = positionManager.getPoolAndPositionInfo(tokenId);
        uint128 liquidity = positionManager.getPositionLiquidity(tokenId);
        address quote =
            Currency.unwrap(key.currency0) == token ? Currency.unwrap(key.currency1) : Currency.unwrap(key.currency0);
        if (
            _positions[token].tokenId != 0 || _registered[tokenId]
                || IERC721(address(positionManager)).ownerOf(tokenId) != address(this) || liquidity == 0
                || keccak256(abi.encode(actual)) != keccak256(abi.encode(key))
                || (Currency.unwrap(key.currency0) != token && Currency.unwrap(key.currency1) != token)
        ) revert InvalidPosition();
        _registered[tokenId] = true;
        _positions[token] =
            LockedPosition(tokenId, key, liquidity, tokenRemainder, quoteRemainder, uint64(block.number));
        _fund(token, tokenRemainder);
        _fund(quote, quoteRemainder);
        emit PositionLockedV2(token, tokenId, liquidity, tokenRemainder, quoteRemainder);
    }

    function _fund(address asset, uint256 amount) private {
        uint256 before = IERC20(asset).balanceOf(address(this));
        if (amount != 0) IERC20(asset).safeTransferFrom(adapter, address(this), amount);
        if (IERC20(asset).balanceOf(address(this)) != before + amount) revert InvalidReceipt();
    }

    function getLockedPosition(address token) external view returns (LockedPosition memory) {
        return _positions[token];
    }

    function collectFees(address token) external nonReentrant returns (uint256 tokenFees, uint256 quoteFees) {
        LockedPosition memory position = _positions[token];
        if (
            position.tokenId == 0 || IERC721(address(positionManager)).ownerOf(position.tokenId) != address(this)
                || positionManager.getPositionLiquidity(position.tokenId) != position.liquidity
        ) revert InvalidPosition();
        address quote = Currency.unwrap(position.poolKey.currency0) == token
            ? Currency.unwrap(position.poolKey.currency1)
            : Currency.unwrap(position.poolKey.currency0);
        uint256 beforeToken = IERC20(token).balanceOf(address(this));
        uint256 beforeQuote = IERC20(quote).balanceOf(address(this));
        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(position.tokenId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(position.poolKey.currency0, position.poolKey.currency1, address(this));
        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);
        if (
            IERC721(address(positionManager)).ownerOf(position.tokenId) != address(this)
                || positionManager.getPositionLiquidity(position.tokenId) != position.liquidity
        ) revert InvalidPosition();
        tokenFees = IERC20(token).balanceOf(address(this)) - beforeToken;
        quoteFees = IERC20(quote).balanceOf(address(this)) - beforeQuote;
        _remit(token, token, tokenFees);
        _remit(token, quote, quoteFees);
        if (
            IERC20(token).balanceOf(address(this)) != beforeToken
                || IERC20(quote).balanceOf(address(this)) != beforeQuote
        ) revert InvalidReceipt();
        emit PoolFeesCollected(token, position.tokenId, tokenFees, quoteFees);
    }

    function _remit(address token, address asset, uint256 amount) private {
        if (amount == 0) return;
        IERC20(asset).forceApprove(address(escrow), amount);
        escrow.receivePoolFees(token, asset, amount);
        IERC20(asset).forceApprove(address(escrow), 0);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(positionManager)) revert InvalidPosition();
        return IERC721Receiver.onERC721Received.selector;
    }
}
