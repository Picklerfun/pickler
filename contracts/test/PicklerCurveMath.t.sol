// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {PicklerCurveMath} from "../src/libraries/PicklerCurveMath.sol";

contract PicklerCurveMathTest is Test {
    // A deliberately small, hand-checkable curve: X0 = 1000, Q0 = 1000, K = 1_000_000.
    function _config() internal pure returns (PicklerCurveMath.CurveConfig memory) {
        return PicklerCurveMath.CurveConfig({virtualTokenReserve: 1000, virtualQuoteReserve: 1000, saleAllocation: 500});
    }

    function test_tokensOutForQuoteIn_matchesHandComputedValue() public pure {
        // x = 1000, q = 1000, dQ = 1000 -> newX = ceil(1_000_000 / 2000) = 500, out = 500.
        uint256 tokensOut = PicklerCurveMath.tokensOutForQuoteIn(_config(), 0, 1000);

        assertEq(tokensOut, 500);
    }

    function test_tokensOutForQuoteIn_returnsZeroForDust() public pure {
        // dQ = 1 cannot move a curve this coarse; the trader gets nothing rather than a free token.
        uint256 tokensOut = PicklerCurveMath.tokensOutForQuoteIn(_config(), 0, 1);

        assertEq(tokensOut, 0);
    }

    function test_tokensOutForQuoteIn_accountsForTokensAlreadySold() public pure {
        // netSold = 250 -> x = 750, q = floor(1_000_000 / 750) = 1333.
        // newX = ceil(1_000_000 / 2333) = 429, out = 321.
        uint256 tokensOut = PicklerCurveMath.tokensOutForQuoteIn(_config(), 250, 1000);

        assertEq(tokensOut, 321);
    }
}
