// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {RecordingFeeEscrow} from "./mocks/RecordingFeeEscrow.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {PicklerBondingCurve} from "../src/PicklerBondingCurve.sol";
import {PicklerAgentToken} from "../src/PicklerAgentToken.sol";
import {PicklerPreset} from "../src/libraries/PicklerPreset.sol";
import {PicklerCurveMath} from "../src/libraries/PicklerCurveMath.sol";

/// A quote asset that keeps a cut of every transfer. The curve's accounting assumes what it
/// is sent is what arrives, so it has to refuse this rather than silently under-credit.
contract FeeOnTransferToken is MockERC20 {
    constructor() MockERC20("Fee On Transfer", "FOT", 6) {}

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 delivered = amount - (amount / 100);

        super.transferFrom(from, address(this), amount - delivered);

        return super.transferFrom(from, to, delivered);
    }
}

contract PicklerBondingCurveTest is Test {
    uint256 internal constant SALE_ALLOCATION = 16_800_000e18;
    uint256 internal constant LP_ALLOCATION = 4_200_000e18;
    uint256 internal constant TARGET_RESERVE = 21_000_000e6;
    uint16 internal constant BUY_FEE_BPS = 100;
    uint16 internal constant SELL_FEE_BPS = 100;

    PicklerBondingCurve internal curve;
    PicklerAgentToken internal token;
    MockERC20 internal quote;

    address internal adapter = makeAddr("adapter");
    address internal feeEscrow;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        feeEscrow = address(new RecordingFeeEscrow());

        quote = new MockERC20("Quote", "QUOTE", 6);

        curve = new PicklerBondingCurve(_preset(address(quote)), adapter, feeEscrow);
        token = new PicklerAgentToken("Pickler Agent", "AGENT", SALE_ALLOCATION + LP_ALLOCATION, address(curve));

        curve.initialize(address(token));

        quote.mint(alice, 210_000_000e6);
        quote.mint(bob, 210_000_000e6);

        vm.prank(alice);
        quote.approve(address(curve), type(uint256).max);
        vm.prank(bob);
        quote.approve(address(curve), type(uint256).max);
    }

    function _preset(address quoteToken) internal pure returns (PicklerPreset.LaunchPreset memory preset) {
        (uint256 x0, uint256 q0) = PicklerCurveMath.deriveReserves(SALE_ALLOCATION, LP_ALLOCATION, TARGET_RESERVE);

        preset = PicklerPreset.LaunchPreset({
            presetId: 1,
            version: 1,
            quoteToken: quoteToken,
            totalSupply: SALE_ALLOCATION + LP_ALLOCATION,
            saleAllocation: SALE_ALLOCATION,
            lpAllocation: LP_ALLOCATION,
            virtualTokenReserve: x0,
            virtualQuoteReserve: q0,
            buyFeeBps: BUY_FEE_BPS,
            sellFeeBps: SELL_FEE_BPS,
            protocolShareBps: 5000,
            lpCreatorShareBps: 5000,
            lpFeeTier: 10000,
            lpTickSpacing: 200,
            launchFee: 0,
            roundingPolicyVersion: 1
        });
    }

    function _deadline() internal view returns (uint256) {
        return block.timestamp + 1 hours;
    }

    // --- buying -----------------------------------------------------------------------

    function test_buyingDeliversTokensAndCreditsTheReserveNetOfFees() public {
        vm.prank(alice);
        uint256 tokensOut = curve.buyExactInput(2_100_000e6, 0, alice, _deadline());

        assertGt(tokensOut, 0, "no tokens delivered");
        assertEq(token.balanceOf(alice), tokensOut);

        uint256 expectedFee = (uint256(2_100_000e6) * BUY_FEE_BPS) / 10_000;

        assertEq(curve.accruedFees(), expectedFee, "fee not accrued");
        assertEq(curve.realQuoteReserve(), 2_100_000e6 - expectedFee, "reserve did not take the net");
    }

    /// No unit of the quote asset may be counted as both reserve and fee, and the contract
    /// must always hold at least what those two claim.
    function test_theReserveAndTheFeesNeverOverlapWhatTheContractHolds() public {
        vm.prank(alice);
        curve.buyExactInput(10_500_000e6, 0, alice, _deadline());

        vm.prank(bob);
        curve.buyExactInput(5_250_000e6, 0, bob, _deadline());

        vm.prank(alice);
        token.approve(address(curve), type(uint256).max);

        // Read the balance before the prank: an external call in the argument list would
        // consume it, and the sale would come from the test contract instead of from alice.
        uint256 half = token.balanceOf(alice) / 2;

        vm.prank(alice);
        curve.sellExactInput(half, 0, alice, _deadline());

        assertGe(
            quote.balanceOf(address(curve)),
            curve.realQuoteReserve() + curve.accruedFees(),
            "the curve owes more than it holds"
        );
    }

    function test_buyingRespectsMinimumTokensOut() public {
        vm.prank(alice);
        uint256 expected = curve.quoteBuy(2_100_000e6);

        vm.prank(alice);
        vm.expectRevert(PicklerBondingCurve.SlippageExceeded.selector);
        curve.buyExactInput(2_100_000e6, expected + 1, alice, _deadline());
    }

    function test_anExpiredDeadlineIsRejected() public {
        vm.prank(alice);
        vm.expectRevert(PicklerBondingCurve.DeadlinePassed.selector);
        curve.buyExactInput(2_100_000e6, 0, alice, block.timestamp - 1);
    }

    function test_theBuyerMayDeliverToSomeoneElse() public {
        vm.prank(alice);
        uint256 tokensOut = curve.buyExactInput(2_100_000e6, 0, bob, _deadline());

        assertEq(token.balanceOf(bob), tokensOut, "recipient did not receive the tokens");
        assertEq(token.balanceOf(alice), 0, "payer received tokens meant for the recipient");
    }

    // --- selling ----------------------------------------------------------------------

    function test_sellingReturnsQuoteNetOfFeesAndShrinksTheReserve() public {
        vm.prank(alice);
        uint256 bought = curve.buyExactInput(10_500_000e6, 0, alice, _deadline());

        vm.prank(alice);
        token.approve(address(curve), type(uint256).max);

        uint256 reserveBefore = curve.realQuoteReserve();
        uint256 balanceBefore = quote.balanceOf(alice);

        vm.prank(alice);
        uint256 received = curve.sellExactInput(bought, 0, alice, _deadline());

        assertEq(quote.balanceOf(alice) - balanceBefore, received, "seller received a different amount");
        assertLt(curve.realQuoteReserve(), reserveBefore, "reserve did not shrink");
    }

    /// Round-tripping must never be profitable, or the curve funds the difference out of
    /// the reserve that belongs to everyone still holding.
    function test_aRoundTripCannotProfit() public {
        uint256 spent = 10_500_000e6;

        vm.prank(alice);
        uint256 bought = curve.buyExactInput(spent, 0, alice, _deadline());

        vm.prank(alice);
        token.approve(address(curve), type(uint256).max);

        vm.prank(alice);
        uint256 returned = curve.sellExactInput(bought, 0, alice, _deadline());

        assertLe(returned, spent, "a round trip returned more than it cost");
    }

    // --- the end of the curve ---------------------------------------------------------

    function test_aBuyLargerThanTheRemainingInventoryReverts() public {
        vm.prank(alice);
        vm.expectRevert(PicklerBondingCurve.ExceedsRemainingSupply.selector);
        curve.buyExactInput(105_000_000e6, 0, alice, _deadline());
    }

    /// The alternative the quote offers when exact-input would overshoot: name the tokens,
    /// pay only what they cost.
    function test_theRemainderIsBoughtWithExactOutputAndOnlyWhatItCostsIsCharged() public {
        vm.prank(alice);
        curve.buyExactInput(18_900_000e6, 0, alice, _deadline());

        uint256 remaining = curve.remainingTokens();
        assertGt(remaining, 0, "nothing left to buy");

        uint256 required = curve.quoteBuyExactOutput(remaining);
        uint256 balanceBefore = quote.balanceOf(bob);

        vm.prank(bob);
        uint256 spent = curve.buyExactOutput(remaining, required * 2, bob, _deadline());

        assertEq(spent, required, "charged something other than the quoted cost");
        assertEq(balanceBefore - quote.balanceOf(bob), required, "took more than it charged");
        assertEq(token.balanceOf(bob), remaining, "did not deliver the remainder");
    }

    function test_exactOutputRespectsItsMaximum() public {
        uint256 wanted = 10e18;
        uint256 required = curve.quoteBuyExactOutput(wanted);

        vm.prank(alice);
        vm.expectRevert(PicklerBondingCurve.SlippageExceeded.selector);
        curve.buyExactOutput(wanted, required - 1, alice, _deadline());
    }

    function test_exhaustingTheInventoryMarksTheCurveReadyAndStopsTrading() public {
        _exhaust();

        assertEq(uint8(curve.phase()), uint8(PicklerBondingCurve.Phase.READY_TO_GRADUATE), "phase did not advance");

        vm.prank(alice);
        vm.expectRevert(PicklerBondingCurve.CurveClosed.selector);
        curve.buyExactInput(21_000e6, 0, alice, _deadline());

        vm.prank(bob);
        token.approve(address(curve), type(uint256).max);
        vm.prank(bob);
        vm.expectRevert(PicklerBondingCurve.CurveClosed.selector);
        curve.sellExactInput(1e18, 0, bob, _deadline());
    }

    /// Reaching READY must not move any money. Graduation is a separate, atomic step.
    function test_becomingReadyDoesNotMoveTheReserve() public {
        _exhaust();

        assertEq(
            quote.balanceOf(address(curve)),
            curve.realQuoteReserve() + curve.accruedFees(),
            "funds left the curve when it became ready"
        );
        assertEq(token.balanceOf(address(curve)), LP_ALLOCATION, "the LP allocation is not still here");
    }

    /// A competing buy can consume the remainder first; the loser reverts rather than being
    /// filled at a price it did not agree to.
    function test_aCompetingBuyMakesTheOtherRevert() public {
        vm.prank(alice);
        curve.buyExactInput(18_900_000e6, 0, alice, _deadline());

        uint256 remaining = curve.remainingTokens();
        uint256 required = curve.quoteBuyExactOutput(remaining);

        vm.prank(bob);
        curve.buyExactOutput(remaining, required * 2, bob, _deadline());

        vm.prank(alice);
        vm.expectRevert(PicklerBondingCurve.CurveClosed.selector);
        curve.buyExactOutput(remaining, required * 2, alice, _deadline());
    }

    // --- graduation handoff -----------------------------------------------------------

    function test_onlyTheAdapterMayTakeTheFundsAndOnlyWhenReady() public {
        vm.prank(adapter);
        vm.expectRevert(PicklerBondingCurve.NotReady.selector);
        curve.releaseForGraduation();

        _exhaust();

        vm.prank(alice);
        vm.expectRevert(PicklerBondingCurve.NotAdapter.selector);
        curve.releaseForGraduation();
    }

    function test_graduationHandsOverExactlyTheReserveAndTheLpAllocation() public {
        _exhaust();

        uint256 reserve = curve.realQuoteReserve();
        uint256 fees = curve.accruedFees();

        vm.prank(adapter);
        (uint256 quoteReleased, uint256 tokensReleased) = curve.releaseForGraduation();

        assertEq(quoteReleased, reserve, "released a different reserve");
        assertEq(tokensReleased, LP_ALLOCATION, "released a different LP allocation");
        assertEq(quote.balanceOf(adapter), reserve);
        assertEq(token.balanceOf(adapter), LP_ALLOCATION);

        // Fees are not part of the reserve and must stay behind for the escrow.
        assertEq(quote.balanceOf(address(curve)), fees, "fees left with the graduation");
        assertEq(uint8(curve.phase()), uint8(PicklerBondingCurve.Phase.POOL_ACTIVE));
    }

    function test_graduationHappensOnlyOnce() public {
        _exhaust();

        vm.prank(adapter);
        curve.releaseForGraduation();

        vm.prank(adapter);
        vm.expectRevert(PicklerBondingCurve.NotReady.selector);
        curve.releaseForGraduation();
    }

    // --- fees -------------------------------------------------------------------------

    function test_feesGoToTheEscrowAndNowhereElse() public {
        vm.prank(alice);
        curve.buyExactInput(2_100_000e6, 0, alice, _deadline());

        uint256 accrued = curve.accruedFees();
        assertGt(accrued, 0);

        curve.remitFees();

        assertEq(quote.balanceOf(feeEscrow), accrued, "escrow did not receive the fees");
        assertEq(curve.accruedFees(), 0, "fees still accrued after remittance");
        assertEq(curve.realQuoteReserve(), 2_100_000e6 - accrued, "remitting fees touched the reserve");
    }

    // --- hostile inputs ---------------------------------------------------------------

    /// A donation is not a purchase. It must not move the price or advance the phase.
    function test_aDirectDonationChangesNothing() public {
        vm.prank(alice);
        curve.buyExactInput(2_100_000e6, 0, alice, _deadline());

        uint256 priceBefore = curve.quoteBuy(210_000e6);
        uint256 reserveBefore = curve.realQuoteReserve();

        quote.mint(address(curve), 105_000_000e6);

        assertEq(curve.quoteBuy(210_000e6), priceBefore, "a donation moved the price");
        assertEq(curve.realQuoteReserve(), reserveBefore, "a donation was counted as reserve");
        assertEq(uint8(curve.phase()), uint8(PicklerBondingCurve.Phase.CURVE_ACTIVE));
    }

    function test_aQuoteAssetThatKeepsACutIsRefused() public {
        FeeOnTransferToken hostile = new FeeOnTransferToken();

        PicklerBondingCurve hostileCurve = new PicklerBondingCurve(_preset(address(hostile)), adapter, feeEscrow);
        PicklerAgentToken hostileToken =
            new PicklerAgentToken("Agent", "AGENT", SALE_ALLOCATION + LP_ALLOCATION, address(hostileCurve));
        hostileCurve.initialize(address(hostileToken));

        hostile.mint(alice, 21_000_000e6);
        vm.prank(alice);
        hostile.approve(address(hostileCurve), type(uint256).max);

        vm.prank(alice);
        vm.expectRevert(PicklerBondingCurve.UnexpectedQuoteAmount.selector);
        hostileCurve.buyExactInput(2_100_000e6, 0, alice, _deadline());
    }

    function test_initializeCannotBeCalledTwice() public {
        vm.expectRevert(PicklerBondingCurve.AlreadyInitialized.selector);
        curve.initialize(address(token));
    }

    /// Buys the whole sale allocation, leaving the curve ready to graduate.
    function _exhaust() internal {
        vm.prank(alice);
        curve.buyExactInput(18_900_000e6, 0, alice, _deadline());

        uint256 remaining = curve.remainingTokens();
        uint256 required = curve.quoteBuyExactOutput(remaining);

        vm.prank(bob);
        curve.buyExactOutput(remaining, required * 2, bob, _deadline());
    }
}
