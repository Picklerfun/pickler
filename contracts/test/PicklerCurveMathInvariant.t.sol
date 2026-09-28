// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {PicklerCurveMath} from "../src/libraries/PicklerCurveMath.sol";

/// Replays a sequence of buys and sells and tracks what the curve took in against what it
/// paid out. Fees are deliberately absent: a fee would mask a rounding leak by covering it.
contract CurveHandler {
    PicklerCurveMath.CurveConfig public config;

    uint256 public netSold;
    uint256 public quoteTakenIn;
    uint256 public quotePaidOut;

    constructor() {
        (uint256 x0, uint256 q0) = PicklerCurveMath.deriveReserves(800e18, 200e18, 1_000e6);

        config =
            PicklerCurveMath.CurveConfig({virtualTokenReserve: x0, virtualQuoteReserve: q0, saleAllocation: 800e18});
    }

    function buy(uint256 quoteNetIn) external {
        quoteNetIn = _bound(quoteNetIn, 1, 100e6);

        uint256 tokensOut = PicklerCurveMath.tokensOutForQuoteIn(config, netSold, quoteNetIn);
        if (tokensOut > PicklerCurveMath.remainingTokens(config, netSold)) {
            return;
        }

        netSold += tokensOut;
        quoteTakenIn += quoteNetIn;
    }

    function sell(uint256 tokensIn) external {
        tokensIn = _bound(tokensIn, 0, netSold);
        if (tokensIn == 0) {
            return;
        }

        uint256 quoteOut = PicklerCurveMath.quoteOutForTokensIn(config, netSold, tokensIn);

        netSold -= tokensIn;
        quotePaidOut += quoteOut;
    }

    function _bound(uint256 value, uint256 low, uint256 high) private pure returns (uint256) {
        if (high <= low) {
            return low;
        }

        return low + (value % (high - low + 1));
    }
}

contract PicklerCurveMathInvariantTest is Test {
    CurveHandler internal handler;

    function setUp() public {
        handler = new CurveHandler();

        targetContract(address(handler));
    }

    /// Rounding must never let traders extract more quote than they put in. If this breaks,
    /// the curve funds the leak out of the reserve that belongs to the remaining holders.
    function invariant_curveNeverPaysOutMoreThanItTookIn() public view {
        assertLe(handler.quotePaidOut(), handler.quoteTakenIn());
    }

    /// The curve can never sell more than its allocation, however the sequence is ordered.
    function invariant_netSoldNeverExceedsTheSaleAllocation() public view {
        (,, uint256 saleAllocation) = handler.config();

        assertLe(handler.netSold(), saleAllocation);
    }
}
