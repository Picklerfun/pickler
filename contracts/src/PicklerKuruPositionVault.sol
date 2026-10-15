// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IKuruAccountCore, IKuruOrderBook} from "./interfaces/IKuruPassive.sol";
import {PicklerKuruPolicy} from "./libraries/PicklerKuruPolicy.sol";

/// @notice One isolated Kuru root account per launch. Principal has no exit function.
contract PicklerKuruPositionVault is ReentrancyGuard {
    using SafeERC20 for IERC20;
    error NotLocker();
    error InvalidPosition();
    error InvalidAccount();
    error AlreadySeeded();
    error InvalidAmounts();
    address public immutable locker;
    IKuruAccountCore public immutable accountCore;
    IKuruOrderBook public immutable market;
    address public immutable baseToken;
    address public immutable quoteToken;
    uint40 public accountId;
    bool public seeded;
    uint64[] public positionIds;
    mapping(uint64 => bytes32) private _positionIdentity;
    uint256 public preexistingBase;
    uint256 public preexistingQuote;
    uint256 public baseReserved;
    uint256 public quoteReserved;

    constructor(IKuruAccountCore core_, IKuruOrderBook market_, address base_, address quote_) {
        locker = msg.sender;
        accountCore = core_;
        market = market_;
        baseToken = base_;
        quoteToken = quote_;
    }

    function seed(PicklerKuruPolicy.Config calldata config, uint32 center, uint256 base, uint256 quote)
        external
        nonReentrant
    {
        if (msg.sender != locker) revert NotLocker();
        if (seeded) revert AlreadySeeded();
        seeded = true;
        accountId = accountCore.ensureRootAccount(address(this));
        if (
            accountCore.getAccountOwner(accountId) != address(this)
                || accountCore.getSpotReservedBalance(accountId, baseToken) != 0
                || accountCore.getSpotReservedBalance(accountId, quoteToken) != 0
        ) revert InvalidAccount();
        preexistingBase = accountCore.getBalance(accountId, baseToken);
        preexistingQuote = accountCore.getBalance(accountId, quoteToken);
        _deposit(baseToken, base);
        _deposit(quoteToken, quote);
        for (uint256 i; i < config.bands.length; ++i) {
            PicklerKuruPolicy.Band memory band = config.bands[i];
            int256 low = int256(uint256(center)) + int256(band.offsetTicks) * int256(uint256(config.tickSize));
            if (
                low <= 0
                    || SafeCast.toUint256(low) + uint256(config.passiveSpreadTicks) * config.tickSize > type(uint32).max
            ) revert InvalidAmounts();
            uint256 b = Math.mulDiv(base, band.baseWeightBps, 10_000);
            uint256 q = Math.mulDiv(quote, band.quoteWeightBps, 10_000);
            if (b > type(uint128).max || q > type(uint128).max) revert InvalidAmounts();
            (uint64 id, uint128 shares) = market.mintPassiveLiquidity(
                accountId,
                SafeCast.toUint32(SafeCast.toUint256(low)),
                SafeCast.toUint128(b),
                SafeCast.toUint128(q),
                band.minSharesOut,
                SafeCast.toUint64(block.timestamp)
            );
            IKuruOrderBook.Position memory p = market.getPassivePosition(id);
            if (
                shares < band.minSharesOut || p.shares != shares || p.ownerId != accountId
                    || p.lowPrice != SafeCast.toUint32(SafeCast.toUint256(low))
                    || p.highPrice != SafeCast.toUint256(low) + uint256(config.passiveSpreadTicks) * config.tickSize
                    || _positionIdentity[id] != bytes32(0)
            ) revert InvalidPosition();
            positionIds.push(id);
            _positionIdentity[id] = _identity(p);
        }
        baseReserved = accountCore.getSpotReservedBalance(accountId, baseToken);
        quoteReserved = accountCore.getSpotReservedBalance(accountId, quoteToken);
        if (
            baseReserved == 0 || quoteReserved == 0 || baseReserved > base || quoteReserved > quote
                || accountCore.getBalance(accountId, baseToken) + baseReserved != preexistingBase + base
                || accountCore.getBalance(accountId, quoteToken) + quoteReserved != preexistingQuote + quote
        ) revert InvalidAmounts();
    }

    function _deposit(address asset, uint256 amount) private {
        uint256 before = IERC20(asset).balanceOf(address(this));
        uint256 beforeLedger = accountCore.getBalance(accountId, asset);
        IERC20(asset).forceApprove(address(accountCore), amount);
        accountCore.deposit(address(this), asset, amount);
        IERC20(asset).forceApprove(address(accountCore), 0);
        if (
            IERC20(asset).balanceOf(address(this)) + amount != before
                || accountCore.getBalance(accountId, asset) != beforeLedger + amount
        ) revert InvalidAmounts();
    }

    /// @notice Withdraws only credits added by this exact fee-claim operation.
    /// @dev Checks account units against physical receipts. Unknown units fail closed.
    function collectFees() external nonReentrant returns (uint256 baseFees, uint256 quoteFees) {
        if (msg.sender != locker) revert NotLocker();
        if (!seeded || accountCore.getAccountOwner(accountId) != address(this)) revert InvalidAccount();
        uint256 beforeBase = accountCore.getBalance(accountId, baseToken);
        uint256 beforeQuote = accountCore.getBalance(accountId, quoteToken);
        uint256 reservedBase = accountCore.getSpotReservedBalance(accountId, baseToken);
        uint256 reservedQuote = accountCore.getSpotReservedBalance(accountId, quoteToken);
        uint256 reportedBase;
        uint256 reportedQuote;
        for (uint256 i; i < positionIds.length; ++i) {
            uint64 id = positionIds[i];
            if (_identity(market.getPassivePosition(id)) != _positionIdentity[id]) revert InvalidPosition();
            (uint128 b, uint128 q) = market.claimPassiveFees(accountId, id);
            reportedBase += b;
            reportedQuote += q;
            if (_identity(market.getPassivePosition(id)) != _positionIdentity[id]) revert InvalidPosition();
        }
        if (
            accountCore.getSpotReservedBalance(accountId, baseToken) != reservedBase
                || accountCore.getSpotReservedBalance(accountId, quoteToken) != reservedQuote
        ) revert InvalidPosition();
        baseFees = accountCore.getBalance(accountId, baseToken) - beforeBase;
        quoteFees = accountCore.getBalance(accountId, quoteToken) - beforeQuote;
        if (baseFees != reportedBase || quoteFees != reportedQuote) revert InvalidAmounts();
        _withdrawFees(baseToken, baseFees, beforeBase);
        _withdrawFees(quoteToken, quoteFees, beforeQuote);
        if (
            accountCore.getAccountOwner(accountId) != address(this)
                || accountCore.getSpotReservedBalance(accountId, baseToken) != reservedBase
                || accountCore.getSpotReservedBalance(accountId, quoteToken) != reservedQuote
        ) revert InvalidPosition();
        for (uint256 i; i < positionIds.length; ++i) {
            uint64 id = positionIds[i];
            if (_identity(market.getPassivePosition(id)) != _positionIdentity[id]) revert InvalidPosition();
        }
    }

    function _withdrawFees(address asset, uint256 amount, uint256 priorLedger) private {
        if (amount == 0) return;
        uint256 before = IERC20(asset).balanceOf(address(this));
        accountCore.withdraw(accountId, asset, amount, address(this));
        if (
            IERC20(asset).balanceOf(address(this)) != before + amount
                || accountCore.getBalance(accountId, asset) != priorLedger
        ) revert InvalidAmounts();
        IERC20(asset).safeTransfer(locker, amount);
    }

    function _identity(IKuruOrderBook.Position memory p) private pure returns (bytes32) {
        return keccak256(abi.encode(p.ownerId, p.lowPrice, p.highPrice, p.shares));
    }
}
