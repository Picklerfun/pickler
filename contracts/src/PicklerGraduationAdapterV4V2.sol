// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {IStateView} from "v4-periphery/src/interfaces/IStateView.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {PicklerBondingCurve} from "./PicklerBondingCurve.sol";
import {PicklerLaunchFactory} from "./PicklerLaunchFactory.sol";
import {PicklerFeeEscrowV2} from "./PicklerFeeEscrowV2.sol";
import {PicklerLiquidityLockerV2} from "./PicklerLiquidityLockerV2.sol";

interface IV4PermitBinding {
    function permit2() external view returns (address);
}

/// @notice Versioned testnet V4 graduation, exact receipts and permanent principal custody.
/// @dev Historical V4 and Kuru deployments remain independent. No swap tax is added by Pickler.
contract PicklerGraduationAdapterV4V2 is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    struct Config {
        uint32 version;
        address quoteToken;
        uint24 feeTier;
        int24 tickSpacing;
        uint16 sqrtPriceToleranceBps;
    }
    error InvalidConfiguration();
    error InvalidLaunch();
    error CurveNotReady();
    error InvalidPrice();
    error InvalidAmounts();
    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    IStateView public immutable stateView;
    IAllowanceTransfer public immutable permit2;
    PicklerFeeEscrowV2 public immutable escrow;
    PicklerLiquidityLockerV2 public immutable locker;
    bytes32 public immutable venueConfigHash;
    bytes32 public immutable poolManagerCodeHash;
    bytes32 public immutable positionManagerCodeHash;
    bytes32 public immutable stateViewCodeHash;
    bytes32 public immutable permit2CodeHash;
    Config private _config;
    mapping(address curve => bool) public graduated;
    event LaunchGraduatedV4V2(
        address indexed token,
        address indexed curve,
        bytes32 indexed poolId,
        uint256 tokenId,
        bytes32 venueHash,
        uint256 quoteReleased,
        uint256 tokensReleased,
        uint256 quoteUsed,
        uint256 tokenUsed,
        uint256 quoteRemainder,
        uint256 tokenRemainder
    );

    constructor(
        IPoolManager pool_,
        IPositionManager positions_,
        IStateView view_,
        IAllowanceTransfer permit_,
        PicklerFeeEscrowV2 escrow_,
        Config memory config_
    ) {
        if (
            block.chainid != 10143 || address(pool_).code.length == 0 || address(positions_).code.length == 0
                || address(view_).code.length == 0 || address(permit_).code.length == 0
                || address(escrow_).code.length == 0 || address(positions_.poolManager()) != address(pool_)
                || IV4PermitBinding(address(positions_)).permit2() != address(permit_)
                || address(view_.poolManager()) != address(pool_) || config_.version != 1 || config_.feeTier != 10_000
                || config_.tickSpacing != 200 || config_.sqrtPriceToleranceBps != 5
                || config_.quoteToken.code.length == 0 || IERC20Metadata(config_.quoteToken).decimals() != 6
        ) revert InvalidConfiguration();
        poolManager = pool_;
        positionManager = positions_;
        stateView = view_;
        permit2 = permit_;
        escrow = escrow_;
        _config = config_;
        poolManagerCodeHash = address(pool_).codehash;
        positionManagerCodeHash = address(positions_).codehash;
        stateViewCodeHash = address(view_).codehash;
        permit2CodeHash = address(permit_).codehash;
        venueConfigHash = keccak256(
            abi.encode(
                "PicklerUniswapV4V2",
                block.chainid,
                address(pool_),
                address(positions_),
                address(view_),
                address(permit_),
                poolManagerCodeHash,
                positionManagerCodeHash,
                stateViewCodeHash,
                permit2CodeHash,
                config_
            )
        );
        locker = new PicklerLiquidityLockerV2(positions_, escrow_, address(this));
    }

    function config() external view returns (Config memory) {
        return _config;
    }

    struct Graduation {
        address token;
        uint256 beforeToken;
        uint256 beforeQuote;
        uint256 quote;
        uint256 base;
        uint256 id;
        uint256 tokenRemainder;
        uint256 quoteRemainder;
        PoolKey key;
    }

    function finalizeGraduation(PicklerBondingCurve curve) external nonReentrant {
        _requireLaunch(curve);
        graduated[address(curve)] = true;
        Graduation memory g;
        g.token = address(curve.token());
        g.beforeToken = IERC20(g.token).balanceOf(address(this));
        g.beforeQuote = IERC20(_config.quoteToken).balanceOf(address(this));
        (g.quote, g.base) = curve.releaseForGraduation();
        if (
            g.quote == 0 || g.base == 0 || IERC20(g.token).balanceOf(address(this)) != g.beforeToken + g.base
                || IERC20(_config.quoteToken).balanceOf(address(this)) != g.beforeQuote + g.quote
        ) revert InvalidAmounts();
        _checkContinuity(curve, g.quote, g.base);
        g.key = _key(g.token);
        (uint256 amount0, uint256 amount1) = g.token < _config.quoteToken ? (g.base, g.quote) : (g.quote, g.base);
        g.id = _mint(g.key, _openPool(g.key, amount0, amount1), amount0, amount1);
        g.tokenRemainder = IERC20(g.token).balanceOf(address(this)) - g.beforeToken;
        g.quoteRemainder = IERC20(_config.quoteToken).balanceOf(address(this)) - g.beforeQuote;
        if (g.tokenRemainder > g.base / 1000 || g.quoteRemainder > g.quote / 1000) revert InvalidAmounts();
        IERC20(g.token).forceApprove(address(locker), g.tokenRemainder);
        IERC20(_config.quoteToken).forceApprove(address(locker), g.quoteRemainder);
        locker.lockPosition(g.token, g.id, g.key, g.tokenRemainder, g.quoteRemainder);
        IERC20(g.token).forceApprove(address(locker), 0);
        IERC20(_config.quoteToken).forceApprove(address(locker), 0);
        if (
            IERC20(g.token).balanceOf(address(this)) != g.beforeToken
                || IERC20(_config.quoteToken).balanceOf(address(this)) != g.beforeQuote
        ) revert InvalidAmounts();
        emit LaunchGraduatedV4V2(
            g.token,
            address(curve),
            PoolId.unwrap(g.key.toId()),
            g.id,
            venueConfigHash,
            g.quote,
            g.base,
            g.quote - g.quoteRemainder,
            g.base - g.tokenRemainder,
            g.quoteRemainder,
            g.tokenRemainder
        );
    }

    function _checkContinuity(PicklerBondingCurve curve, uint256 quote, uint256 base) private view {
        uint256 reservePrice = Math.mulDiv(quote, 1e30, base);
        uint256 curvePrice = curve.marginalPriceWad();
        uint256 diff = reservePrice > curvePrice ? reservePrice - curvePrice : curvePrice - reservePrice;
        if (diff > curvePrice / 10_000) revert InvalidPrice();
    }

    function _requireLaunch(PicklerBondingCurve curve) private view {
        if (graduated[address(curve)] || curve.phase() != PicklerBondingCurve.Phase.READY_TO_GRADUATE) {
            revert CurveNotReady();
        }
        address token = address(curve.token());
        PicklerLaunchFactory factory = escrow.factory();
        PicklerLaunchFactory.LaunchRecord memory record = factory.getLaunch(token);
        if (
            record.token != token || record.curve != address(curve) || curve.graduationAdapter() != address(this)
                || curve.feeEscrow() != address(escrow) || record.quoteToken != _config.quoteToken
                || factory.presetVenueHash(curve.preset().presetId, curve.preset().version) != venueConfigHash
        ) revert InvalidLaunch();
        if (
            address(poolManager).codehash != poolManagerCodeHash
                || address(positionManager).codehash != positionManagerCodeHash
                || address(stateView).codehash != stateViewCodeHash || address(permit2).codehash != permit2CodeHash
        ) revert InvalidConfiguration();
    }

    function _key(address token) private view returns (PoolKey memory) {
        (address a, address b) = token < _config.quoteToken ? (token, _config.quoteToken) : (_config.quoteToken, token);
        return PoolKey(Currency.wrap(a), Currency.wrap(b), _config.feeTier, _config.tickSpacing, IHooks(address(0)));
    }

    function _openPool(PoolKey memory key, uint256 amount0, uint256 amount1) private returns (uint160 price) {
        uint160 intended = SafeCast.toUint160(Math.sqrt(Math.mulDiv(amount1, 1 << 96, amount0)) << 48);
        (price,,,) = stateView.getSlot0(key.toId());
        if (price == 0) {
            poolManager.initialize(key, intended);
            return intended;
        }
        uint256 diff = price > intended ? uint256(price) - intended : uint256(intended) - price;
        if (diff > Math.mulDiv(intended, _config.sqrtPriceToleranceBps, 10_000)) revert InvalidPrice();
    }

    function _mint(PoolKey memory key, uint160 price, uint256 amount0, uint256 amount1) private returns (uint256 id) {
        // forge-lint: disable-next-line(divide-before-multiply)
        int24 lower = (TickMath.MIN_TICK / _config.tickSpacing) * _config.tickSpacing;
        // forge-lint: disable-next-line(divide-before-multiply)
        int24 upper = (TickMath.MAX_TICK / _config.tickSpacing) * _config.tickSpacing;
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            price, TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), amount0, amount1
        );
        if (liquidity == 0) revert InvalidAmounts();
        id = positionManager.nextTokenId();
        _approve(Currency.unwrap(key.currency0), amount0);
        _approve(Currency.unwrap(key.currency1), amount1);
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            key,
            lower,
            upper,
            liquidity,
            SafeCast.toUint128(amount0),
            SafeCast.toUint128(amount1),
            address(locker),
            bytes("")
        );
        params[1] = abi.encode(key.currency0, key.currency1);
        positionManager.modifyLiquidities(
            abi.encode(abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR)), params),
            block.timestamp
        );
        _revoke(Currency.unwrap(key.currency0));
        _revoke(Currency.unwrap(key.currency1));
        if (positionManager.getPositionLiquidity(id) != liquidity) revert InvalidAmounts();
    }

    function _approve(address token, uint256 amount) private {
        IERC20(token).forceApprove(address(permit2), amount);
        permit2.approve(token, address(positionManager), SafeCast.toUint160(amount), SafeCast.toUint48(block.timestamp));
    }

    function _revoke(address token) private {
        permit2.approve(token, address(positionManager), 0, 0);
        IERC20(token).forceApprove(address(permit2), 0);
    }
}
