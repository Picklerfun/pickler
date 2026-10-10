// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

import {IPicklerFeeEscrow} from "./interfaces/IPicklerFeeEscrow.sol";

/// @title Pickler liquidity locker
/// @notice Holds a launch's initial liquidity position forever, and lets only its fees out.
/// @dev The contract's value is in what it cannot do. There is no transfer, no approval, no
///      generic call or delegatecall, no rescue of a stuck token and no upgrade path that
///      could add one later. The position arrives here and never leaves.
///
///      `collectFees` is the one operation, and it is permissionless because it has no
///      discretion: the amount of liquidity it withdraws is the constant zero, and the
///      recipient is an address fixed when this contract was deployed. A caller chooses
///      nothing except when to trigger it.
contract PicklerLiquidityLocker is IERC721Receiver {
    struct LockedPosition {
        uint256 tokenId;
        PoolKey poolKey;
        uint64 lockedAtBlock;
    }

    error NotAdapter();
    error NotPositionManager();
    error PositionAlreadyLocked();
    error NoPositionForLaunch();

    event PositionLocked(address indexed token, uint256 indexed tokenId);
    event FeesCollected(address indexed token, uint256 indexed tokenId, address recipient);

    // forge-lint: disable-next-item(screaming-snake-case-immutable)
    IPositionManager public immutable positionManager;

    /// @notice Where collected fees go. Fixed here so no caller can redirect them.
    // forge-lint: disable-next-item(screaming-snake-case-immutable)
    address public immutable feeRecipient;

    /// @notice The only account allowed to register a position as locked.
    // forge-lint: disable-next-item(screaming-snake-case-immutable)
    address public immutable adapter;

    mapping(address token => LockedPosition) private _positions;

    constructor(IPositionManager positionManager_, address feeRecipient_, address adapter_) {
        positionManager = positionManager_;
        feeRecipient = feeRecipient_;
        adapter = adapter_;
    }

    /// @notice Records the position the adapter just minted to this contract.
    /// @dev Called by the adapter in the same transaction as the mint. The position itself is
    ///      already here; this only records what it belongs to, so fees can be collected for
    ///      it later.
    function lockPosition(address token, uint256 tokenId, PoolKey calldata poolKey) external {
        if (msg.sender != adapter) {
            revert NotAdapter();
        }
        if (_positions[token].tokenId != 0) {
            revert PositionAlreadyLocked();
        }

        _positions[token] = LockedPosition({tokenId: tokenId, poolKey: poolKey, lockedAtBlock: uint64(block.number)});

        emit PositionLocked(token, tokenId);
    }

    function getLockedPosition(address token) external view returns (LockedPosition memory) {
        return _positions[token];
    }

    /// @notice Sends a launch's accrued pool fees to the fee recipient.
    /// @dev Decreasing zero liquidity is what makes this a fee collection rather than a
    ///      withdrawal: the position's principal is untouched, and only what the pool already
    ///      owes is taken. The zero is a constant in this function, not a parameter.
    function collectFees(address token) external {
        LockedPosition memory position = _positions[token];
        if (position.tokenId == 0) {
            revert NoPositionForLaunch();
        }

        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));

        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(position.tokenId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(position.poolKey.currency0, position.poolKey.currency1, feeRecipient);

        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);

        // Both currencies, in the same call as the collection, so the escrow attributes what
        // arrived to this launch rather than to whichever one happens to sync next.
        IPicklerFeeEscrow(feeRecipient).syncPoolFees(token, Currency.unwrap(position.poolKey.currency0));
        IPicklerFeeEscrow(feeRecipient).syncPoolFees(token, Currency.unwrap(position.poolKey.currency1));

        emit FeesCollected(token, position.tokenId, feeRecipient);
    }

    /// @notice Accepts the position NFT. Nothing here can send it back out.
    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(positionManager)) {
            revert NotPositionManager();
        }

        return IERC721Receiver.onERC721Received.selector;
    }
}
