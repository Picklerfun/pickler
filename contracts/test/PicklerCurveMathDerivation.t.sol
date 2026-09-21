// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {PicklerCurveMath} from "../src/libraries/PicklerCurveMath.sol";

contract PicklerCurveMathDerivationTest is Test {
    function test_deriveReserves_matchesTheClosedForm() public pure {
        // S = 800, L = 200 -> X0 = 800^2 / 600 = 1066 (floored).
        (uint256 x0,) = PicklerCurveMath.deriveReserves(800, 200, 1_000_000);

        assertEq(x0, 1066);
    }

    function test_deriveReserves_rejectsAnLpAllocationItCannotSatisfy() public {
        vm.expectRevert(PicklerCurveMath.InvalidAllocation.selector);

        this.exposedDeriveReserves(800, 800, 1_000_000);
    }

    /// The property the whole derivation exists for: at graduation the reserve per LP token
    /// equals the marginal price, so the pool opens where the curve closed. If this fails,
    /// graduation would hand the pool a price the last buyer never paid.
    function testFuzz_priceIsContinuousAtGraduation(uint256 saleAllocation, uint256 lpAllocation, uint256 targetReserve)
        public
        pure
    {
        saleAllocation = bound(saleAllocation, 1e18, 1e27);
        lpAllocation = bound(lpAllocation, saleAllocation / 100, saleAllocation - saleAllocation / 100);
        targetReserve = bound(targetReserve, 1e6, 1e24);

        (uint256 x0, uint256 q0) = PicklerCurveMath.deriveReserves(saleAllocation, lpAllocation, targetReserve);

        PicklerCurveMath.CurveConfig memory config = PicklerCurveMath.CurveConfig({
            virtualTokenReserve: x0, virtualQuoteReserve: q0, saleAllocation: saleAllocation
        });

        uint256 endReserve = PicklerCurveMath.quoteInForTokensOut(config, 0, saleAllocation);

        uint256 reservePerLpToken = (endReserve * 1e18) / lpAllocation;
        uint256 endPrice = PicklerCurveMath.marginalPrice(config, saleAllocation);

        assertApproxEqRel(reservePerLpToken, endPrice, 0.001e18);
    }

    /// The reserve the curve actually ends with must reach what product asked for.
    function testFuzz_targetReserveIsReached(uint256 saleAllocation, uint256 lpAllocation, uint256 targetReserve)
        public
        pure
    {
        saleAllocation = bound(saleAllocation, 1e18, 1e27);
        lpAllocation = bound(lpAllocation, saleAllocation / 100, saleAllocation - saleAllocation / 100);
        targetReserve = bound(targetReserve, 1e6, 1e24);

        (uint256 x0, uint256 q0) = PicklerCurveMath.deriveReserves(saleAllocation, lpAllocation, targetReserve);

        PicklerCurveMath.CurveConfig memory config = PicklerCurveMath.CurveConfig({
            virtualTokenReserve: x0, virtualQuoteReserve: q0, saleAllocation: saleAllocation
        });

        uint256 endReserve = PicklerCurveMath.quoteInForTokensOut(config, 0, saleAllocation);

        assertApproxEqRel(endReserve, targetReserve, 0.001e18);
    }

    function exposedDeriveReserves(uint256 saleAllocation, uint256 lpAllocation, uint256 targetReserve)
        external
        pure
        returns (uint256, uint256)
    {
        return PicklerCurveMath.deriveReserves(saleAllocation, lpAllocation, targetReserve);
    }
}
