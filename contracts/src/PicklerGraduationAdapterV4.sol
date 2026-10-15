// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {IStateView} from "v4-periphery/src/interfaces/IStateView.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";

import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {PicklerBondingCurve} from "./PicklerBondingCurve.sol";
import {PicklerLiquidityLocker} from "./PicklerLiquidityLocker.sol";
import {PicklerPreset} from "./libraries/PicklerPreset.sol";

/// @title Pickler graduation adapter (Uniswap V4)
/// @notice Turns an exhausted curve into a pool whose liquidity is locked forever.
/// @dev Permissionless and atomic. Anyone may call `finalizeGraduation` once a curve is
///      exhausted; nobody can call it earlier, and nobody can call it in a way that sends the
///      funds anywhere but the pool. If any step fails the whole transaction reverts and the
///      money is still in the curve, which is why retrying is safe and why no administrative
///      recovery path exists.
///
///      Three constraints come from the A4 spike, each learned by hitting it:
///
///      - Currency order follows address, not role. The agent token may sort either side, so
///        amounts are assigned by comparison rather than assumption.
///      - Approvals are two-step: ERC-20 to Permit2, then Permit2 to the PositionManager.
///      - Anyone can open the pool before us. `PoolKey` is public and initialization is
///        permissionless, so an existing pool is compared against the price the curve closed
///        at and rejected outside tolerance. A salt would not help; only the check does.
contract PicklerGraduationAdapterV4 is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    error CurveNotReady();
    error AlreadyGraduated();
    error PoolPriceOutOfTolerance(uint160 observed, uint160 intended);
    error NothingToGraduate();
    error AmountTooLargeForPool(uint256 amount);

    event LaunchGraduated(
        address indexed token,
        address indexed curve,
        PoolId indexed poolId,
        uint256 tokenId,
        uint256 quoteUsed,
        uint256 tokensUsed,
        uint256 quoteDust,
        uint256 tokenDust
    );

    /// @notice How far an already-initialized pool may sit from our price, in basis points.
    /// @dev Non-zero because a pool opened honestly by someone else at our price will still
    ///      differ in the last bits of a square root. Wide enough to tolerate that, far too
    ///      narrow to accept a pool opened at a price of someone else's choosing.
    uint256 public constant PRICE_TOLERANCE_BPS = 100;

    // forge-lint: disable-next-item(screaming-snake-case-immutable)
    IPoolManager public immutable poolManager;
    // forge-lint: disable-next-item(screaming-snake-case-immutable)
    IPositionManager public immutable positionManager;
    // forge-lint: disable-next-item(screaming-snake-case-immutable)
    IStateView public immutable stateView;
    // forge-lint: disable-next-item(screaming-snake-case-immutable)
    IAllowanceTransfer public immutable permit2;
    // forge-lint: disable-next-item(screaming-snake-case-immutable)
    PicklerLiquidityLocker public immutable locker;

    mapping(address curve => bool) public graduated;

    /// @dev The adapter deploys its own locker so neither needs the other's address first,
    ///      and so a locker can never be pointed at a different adapter afterwards.
    constructor(
        IPoolManager poolManager_,
        IPositionManager positionManager_,
        IStateView stateView_,
        IAllowanceTransfer permit2_,
        address feeRecipient_
    ) {
        poolManager = poolManager_;
        positionManager = positionManager_;
        stateView = stateView_;
        permit2 = permit2_;
        locker = new PicklerLiquidityLocker(positionManager_, feeRecipient_, address(this));
    }

    /// @notice Opens the pool, seeds it and locks the position, in one transaction.
    function finalizeGraduation(PicklerBondingCurve curve) external nonReentrant {
        if (curve.phase() != PicklerBondingCurve.Phase.READY_TO_GRADUATE) {
            revert CurveNotReady();
        }
        if (graduated[address(curve)]) {
            revert AlreadyGraduated();
        }
        graduated[address(curve)] = true;

        PicklerPreset.LaunchPreset memory preset = curve.preset();
        address token = address(curve.token());

        (uint256 quoteReleased, uint256 tokensReleased) = curve.releaseForGraduation();
        if (quoteReleased == 0 || tokensReleased == 0) {
            revert NothingToGraduate();
        }

        (PoolKey memory poolKey, uint256 amount0, uint256 amount1) =
            _buildPool(token, preset, quoteReleased, tokensReleased);

        uint160 sqrtPriceX96 = _openPool(poolKey, amount0, amount1);
        uint256 tokenId = _mintLockedPosition(poolKey, sqrtPriceX96, amount0, amount1);

        locker.lockPosition(token, tokenId, poolKey);

        emit LaunchGraduated(
            token,
            address(curve),
            poolKey.toId(),
            tokenId,
            quoteReleased,
            tokensReleased,
            IERC20(preset.quoteToken).balanceOf(address(this)),
            IERC20(token).balanceOf(address(this))
        );
    }

    /// @notice The pool a launch would graduate into, so callers can inspect it beforehand.
    function getPoolKey(address token, PicklerPreset.LaunchPreset memory preset)
        public
        pure
        returns (PoolKey memory poolKey)
    {
        (poolKey,,) = _poolKeyFor(token, preset);
    }

    function _buildPool(
        address token,
        PicklerPreset.LaunchPreset memory preset,
        uint256 quoteReleased,
        uint256 tokensReleased
    ) private pure returns (PoolKey memory poolKey, uint256 amount0, uint256 amount1) {
        bool tokenIsCurrency0;
        (poolKey, tokenIsCurrency0,) = _poolKeyFor(token, preset);

        (amount0, amount1) = tokenIsCurrency0 ? (tokensReleased, quoteReleased) : (quoteReleased, tokensReleased);
    }

    function _poolKeyFor(address token, PicklerPreset.LaunchPreset memory preset)
        private
        pure
        returns (PoolKey memory poolKey, bool tokenIsCurrency0, address quoteToken)
    {
        quoteToken = preset.quoteToken;
        tokenIsCurrency0 = token < quoteToken;

        (address currency0, address currency1) = tokenIsCurrency0 ? (token, quoteToken) : (quoteToken, token);

        poolKey = PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: preset.lpFeeTier,
            tickSpacing: preset.lpTickSpacing,
            hooks: IHooks(address(0))
        });
    }

    /// @dev Initializes the pool, or verifies an existing one is at the price we intended.
    function _openPool(PoolKey memory poolKey, uint256 amount0, uint256 amount1)
        private
        returns (uint160 sqrtPriceX96)
    {
        sqrtPriceX96 = _sqrtPriceX96(amount0, amount1);

        (uint160 existing,,,) = stateView.getSlot0(poolKey.toId());
        if (existing == 0) {
            poolManager.initialize(poolKey, sqrtPriceX96);

            return sqrtPriceX96;
        }

        uint256 difference = existing > sqrtPriceX96 ? existing - sqrtPriceX96 : sqrtPriceX96 - existing;
        if (difference * 10_000 > uint256(sqrtPriceX96) * PRICE_TOLERANCE_BPS) {
            revert PoolPriceOutOfTolerance(existing, sqrtPriceX96);
        }

        // Someone opened it at our price already. Seed it rather than fail the launch.
        return existing;
    }

    function _mintLockedPosition(PoolKey memory poolKey, uint160 sqrtPriceX96, uint256 amount0, uint256 amount1)
        private
        returns (uint256 tokenId)
    {
        int24 tickLower = _usableTick(TickMath.MIN_TICK, poolKey.tickSpacing);
        int24 tickUpper = _usableTick(TickMath.MAX_TICK, poolKey.tickSpacing);

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            amount0,
            amount1
        );

        _approveThroughPermit2(Currency.unwrap(poolKey.currency0));
        _approveThroughPermit2(Currency.unwrap(poolKey.currency1));

        tokenId = positionManager.nextTokenId();

        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));

        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            poolKey,
            tickLower,
            tickUpper,
            liquidity,
            _toUint128(amount0),
            _toUint128(amount1),
            address(locker),
            bytes("")
        );
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1);

        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);
    }

    /// @dev These are the maxima the mint may spend. Truncating one would silently pass a
    ///      bound we never chose, so a launch too large for the pool's own type reverts
    ///      instead. No preset this repository can produce reaches it; a future one might.
    function _toUint128(uint256 amount) private pure returns (uint128) {
        if (amount > type(uint128).max) {
            revert AmountTooLargeForPool(amount);
        }

        // Checked immediately above; this is the cast the check exists to make safe.
        // forge-lint: disable-next-item(unsafe-typecast)
        return uint128(amount);
    }

    function _approveThroughPermit2(address currency) private {
        IERC20(currency).forceApprove(address(permit2), type(uint256).max);
        permit2.approve(currency, address(positionManager), type(uint160).max, type(uint48).max);
    }

    /// @dev Floors an extreme tick onto a multiple of the spacing, which is what the pool
    ///      means by full range.
    function _usableTick(int24 tick, int24 tickSpacing) private pure returns (int24) {
        // forge-lint: disable-next-item(divide-before-multiply)
        return (tick / tickSpacing) * tickSpacing;
    }

    /// @dev sqrt(amount1 / amount0) in Q64.96. Shifting by 96 before the root leaves a
    ///      further 2^48 to apply, which keeps the intermediate inside uint256 for the
    ///      amounts a launch can actually produce.
    function _sqrtPriceX96(uint256 amount0, uint256 amount1) private pure returns (uint160) {
        uint256 ratio = FullMath.mulDiv(amount1, 1 << 96, amount0);

        return uint160(_sqrt(ratio) << 48);
    }

    function _sqrt(uint256 value) private pure returns (uint256 result) {
        if (value == 0) {
            return 0;
        }

        result = value;
        uint256 next = value / 2 + 1;
        while (next < result) {
            result = next;
            next = (value / next + next) / 2;
        }
    }
}
