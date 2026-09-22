// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

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

    error AllocationsDoNotSumToSupply();
    error ReservesDoNotMatchAllocations();
    error EndPriceBelowPrecisionFloor();
    error FeeOutOfRange();
    error InvalidQuoteToken();

    uint16 internal constant BPS_SCALE = 10_000;

    /// @notice The most a trade fee may be. Well under the scale: a fee approaching it would
    ///         make the curve untradeable, which is a misconfiguration rather than a policy.
    uint16 internal constant MAX_TRADE_FEE_BPS = 500;

    /// @notice Refuses a preset that cannot be honoured, before anything is deployed against it.
    function validate(LaunchPreset memory preset) internal pure {
        if (preset.quoteToken == address(0)) {
            revert InvalidQuoteToken();
        }

        if (preset.buyFeeBps > MAX_TRADE_FEE_BPS || preset.sellFeeBps > MAX_TRADE_FEE_BPS) {
            revert FeeOutOfRange();
        }

        if (preset.protocolShareBps > BPS_SCALE || preset.lpCreatorShareBps > BPS_SCALE) {
            revert FeeOutOfRange();
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

        if (
            PicklerCurveMath.marginalPrice(config, preset.saleAllocation) < PicklerCurveMath.MIN_REPRESENTABLE_END_PRICE
        ) {
            revert EndPriceBelowPrecisionFloor();
        }
    }

    /// @notice Commitment to every field of a preset.
    /// @dev Hashing the encoded struct rather than a field list means adding a field cannot
    ///      silently leave it uncommitted.
    function configHash(LaunchPreset memory preset) internal pure returns (bytes32) {
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
