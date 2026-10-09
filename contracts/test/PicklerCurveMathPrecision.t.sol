// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {PicklerCurveMath} from "../src/libraries/PicklerCurveMath.sol";

/// Preserves the legacy precision floor and verifies the normalized policy-2 arithmetic.
///
/// A 1e18-scaled price cannot represent an arbitrarily cheap token. Pair a very large supply
/// with a very small quote reserve and the marginal price truncates toward zero, at which
/// point every ratio computed from it is noise. This is a property of fixed-point arithmetic,
/// not a bug to fix in the library — but a preset that lands there must be rejected before it
/// is ever deployed, which is why the boundary is pinned down here.
contract PicklerCurveMathPrecisionTest is Test {
    /// The normalized numerator exceeds uint256, while the final WAD price fits.
    function test_normalizedPriceUsesAFullPrecisionIntermediate() public pure {
        PicklerCurveMath.CurveConfig memory config = PicklerCurveMath.CurveConfig(1e27, 1e24, 5e26);
        assertEq(PicklerCurveMath.marginalPriceWad(config, 0, 6), 1e27);
        assertEq(PicklerCurveMath.marginalPriceWad(config, 5e26, 6), 4e27);
    }

    function normalizedPrice(PicklerCurveMath.CurveConfig memory config, uint256 sold, uint8 decimals)
        external
        pure
        returns (uint256)
    {
        return PicklerCurveMath.marginalPriceWad(config, sold, decimals);
    }

    function test_normalizedPriceRejectsUnknownDecimalsAndSaleOverflow() public {
        PicklerCurveMath.CurveConfig memory config = PicklerCurveMath.CurveConfig(1e27, 1e24, 5e26);
        vm.expectRevert(PicklerCurveMath.InvalidAllocation.selector);
        this.normalizedPrice(config, 0, 19);
        vm.expectRevert(PicklerCurveMath.InvalidAllocation.selector);
        this.normalizedPrice(config, 5e26 + 1, 6);
    }

    function _configFor(uint256 saleAllocation, uint256 lpAllocation, uint256 targetReserve)
        internal
        pure
        returns (PicklerCurveMath.CurveConfig memory)
    {
        (uint256 x0, uint256 q0) = PicklerCurveMath.deriveReserves(saleAllocation, lpAllocation, targetReserve);

        return PicklerCurveMath.CurveConfig({
            virtualTokenReserve: x0, virtualQuoteReserve: q0, saleAllocation: saleAllocation
        });
    }

    /// The corner the fuzzer found: 1e27 token units sold for 100 AUSD, with 99% of the sale
    /// reserved for liquidity. The true end price is far below 1e-18 quote units per token
    /// unit, so the scaled price collapses and continuity cannot be checked at all.
    function test_marginalPriceCollapsesWhenTheTokenIsCheaperThanTheScale() public pure {
        uint256 saleAllocation = 1e27;
        uint256 lpAllocation = 99e25;
        uint256 targetReserve = 100e6;

        PicklerCurveMath.CurveConfig memory config = _configFor(saleAllocation, lpAllocation, targetReserve);

        uint256 endPrice = PicklerCurveMath.marginalPrice(config, saleAllocation);

        assertLt(endPrice, 1e6, "expected the scaled price to have collapsed");
    }

    /// The same shape with a reserve large enough to price the supply stays representable.
    function test_marginalPriceSurvivesWhenTheReserveMatchesTheSupply() public pure {
        uint256 saleAllocation = 1e27;
        uint256 lpAllocation = 99e25;
        uint256 targetReserve = 1e18;

        PicklerCurveMath.CurveConfig memory config = _configFor(saleAllocation, lpAllocation, targetReserve);

        uint256 endPrice = PicklerCurveMath.marginalPrice(config, saleAllocation);

        assertGe(endPrice, PicklerCurveMath.MIN_REPRESENTABLE_END_PRICE);
    }

    /// Continuity holds wherever the price is representable. This is the same property as in
    /// PicklerCurveMathDerivation, restated over the domain a preset is allowed to occupy.
    function testFuzz_continuityHoldsAboveThePrecisionFloor(
        uint256 saleAllocation,
        uint256 lpAllocation,
        uint256 targetReserve
    ) public pure {
        saleAllocation = bound(saleAllocation, 1e18, 1e27);
        lpAllocation = bound(lpAllocation, saleAllocation / 100, saleAllocation - saleAllocation / 100);
        targetReserve = bound(targetReserve, 1e6, 1e24);

        PicklerCurveMath.CurveConfig memory config = _configFor(saleAllocation, lpAllocation, targetReserve);

        uint256 endPrice = PicklerCurveMath.marginalPrice(config, saleAllocation);
        vm.assume(endPrice >= PicklerCurveMath.MIN_REPRESENTABLE_END_PRICE);

        uint256 endReserve = PicklerCurveMath.quoteInForTokensOut(config, 0, saleAllocation);
        uint256 reservePerLpToken = (endReserve * 1e18) / lpAllocation;

        assertApproxEqRel(reservePerLpToken, endPrice, 0.001e18);
    }
}
