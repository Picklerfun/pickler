// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

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

    /// @notice Tokens delivered for a net quote amount, after fees have already been deducted.
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

    function _invariant(CurveConfig memory config) private pure returns (uint256) {
        return config.virtualTokenReserve * config.virtualQuoteReserve;
    }

    function _ceilDiv(uint256 numerator, uint256 denominator) private pure returns (uint256) {
        return numerator == 0 ? 0 : (numerator - 1) / denominator + 1;
    }
}
