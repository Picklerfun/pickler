// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {LaunchGrantTest} from "./LaunchGrantTest.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {PicklerLaunchFactory} from "../src/PicklerLaunchFactory.sol";
import {PicklerCurveDeployer} from "../src/PicklerCurveDeployer.sol";
import {PicklerBondingCurve} from "../src/PicklerBondingCurve.sol";
import {PicklerPreset} from "../src/libraries/PicklerPreset.sol";
import {PicklerCurveMath} from "../src/libraries/PicklerCurveMath.sol";

/// The pieces of track A wired together: a creator launches, two wallets trade, the curve
/// reaches READY_TO_GRADUATE and hands over exactly what it should. No stubs.
contract PicklerLaunchIntegrationTest is LaunchGrantTest {
    uint256 internal constant SALE_ALLOCATION = 16_800_000e18;
    uint256 internal constant LP_ALLOCATION = 4_200_000e18;
    uint256 internal constant TARGET_RESERVE = 21_000_000e6;

    PicklerLaunchFactory internal factory;
    PicklerCurveDeployer internal deployer;
    MockERC20 internal quote;

    address internal operator = makeAddr("operator");
    address internal creator = makeAddr("creator");
    address internal adapter = makeAddr("adapter");
    address internal feeEscrow = makeAddr("feeEscrow");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    PicklerBondingCurve internal curve;
    IERC20 internal token;

    function setUp() public {
        quote = new MockERC20("Agora Dollar", "AUSD", 6);

        deployer = new PicklerCurveDeployer(adapter, feeEscrow);

        vm.prank(operator);
        factory = new PicklerLaunchFactory(operator, deployer, vm.addr(PLATFORM_KEY));

        vm.prank(operator);
        factory.publishPreset(_preset());

        vm.prank(creator);
        (address token_, address curve_) = factory.createLaunch(
            _params(), "", uint256(_params().agentKey), _params().deadline, _platformGrant(factory, _params())
        );

        token = IERC20(token_);
        curve = PicklerBondingCurve(curve_);

        quote.mint(alice, 210_000_000e6);
        quote.mint(bob, 210_000_000e6);

        vm.startPrank(alice);
        quote.approve(curve_, type(uint256).max);
        token.approve(curve_, type(uint256).max);
        vm.stopPrank();

        vm.startPrank(bob);
        quote.approve(curve_, type(uint256).max);
        token.approve(curve_, type(uint256).max);
        vm.stopPrank();
    }

    function _preset() internal view returns (PicklerPreset.LaunchPreset memory preset) {
        (uint256 x0, uint256 q0) = PicklerCurveMath.deriveReserves(SALE_ALLOCATION, LP_ALLOCATION, TARGET_RESERVE);

        preset = PicklerPreset.LaunchPreset({
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
            roundingPolicyVersion: 1
        });
    }

    function _params() internal view returns (PicklerLaunchFactory.LaunchParams memory) {
        return PicklerLaunchFactory.LaunchParams({
            agentKey: keccak256("creator/agent-1"),
            creator: creator,
            creatorFeeRecipient: creator,
            name: "Pickler Agent",
            symbol: "AGENT",
            metadataURI: "ipfs://agent",
            metadataHash: keccak256("metadata"),
            presetId: 1,
            presetVersion: 1,
            expectedConfigHash: PicklerPreset.configHash(_preset()),
            nonce: 0,
            deadline: block.timestamp + 5 minutes
        });
    }

    function test_aLaunchArrivesReadyToTrade() public view {
        assertEq(token.balanceOf(address(curve)), SALE_ALLOCATION + LP_ALLOCATION, "curve holds no inventory");
        assertEq(curve.remainingTokens(), SALE_ALLOCATION, "sale allocation is wrong");
        assertEq(uint8(curve.phase()), uint8(PicklerBondingCurve.Phase.CURVE_ACTIVE));
        assertEq(address(curve.quoteToken()), address(quote));
        assertEq(curve.graduationAdapter(), adapter, "curve points at another adapter");
        assertEq(curve.feeEscrow(), feeEscrow, "curve points at another escrow");
    }

    /// The whole of track A in one pass: buy, sell, consume the remainder, hand over.
    function test_theFullPathFromLaunchToHandover() public {
        vm.prank(alice);
        uint256 aliceTokens = curve.buyExactInput(8_400_000e6, 0, alice, block.timestamp + 5 minutes);
        assertGt(aliceTokens, 0);

        vm.prank(bob);
        curve.buyExactInput(6_300_000e6, 0, bob, block.timestamp + 5 minutes);

        vm.prank(alice);
        uint256 refunded = curve.sellExactInput(aliceTokens / 4, 0, alice, block.timestamp + 5 minutes);
        assertGt(refunded, 0, "selling returned nothing");

        // Consume whatever is left with exact output, which is the only way to finish.
        uint256 remaining = curve.remainingTokens();
        uint256 required = curve.quoteBuyExactOutput(remaining);

        vm.prank(bob);
        curve.buyExactOutput(remaining, required, bob, block.timestamp + 5 minutes);

        assertEq(uint8(curve.phase()), uint8(PicklerBondingCurve.Phase.READY_TO_GRADUATE));
        assertEq(curve.remainingTokens(), 0);

        uint256 reserve = curve.realQuoteReserve();
        uint256 fees = curve.accruedFees();

        vm.prank(adapter);
        (uint256 quoteReleased, uint256 tokensReleased) = curve.releaseForGraduation();

        assertEq(quoteReleased, reserve, "handed over a different reserve");
        assertEq(tokensReleased, LP_ALLOCATION, "handed over a different LP allocation");
        assertEq(quote.balanceOf(address(curve)), fees, "fees did not stay behind");
    }

    /// Every token that left the curve is somewhere accountable, and none was created.
    function test_noTokenIsCreatedOrLostAlongTheWay() public {
        vm.prank(alice);
        curve.buyExactInput(8_400_000e6, 0, alice, block.timestamp + 5 minutes);

        vm.prank(bob);
        curve.buyExactInput(6_300_000e6, 0, bob, block.timestamp + 5 minutes);

        uint256 accounted = token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(address(curve));

        assertEq(accounted, SALE_ALLOCATION + LP_ALLOCATION, "tokens appeared or vanished");
        assertEq(token.totalSupply(), SALE_ALLOCATION + LP_ALLOCATION, "supply moved");
    }

    /// Buying the token must not touch anything the creator funds separately. The curve holds
    /// only its own reserve, and the factory holds nothing at all.
    function test_theCurveHoldsOnlyItsOwnMoney() public {
        vm.prank(alice);
        curve.buyExactInput(8_400_000e6, 0, alice, block.timestamp + 5 minutes);

        assertEq(quote.balanceOf(address(factory)), 0, "the factory is holding quote");
        assertEq(token.balanceOf(address(factory)), 0, "the factory is holding tokens");
        assertEq(quote.balanceOf(address(deployer)), 0, "the deployer is holding quote");
        assertEq(
            quote.balanceOf(address(curve)),
            curve.realQuoteReserve() + curve.accruedFees(),
            "the curve holds an amount it cannot account for"
        );
    }

    function test_twoLaunchesDoNotShareACurve() public {
        PicklerLaunchFactory.LaunchParams memory second = _params();
        second.agentKey = keccak256("creator/agent-2");
        second.nonce = 1;

        vm.prank(creator);
        (address otherToken, address otherCurve) =
            factory.createLaunch(second, "", uint256(second.agentKey), second.deadline, _platformGrant(factory, second));

        assertTrue(otherCurve != address(curve), "two launches share a curve");
        assertTrue(otherToken != address(token), "two launches share a token");
        assertEq(IERC20(otherToken).balanceOf(otherCurve), SALE_ALLOCATION + LP_ALLOCATION);
        assertEq(IERC20(otherToken).balanceOf(address(curve)), 0, "inventory landed on the wrong curve");
    }
}
