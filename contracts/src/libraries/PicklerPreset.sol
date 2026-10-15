// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {PicklerCurveMath} from "./PicklerCurveMath.sol";

/// @title Pickler launch preset
/// @notice The economic configuration a launch is fixed to, and the rules it must satisfy.
/// @dev The numbers in a preset are product's to choose; whether a given set of numbers is
///      coherent is not. `validate` is the gate between the two: it refuses a configuration
///      whose allocations do not sum, whose reserves do not match its allocations, or whose
///      resulting price is finer than the arithmetic can represent.
///
///      A launch stores `configHash`, so a preset republished with any field altered is a
///      different preset and cannot be substituted for one a buyer already committed to.
library PicklerPreset {
    struct LaunchPreset {
        uint32 presetId;
        uint32 version;
        address quoteToken;
        uint256 totalSupply;
        uint256 saleAllocation;
        uint256 lpAllocation;
        uint256 virtualTokenReserve;
        uint256 virtualQuoteReserve;
        uint16 buyFeeBps;
        uint16 sellFeeBps;
        uint16 protocolShareBps;
        uint16 lpCreatorShareBps;
        uint24 lpFeeTier;
        int24 lpTickSpacing;
        uint256 launchFee;
        uint32 roundingPolicyVersion;
    }

    error UnsupportedPrecisionPolicy();
    error InvalidReferenceProfile();
    error InvalidQuoteDecimals();
    error InvalidTotalSupply();
    error AllocationsDoNotSumToSupply();
    error ReservesDoNotMatchAllocations();
    error EndPriceBelowPrecisionFloor();
    error FeeOutOfRange();
    error InvalidQuoteToken();

    uint256 internal constant TOTAL_SUPPLY = 21_000_000e18;

    uint16 internal constant BPS_SCALE = 10_000;

    /// @notice The most a trade fee may be. Well under the scale: a fee approaching it would
    ///         make the curve untradeable, which is a misconfiguration rather than a policy.
    uint16 internal constant MAX_TRADE_FEE_BPS = 500;

    /// @notice Refuses a preset that cannot be honoured, before anything is deployed against it.
    function validate(LaunchPreset memory preset) internal pure {
        if (preset.roundingPolicyVersion != 1 && preset.roundingPolicyVersion != 2) {
            revert UnsupportedPrecisionPolicy();
        }

        if (preset.quoteToken == address(0)) {
            revert InvalidQuoteToken();
        }

        if (preset.buyFeeBps > MAX_TRADE_FEE_BPS || preset.sellFeeBps > MAX_TRADE_FEE_BPS) {
            revert FeeOutOfRange();
        }

        if (preset.protocolShareBps > BPS_SCALE || preset.lpCreatorShareBps > BPS_SCALE) {
            revert FeeOutOfRange();
        }

        if (preset.totalSupply != TOTAL_SUPPLY) {
            revert InvalidTotalSupply();
        }

        if (preset.totalSupply != preset.saleAllocation + preset.lpAllocation) {
            revert AllocationsDoNotSumToSupply();
        }

        // deriveReserves rejects an LP allocation that is zero or not smaller than the sale
        // allocation, so those cases never reach the comparison below.
        (uint256 expectedTokenReserve,) =
            PicklerCurveMath.deriveReserves(preset.saleAllocation, preset.lpAllocation, _impliedTargetReserve(preset));

        if (expectedTokenReserve != preset.virtualTokenReserve) {
            revert ReservesDoNotMatchAllocations();
        }

        PicklerCurveMath.CurveConfig memory config = PicklerCurveMath.CurveConfig({
            virtualTokenReserve: preset.virtualTokenReserve,
            virtualQuoteReserve: preset.virtualQuoteReserve,
            saleAllocation: preset.saleAllocation
        });

        if (preset.roundingPolicyVersion == 2) {
            _validateReferenceProfile(preset, config);
            return;
        }

        if (
            PicklerCurveMath.marginalPrice(config, preset.saleAllocation) < PicklerCurveMath.MIN_REPRESENTABLE_END_PRICE
        ) {
            revert EndPriceBelowPrecisionFloor();
        }
    }

    /// @notice Metadata is checked at factory admission and direct curve construction.
    /// @dev Version 1 retains its historical pure admission. Version 2 supports six-decimal
    ///      quote assets only; the server selects the reviewed AUSD identity for its network.
    function validateQuoteDecimals(LaunchPreset memory preset) internal view {
        if (preset.roundingPolicyVersion != 2) {
            return;
        }

        if (preset.quoteToken.code.length == 0) {
            revert InvalidQuoteDecimals();
        }

        try IERC20Metadata(preset.quoteToken).decimals() returns (uint8 decimals) {
            if (decimals != 6) {
                revert InvalidQuoteDecimals();
            }
        } catch {
            revert InvalidQuoteDecimals();
        }
    }

    function _validateReferenceProfile(LaunchPreset memory preset, PicklerCurveMath.CurveConfig memory config)
        private
        pure
    {
        (uint256 x0, uint256 q0) = PicklerCurveMath.deriveReserves(16_800_000e18, 4_200_000e18, 32_000e6);
        if (
            preset.saleAllocation != 16_800_000e18 || preset.lpAllocation != 4_200_000e18
                || preset.virtualTokenReserve != x0 || preset.virtualQuoteReserve != q0 || preset.buyFeeBps != 100
                || preset.sellFeeBps != 100 || preset.protocolShareBps != 5000 || preset.launchFee != 0
        ) {
            revert InvalidReferenceProfile();
        }

        // A normalized price below 1e6 WAD loses more than one part per million to flooring.
        // Preserve a meaningful precision gate instead of removing the legacy one.
        if (PicklerCurveMath.marginalPriceWad(config, 0, 6) < 1e6) {
            revert EndPriceBelowPrecisionFloor();
        }
    }

    /// @notice Commitment to every field of a preset.
    /// @dev Hashing the encoded struct rather than a field list means adding a field cannot
    ///      silently leave it uncommitted.
    function configHash(LaunchPreset memory preset) internal pure returns (bytes32) {
        // forge-lint: disable-next-line(asm-keccak256)
        return keccak256(abi.encode(preset));
    }

    /// @dev The target reserve the preset's quote reserve implies, inverting
    ///      `Q0 = R * (X0 - S) / S` so validation can re-derive and compare.
    function _impliedTargetReserve(LaunchPreset memory preset) private pure returns (uint256) {
        if (preset.virtualTokenReserve <= preset.saleAllocation) {
            revert ReservesDoNotMatchAllocations();
        }

        return
            (preset.virtualQuoteReserve * preset.saleAllocation) / (preset.virtualTokenReserve - preset.saleAllocation);
    }
}
