// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IKuruAccountCore, IKuruSpotRouter, IKuruOrderBook} from "./interfaces/IKuruPassive.sol";
import {PicklerCurveMath} from "./libraries/PicklerCurveMath.sol";
import {PicklerKuruPolicy} from "./libraries/PicklerKuruPolicy.sol";
import {PicklerBondingCurve} from "./PicklerBondingCurve.sol";
import {PicklerLaunchFactory} from "./PicklerLaunchFactory.sol";
import {PicklerFeeEscrowV2} from "./PicklerFeeEscrowV2.sol";
import {PicklerKuruLiquidityLocker} from "./PicklerKuruLiquidityLocker.sol";
import {PicklerKuruPositionVault} from "./PicklerKuruPositionVault.sol";

/// @notice Controlled passive-generation adapter. Operational admission requires verified Kuru deployments.
/// @dev Legacy Kuru is deliberately incompatible. The profile binds all parameters and contract identities.
contract PicklerGraduationAdapterKuru is ReentrancyGuard {
    using SafeERC20 for IERC20;
    error InvalidConfiguration();
    error InvalidMarket();
    error InvalidLaunch();
    error CurveNotReady();
    error InvalidPrice();
    error InvalidAmounts();
    IKuruSpotRouter public immutable router;
    IKuruAccountCore public immutable accountCore;
    PicklerFeeEscrowV2 public immutable escrow;
    PicklerKuruLiquidityLocker public immutable locker;
    bytes32 public immutable venueConfigHash;
    bytes32 public immutable routerCodeHash;
    bytes32 public immutable coreCodeHash;
    PicklerKuruPolicy.Config private _config;
    mapping(address curve => bool) public graduated;

    event LaunchGraduatedKuru(
        address indexed token,
        address indexed curve,
        address indexed market,
        address vault,
        uint40 accountId,
        bytes32 venueHash,
        uint256 quoteReleased,
        uint256 tokensReleased,
        uint256 quoteReserved,
        uint256 tokensReserved,
        uint256 quoteRemainder,
        uint256 tokenRemainder
    );

    constructor(
        IKuruSpotRouter router_,
        IKuruAccountCore core_,
        PicklerFeeEscrowV2 escrow_,
        PicklerKuruPolicy.Config memory config_
    ) {
        PicklerKuruPolicy.validate(config_);
        if (
            block.chainid != 10143 || address(router_).code.length == 0 || address(core_).code.length == 0
                || address(escrow_).code.length == 0 || router_.spotBalanceAccountAddress() != address(core_)
                || IERC20Metadata(config_.quoteToken).decimals() != 6
        ) revert InvalidConfiguration();
        (uint256 x, uint256 q) = PicklerCurveMath.deriveReserves(16_800_000e18, 4_200_000e18, 32_000e6);
        uint32 center = _center(
            PicklerCurveMath.marginalPriceWad(PicklerCurveMath.CurveConfig(x, q, 16_800_000e18), 16_800_000e18, 6),
            config_
        );
        for (uint256 i; i < config_.bands.length; ++i) {
            int256 low =
                int256(uint256(center)) + int256(config_.bands[i].offsetTicks) * int256(uint256(config_.tickSize));
            if (
                low <= 0
                    || SafeCast.toUint256(low) + uint256(config_.passiveSpreadTicks) * config_.tickSize
                        > type(uint32).max
            ) revert InvalidConfiguration();
        }
        router = router_;
        accountCore = core_;
        escrow = escrow_;
        _config.version = config_.version;
        _config.quoteToken = config_.quoteToken;
        _config.sizePrecision = config_.sizePrecision;
        _config.pricePrecision = config_.pricePrecision;
        _config.tickSize = config_.tickSize;
        _config.passiveSpreadTicks = config_.passiveSpreadTicks;
        _config.minQuoteNotional = config_.minQuoteNotional;
        _config.maxQuoteNotional = config_.maxQuoteNotional;
        _config.takerFeePps = config_.takerFeePps;
        _config.makerFeePps = config_.makerFeePps;
        for (uint256 i; i < config_.bands.length; ++i) {
            _config.bands.push(config_.bands[i]);
        }
        routerCodeHash = address(router_).codehash;
        coreCodeHash = address(core_).codehash;
        venueConfigHash = keccak256(
            abi.encode(
                "PicklerKuruPassiveV1",
                block.chainid,
                address(router_),
                address(core_),
                routerCodeHash,
                coreCodeHash,
                config_
            )
        );
        locker = new PicklerKuruLiquidityLocker(address(this), core_, escrow_);
    }

    function config() external view returns (PicklerKuruPolicy.Config memory) {
        return _config;
    }

    function finalizeGraduation(PicklerBondingCurve curve) external nonReentrant {
        if (graduated[address(curve)] || curve.phase() != PicklerBondingCurve.Phase.READY_TO_GRADUATE) {
            revert CurveNotReady();
        }
        address token = address(curve.token());
        PicklerLaunchFactory factory = escrow.factory();
        PicklerLaunchFactory.LaunchRecord memory record = factory.getLaunch(token);
        if (
            record.token != token || record.curve != address(curve) || curve.graduationAdapter() != address(this)
                || record.quoteToken != _config.quoteToken || curve.feeEscrow() != address(escrow)
                || factory.presetVenueHash(curve.preset().presetId, curve.preset().version) != venueConfigHash
        ) revert InvalidLaunch();
        if (
            address(router).codehash != routerCodeHash || address(accountCore).codehash != coreCodeHash
                || !accountCore.spotTokenEnabled(token) || !accountCore.spotTokenEnabled(_config.quoteToken)
                || accountCore.getSpotTokenDecimals(token) != 18
                || accountCore.getSpotTokenDecimals(_config.quoteToken) != 6
        ) revert InvalidConfiguration();
        uint32 center = _center(curve.marginalPriceWad(), _config);
        graduated[address(curve)] = true;
        uint256 beforeBase = IERC20(token).balanceOf(address(this));
        uint256 beforeQuote = IERC20(_config.quoteToken).balanceOf(address(this));
        (uint256 quote, uint256 base) = curve.releaseForGraduation();
        if (
            base == 0 || quote == 0 || IERC20(token).balanceOf(address(this)) != beforeBase + base
                || IERC20(_config.quoteToken).balanceOf(address(this)) != beforeQuote + quote
        ) revert InvalidAmounts();
        IKuruOrderBook market = IKuruOrderBook(
            router.deploySpotMarket(
                token,
                _config.quoteToken,
                _config.sizePrecision,
                _config.pricePrecision,
                _config.tickSize,
                _config.passiveSpreadTicks,
                _config.minQuoteNotional,
                _config.maxQuoteNotional,
                _config.takerFeePps,
                _config.makerFeePps
            )
        );
        _verifyMarket(market, token);
        IERC20(token).forceApprove(address(locker), base);
        IERC20(_config.quoteToken).forceApprove(address(locker), quote);
        PicklerKuruPositionVault vault = locker.lockPositions(token, market, _config, center, base, quote);
        IERC20(token).forceApprove(address(locker), 0);
        IERC20(_config.quoteToken).forceApprove(address(locker), 0);
        if (
            IERC20(token).balanceOf(address(this)) != beforeBase
                || IERC20(_config.quoteToken).balanceOf(address(this)) != beforeQuote
        ) revert InvalidAmounts();
        _emitGraduation(curve, vault, quote, base);
    }

    function _emitGraduation(PicklerBondingCurve curve, PicklerKuruPositionVault vault, uint256 quote, uint256 base)
        private
    {
        uint256 baseReserved = vault.baseReserved();
        uint256 quoteReserved = vault.quoteReserved();
        emit LaunchGraduatedKuru(
            address(curve.token()),
            address(curve),
            address(vault.market()),
            address(vault),
            vault.accountId(),
            venueConfigHash,
            quote,
            base,
            quoteReserved,
            baseReserved,
            quote - quoteReserved,
            base - baseReserved
        );
    }

    function _center(uint256 price, PicklerKuruPolicy.Config memory policy) private pure returns (uint32) {
        uint256 encoded = Math.mulDiv(price, policy.pricePrecision, 1e18);
        // Tick alignment must round down, not to an off-grid price.
        // forge-lint: disable-next-item(divide-before-multiply)
        uint256 aligned = (encoded / policy.tickSize) * policy.tickSize;
        uint256 represented = Math.mulDiv(aligned, 1e18, policy.pricePrecision);
        if (aligned == 0 || aligned > type(uint32).max || represented > price || price - represented > price / 10_000) {
            revert InvalidPrice();
        }
        return SafeCast.toUint32(aligned);
    }

    function _verifyMarket(IKuruOrderBook market, address token) private view {
        if (
            address(market).code.length == 0 || !router.verifiedSpotMarket(address(market))
                || market.accountCore() != address(accountCore) || market.baseToken() != token
                || market.quoteToken() != _config.quoteToken || market.pricePrecision() != _config.pricePrecision
                || market.sizePrecision() != _config.sizePrecision || market.tickSize() != _config.tickSize
                || market.passiveSpreadTicks() != _config.passiveSpreadTicks
                || market.minQuoteNotional() != _config.minQuoteNotional
                || market.maxQuoteNotional() != _config.maxQuoteNotional || market.takerFeePps() != _config.takerFeePps
                || market.makerFeePps() != _config.makerFeePps
        ) revert InvalidMarket();
    }
}
