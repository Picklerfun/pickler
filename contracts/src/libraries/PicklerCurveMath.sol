// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title Pickler curve arithmetic
/// @notice Constant product over virtual reserves. The only place curve maths exists on chain.
/// @dev Rounding is directional and uniform: the quote reserve is floored and any term
///      subtracted from a reserve is ceilinged, so every rounding error favours the curve.
///      Virtual reserves are never withdrawable; they only shape the price.
library PicklerCurveMath {
    struct CurveConfig {
        uint256 virtualTokenReserve;
        uint256 virtualQuoteReserve;
        uint256 saleAllocation;
    }

    error SaleAllocationExceeded(uint256 requested, uint256 remaining);
    error InvalidAllocation();

    /// @notice Floor below which a 1e18-scaled price stops carrying usable precision.
    /// @dev Pair a very large supply with a very small quote reserve and the true price falls
    ///      below what 1e18 scaling can represent, so `marginalPrice` truncates toward zero
    ///      and every ratio derived from it is noise. The library does not enforce this —
    ///      it is a property of the chosen preset, not of an individual trade — but preset
    ///      validation must reject a configuration whose end price lands under it.
    ///      See test/PicklerCurveMathPrecision.t.sol for both sides of the boundary.
    uint256 internal constant MIN_REPRESENTABLE_END_PRICE = 1e6;

    /// @notice Derives the virtual reserves from the three numbers product chooses.
    /// @dev X0 = S^2 / (S - L) and Q0 = R_end * (X0 - S) / S. Both follow from requiring
    ///      R_end / L == p_end, so the pool opens at the price the curve closed at. Neither
    ///      number is a policy choice: fix the sale allocation, the LP allocation and the
    ///      target reserve, and the curve that joins them continuously is determined.
    function deriveReserves(uint256 saleAllocation, uint256 lpAllocation, uint256 targetReserve)
        internal
        pure
        returns (uint256 virtualTokenReserve, uint256 virtualQuoteReserve)
    {
        if (lpAllocation == 0 || lpAllocation >= saleAllocation || targetReserve == 0) {
            revert InvalidAllocation();
        }

        virtualTokenReserve = (saleAllocation * saleAllocation) / (saleAllocation - lpAllocation);
        virtualQuoteReserve = (targetReserve * (virtualTokenReserve - saleAllocation)) / saleAllocation;

        if (virtualQuoteReserve == 0) {
            revert InvalidAllocation();
        }
    }

    /// @notice Marginal price in quote units per token, scaled by 1e18.
    /// @dev Multiplies before dividing so the scaling factor is not eaten by the first
    ///      division. Overflow is left to Solidity's checked arithmetic: a configuration
    ///      large enough to overflow `k * 1e18` reverts rather than reporting a wrong price.
    function marginalPrice(CurveConfig memory config, uint256 netSold) internal pure returns (uint256) {
        uint256 k = _invariant(config);
        uint256 x = config.virtualTokenReserve - netSold;

        return (k * 1e18) / x / x;
    }

    /// @notice Whole quote asset per whole 18-decimal token, scaled by 1e18.
    /// @dev Normalize before division, never after a truncated legacy price. mulDiv uses
    ///      a 512-bit intermediate. Checked x*x rejects unsupported reserve ranges.
    function marginalPriceWad(CurveConfig memory config, uint256 netSold, uint8 quoteDecimals)
        internal
        pure
        returns (uint256)
    {
        if (quoteDecimals > 18 || netSold > config.saleAllocation) {
            revert InvalidAllocation();
        }

        uint256 x = config.virtualTokenReserve - netSold;
        return Math.mulDiv(_invariant(config), 10 ** (36 - quoteDecimals), x * x);
    }

    /// @notice Tokens delivered for a net quote amount, after fees have already been deducted.
    /// @dev The result is NOT capped to the remaining inventory; near the end of the curve it
    ///      can exceed it. The caller must compare against `remainingTokens` and revert, then
    ///      offer `quoteInForTokensOut` for the remainder. Clamping here instead would silently
    ///      sell the last tokens at a price the curve never quoted.
    function tokensOutForQuoteIn(CurveConfig memory config, uint256 netSold, uint256 quoteNetIn)
        internal
        pure
        returns (uint256 tokensOut)
    {
        if (quoteNetIn == 0) {
            return 0;
        }

        uint256 k = _invariant(config);
        uint256 x = config.virtualTokenReserve - netSold;
        uint256 q = k / x;

        uint256 newX = _ceilDiv(k, q + quoteNetIn);

        return newX >= x ? 0 : x - newX;
    }

    /// @notice Gross quote returned for tokens sold back, before the sell fee is deducted.
    function quoteOutForTokensIn(CurveConfig memory config, uint256 netSold, uint256 tokensIn)
        internal
        pure
        returns (uint256 quoteGrossOut)
    {
        if (tokensIn == 0) {
            return 0;
        }

        uint256 k = _invariant(config);
        uint256 x = config.virtualTokenReserve - netSold;
        uint256 q = k / x;

        uint256 newQ = _ceilDiv(k, x + tokensIn);

        return newQ >= q ? 0 : q - newQ;
    }

    /// @notice Net quote required to receive an exact number of tokens.
    /// @dev This is how the last buyer consumes the remainder without the curve having to
    ///      invent a price for a partial fill.
    function quoteInForTokensOut(CurveConfig memory config, uint256 netSold, uint256 tokensOut)
        internal
        pure
        returns (uint256 quoteNetIn)
    {
        if (tokensOut == 0) {
            return 0;
        }

        uint256 remaining = remainingTokens(config, netSold);
        if (tokensOut > remaining) {
            revert SaleAllocationExceeded(tokensOut, remaining);
        }

        uint256 k = _invariant(config);
        uint256 x = config.virtualTokenReserve - netSold;
        uint256 q = k / x;

        uint256 newQ = _ceilDiv(k, x - tokensOut);

        return newQ <= q ? 1 : newQ - q;
    }

    /// @notice Tokens still available on the curve.
    function remainingTokens(CurveConfig memory config, uint256 netSold) internal pure returns (uint256) {
        return config.saleAllocation - netSold;
    }

    function _invariant(CurveConfig memory config) private pure returns (uint256) {
        return config.virtualTokenReserve * config.virtualQuoteReserve;
    }

    function _ceilDiv(uint256 numerator, uint256 denominator) private pure returns (uint256) {
        return numerator == 0 ? 0 : (numerator - 1) / denominator + 1;
    }
}
