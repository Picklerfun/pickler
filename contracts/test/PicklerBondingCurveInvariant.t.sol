// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {RecordingFeeEscrow} from "./mocks/RecordingFeeEscrow.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {PicklerBondingCurve} from "../src/PicklerBondingCurve.sol";
import {PicklerAgentToken} from "../src/PicklerAgentToken.sol";
import {PicklerPreset} from "../src/libraries/PicklerPreset.sol";
import {PicklerCurveMath} from "../src/libraries/PicklerCurveMath.sol";

/// Trades against a real curve — fees, transfers and all — in whatever order the fuzzer
/// picks, including donations and trades that revert.
///
/// The handler holds the funds and the tokens itself. The curve pulls quote from msg.sender,
/// so a handler that merely had allowances from other accounts would see every buy fail
/// silently through the try/catch below, and every invariant would hold vacuously.
contract CurveTrader {
    PicklerBondingCurve public immutable CURVE;
    MockERC20 public immutable QUOTE;
    PicklerAgentToken public immutable TOKEN;

    uint256 public immutable MAX_BUY;

    uint256 public buysFilled;
    uint256 public sellsFilled;

    constructor(PicklerBondingCurve curve_, MockERC20 quote_, PicklerAgentToken token_, uint256 maxBuy_) {
        CURVE = curve_;
        QUOTE = quote_;
        TOKEN = token_;
        MAX_BUY = maxBuy_;

        QUOTE.approve(address(CURVE), type(uint256).max);
        TOKEN.approve(address(CURVE), type(uint256).max);
    }

    function buy(uint256 amount) external {
        amount = _bound(amount, 1, MAX_BUY);

        if (QUOTE.balanceOf(address(this)) < amount) {
            return;
        }

        try CURVE.buyExactInput(amount, 0, address(this), block.timestamp + 1) {
            buysFilled++;
        } catch {
            return;
        }
    }

    function sell(uint256 amount) external {
        uint256 held = TOKEN.balanceOf(address(this));
        if (held == 0) {
            return;
        }

        amount = _bound(amount, 1, held);

        try CURVE.sellExactInput(amount, 0, address(this), block.timestamp + 1) {
            sellsFilled++;
        } catch {
            return;
        }
    }

    /// Anyone can send the curve money. It must never count as anyone's.
    function donate(uint256 amount) external {
        amount = _bound(amount, 1, 21_000_000e6);

        QUOTE.mint(address(CURVE), amount);
    }

    function remit() external {
        CURVE.remitFees();
    }

    function _bound(uint256 value, uint256 low, uint256 high) private pure returns (uint256) {
        if (high <= low) {
            return low;
        }

        return low + (value % (high - low + 1));
    }
}

contract PicklerBondingCurveInvariantTest is Test {
    uint256 internal constant SALE_ALLOCATION = 16_800_000e18;
    uint256 internal constant LP_ALLOCATION = 4_200_000e18;

    PicklerBondingCurve internal curve;
    PicklerAgentToken internal token;
    MockERC20 internal quote;
    CurveTrader internal trader;

    address internal feeEscrow;

    function setUp() public virtual {
        _setUp(21_000_000e6, 1);
    }

    function _setUp(uint256 targetReserve, uint32 precisionPolicy) internal {
        feeEscrow = address(new RecordingFeeEscrow());

        quote = new MockERC20("Quote", "QUOTE", 6);

        (uint256 x0, uint256 q0) = PicklerCurveMath.deriveReserves(SALE_ALLOCATION, LP_ALLOCATION, targetReserve);

        PicklerPreset.LaunchPreset memory preset = PicklerPreset.LaunchPreset({
            presetId: 1,
            version: 1,
            quoteToken: address(quote),
            totalSupply: SALE_ALLOCATION + LP_ALLOCATION,
            saleAllocation: SALE_ALLOCATION,
            lpAllocation: LP_ALLOCATION,
            virtualTokenReserve: x0,
            virtualQuoteReserve: q0,
            buyFeeBps: 100,
            sellFeeBps: 100,
            protocolShareBps: 5000,
            lpCreatorShareBps: 5000,
            lpFeeTier: 10000,
            lpTickSpacing: 200,
            launchFee: 0,
            roundingPolicyVersion: precisionPolicy
        });

        curve = new PicklerBondingCurve(preset, makeAddr("adapter"), feeEscrow);
        token = new PicklerAgentToken("Agent", "AGENT", SALE_ALLOCATION + LP_ALLOCATION, address(curve));
        curve.initialize(address(token));

        trader = new CurveTrader(curve, quote, token, precisionPolicy == 1 ? 4_200_000e6 : 1_000e6);
        quote.mint(address(trader), 315_000_000e6);

        targetContract(address(trader));
    }

    /// Guards against the suite passing because nothing happened: a handler whose every
    /// trade reverted into its try/catch would satisfy every invariant below.
    function afterInvariant() public view {
        assertGt(trader.buysFilled(), 0, "no buy ever filled; the invariants proved nothing");
        assertGt(trader.sellsFilled(), 0, "no sell ever filled; the invariants proved nothing");
    }

    /// The curve must always hold at least what it says it owes. If this breaks, either the
    /// reserve or the fees are promising the same unit twice.
    function invariant_theCurveHoldsWhatItClaimsToOwe() public view {
        assertGe(quote.balanceOf(address(curve)), curve.realQuoteReserve() + curve.accruedFees());
    }

    /// The LP allocation is not for sale. Whatever the sequence, it stays here until
    /// graduation takes it.
    function invariant_theLpAllocationIsNeverSold() public view {
        if (curve.phase() == PicklerBondingCurve.Phase.POOL_ACTIVE) {
            return;
        }

        assertGe(token.balanceOf(address(curve)), LP_ALLOCATION);
    }

    function invariant_theSaleAllocationIsNeverExceeded() public view {
        assertLe(curve.netSold(), SALE_ALLOCATION);
    }

    /// Fees only ever go to the escrow, so whatever left the curve as fees has to be there.
    function invariant_remittedFeesAreAllAtTheEscrow() public view {
        assertLe(curve.accruedFees(), quote.balanceOf(address(curve)));
    }
}

/// Identical inventory/solvency invariants at the approved reference scale.
contract PicklerReferenceCurveInvariantTest is PicklerBondingCurveInvariantTest {
    function setUp() public override {
        _setUp(32_000e6, 2);
    }
}
