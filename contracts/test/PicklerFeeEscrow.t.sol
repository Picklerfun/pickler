// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {LaunchGrantTest} from "./LaunchGrantTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {PicklerFeeEscrow} from "../src/PicklerFeeEscrow.sol";
import {PicklerLaunchFactory} from "../src/PicklerLaunchFactory.sol";
import {PicklerCurveDeployer} from "../src/PicklerCurveDeployer.sol";
import {PicklerBondingCurve} from "../src/PicklerBondingCurve.sol";
import {PicklerPreset} from "../src/libraries/PicklerPreset.sol";
import {PicklerCurveMath} from "../src/libraries/PicklerCurveMath.sol";

/// A beneficiary that refuses every transfer. Claiming must be its own problem and nobody
/// else's, or one hostile recipient could freeze the escrow for everyone.
contract RejectingRecipient {
    function claim(PicklerFeeEscrow escrow, address asset) external {
        escrow.claim(asset, address(this));
    }
}

contract PicklerFeeEscrowTest is LaunchGrantTest {
    uint256 internal constant SALE_ALLOCATION = 16_800_000e18;
    uint256 internal constant LP_ALLOCATION = 4_200_000e18;
    uint256 internal constant TARGET_RESERVE = 21_000_000e6;
    uint16 internal constant PROTOCOL_SHARE_BPS = 4000;
    uint16 internal constant LP_CREATOR_SHARE_BPS = 6000;

    PicklerFeeEscrow internal escrow;
    PicklerLaunchFactory internal factory;
    PicklerCurveDeployer internal curveDeployer;
    PicklerBondingCurve internal curve;
    MockERC20 internal quote;
    address internal token;

    address internal operator = makeAddr("operator");
    address internal creator = makeAddr("creator");
    address internal treasury = makeAddr("treasury");
    address internal locker = makeAddr("locker");
    address internal adapter = makeAddr("adapter");
    address internal alice = makeAddr("alice");

    function setUp() public {
        quote = new MockERC20("Quote", "QUOTE", 6);

        escrow = new PicklerFeeEscrow(treasury);
        curveDeployer = new PicklerCurveDeployer(adapter, address(escrow));

        vm.prank(operator);
        factory = new PicklerLaunchFactory(operator, curveDeployer, vm.addr(PLATFORM_KEY));

        escrow.initialize(factory, locker);

        vm.prank(operator);
        factory.publishPreset(_preset());

        vm.prank(creator);
        (address token_, address curve_) = factory.createLaunch(
            _params(), "", uint256(_params().agentKey), _params().deadline, _platformGrant(factory, _params())
        );

        token = token_;
        curve = PicklerBondingCurve(curve_);

        quote.mint(alice, 210_000_000e6);
        vm.prank(alice);
        quote.approve(curve_, type(uint256).max);
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
            protocolShareBps: PROTOCOL_SHARE_BPS,
            lpCreatorShareBps: LP_CREATOR_SHARE_BPS,
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

    function _tradeAndRemit() internal returns (uint256 fees) {
        return _tradeAndRemit(10_500_000e6);
    }

    function _tradeAndRemit(uint256 amount) internal returns (uint256 fees) {
        vm.prank(alice);
        curve.buyExactInput(amount, 0, alice, block.timestamp + 5 minutes);

        fees = curve.accruedFees();
        curve.remitFees();
    }

    function test_curveFeesAreSplitByThePresetShare() public {
        uint256 fees = _tradeAndRemit();
        assertGt(fees, 0, "no fees to split");

        uint256 expectedProtocol = (fees * PROTOCOL_SHARE_BPS) / 10_000;

        assertEq(escrow.claimable(treasury, address(quote)), expectedProtocol, "protocol share is wrong");
        assertEq(escrow.claimable(creator, address(quote)), fees - expectedProtocol, "creator share is wrong");
    }

    /// Nothing may be credited twice, and the ledger must never promise more than is held.
    function test_theLedgerNeverExceedsWhatTheEscrowHolds() public {
        _tradeAndRemit();

        uint256 promised = escrow.claimable(treasury, address(quote)) + escrow.claimable(creator, address(quote));

        assertLe(promised, quote.balanceOf(address(escrow)), "the escrow promises more than it holds");
        assertEq(escrow.accounted(address(quote)), promised, "accounting drifted from the ledger");
    }

    function test_syncingTwiceCreditsNothingTheSecondTime() public {
        _tradeAndRemit();

        uint256 before = escrow.claimable(creator, address(quote));

        vm.prank(address(curve));
        escrow.syncCurveFees(token, address(quote));

        assertEq(escrow.claimable(creator, address(quote)), before, "a second sync credited again");
    }

    function test_claimingPaysTheBeneficiaryAndClearsTheirBalance() public {
        _tradeAndRemit();

        uint256 owed = escrow.claimable(creator, address(quote));

        vm.prank(creator);
        uint256 claimed = escrow.claim(address(quote), creator);

        assertEq(claimed, owed);
        assertEq(quote.balanceOf(creator), owed);
        assertEq(escrow.claimable(creator, address(quote)), 0);
    }

    /// Claiming must debit only the caller. Otherwise one beneficiary could drain another's.
    function test_claimingTakesOnlyTheCallersOwnBalance() public {
        _tradeAndRemit();

        uint256 protocolOwed = escrow.claimable(treasury, address(quote));

        vm.prank(creator);
        escrow.claim(address(quote), creator);

        assertEq(escrow.claimable(treasury, address(quote)), protocolOwed, "another beneficiary's balance moved");
        assertEq(quote.balanceOf(address(escrow)), protocolOwed, "the escrow paid out more than one share");
    }

    function test_aBeneficiaryWithNothingCannotClaim() public {
        vm.prank(alice);
        vm.expectRevert(PicklerFeeEscrow.NothingToClaim.selector);
        escrow.claim(address(quote), alice);
    }

    /// One recipient that cannot receive must not freeze anyone else's fees.
    function test_aRecipientThatRejectsTransfersBlocksOnlyItself() public {
        RejectingRecipient hostile = new RejectingRecipient();

        vm.prank(creator);
        factory.transferCreatorFeeRecipient(token, address(hostile));
        vm.prank(address(hostile));
        factory.acceptCreatorFeeRecipient(token);

        _tradeAndRemit();

        assertGt(escrow.claimable(address(hostile), address(quote)), 0, "the hostile recipient accrued nothing");

        // The protocol's share is unaffected by the creator's inability to take theirs.
        vm.prank(treasury);
        uint256 claimed = escrow.claim(address(quote), treasury);

        assertGt(claimed, 0, "the protocol could not claim");
    }

    // --- who may attribute ------------------------------------------------------------

    function test_onlyTheLaunchsOwnCurveCanAttributeTradingFees() public {
        vm.prank(alice);
        vm.expectRevert(PicklerFeeEscrow.NotTheLaunchCurve.selector);
        escrow.syncCurveFees(token, address(quote));
    }

    function test_onlyTheLockerCanAttributePoolFees() public {
        vm.prank(alice);
        vm.expectRevert(PicklerFeeEscrow.NotTheLocker.selector);
        escrow.syncPoolFees(token, address(quote));
    }

    function test_poolFeesUseTheLpSplitNotTheTradingSplit() public {
        quote.mint(address(escrow), 21_000_000e6);

        vm.prank(locker);
        escrow.syncPoolFees(token, address(quote));

        uint256 expectedCreator = (uint256(21_000_000e6) * LP_CREATOR_SHARE_BPS) / 10_000;

        assertEq(escrow.claimable(creator, address(quote)), expectedCreator, "creator got the wrong LP share");
        assertEq(
            escrow.claimable(treasury, address(quote)), 21_000_000e6 - expectedCreator, "protocol got the wrong share"
        );
    }

    function test_anUnknownLaunchCannotBeAttributed() public {
        vm.prank(locker);
        vm.expectRevert(PicklerFeeEscrow.UnknownLaunch.selector);
        escrow.syncPoolFees(makeAddr("not a launch"), address(quote));
    }

    // --- changing the recipient -------------------------------------------------------

    /// A change affects what arrives afterwards, never what was already credited.
    function test_changingTheRecipientLeavesAccruedBalancesWhereTheyAre() public {
        _tradeAndRemit();

        uint256 accruedToCreator = escrow.claimable(creator, address(quote));
        assertGt(accruedToCreator, 0);

        address newRecipient = makeAddr("newRecipient");

        vm.prank(creator);
        factory.transferCreatorFeeRecipient(token, newRecipient);
        vm.prank(newRecipient);
        factory.acceptCreatorFeeRecipient(token);

        assertEq(escrow.claimable(creator, address(quote)), accruedToCreator, "an accrued balance was reassigned");
        assertEq(escrow.claimable(newRecipient, address(quote)), 0, "the new recipient was credited retroactively");

        // Only the next fees go to the new address.
        _tradeAndRemit();

        assertGt(escrow.claimable(newRecipient, address(quote)), 0, "the new recipient was not credited");
        assertEq(escrow.claimable(creator, address(quote)), accruedToCreator, "the old balance changed");
    }

    function test_onlyTheCurrentRecipientCanProposeAChange() public {
        vm.prank(alice);
        vm.expectRevert(PicklerLaunchFactory.NotFeeRecipient.selector);
        factory.transferCreatorFeeRecipient(token, alice);
    }

    /// A transfer that is never accepted changes nothing, which is the point of two steps.
    function test_aProposalTakesEffectOnlyWhenAccepted() public {
        address newRecipient = makeAddr("newRecipient");

        vm.prank(creator);
        factory.transferCreatorFeeRecipient(token, newRecipient);

        assertEq(factory.getLaunch(token).creatorFeeRecipient, creator, "the change applied without acceptance");

        vm.prank(alice);
        vm.expectRevert(PicklerLaunchFactory.NotPendingFeeRecipient.selector);
        factory.acceptCreatorFeeRecipient(token);
    }

    function test_theFactoryIsBoundOnlyOnceAndOnlyByItsDeployer() public {
        PicklerFeeEscrow fresh = new PicklerFeeEscrow(treasury);

        vm.prank(alice);
        vm.expectRevert(PicklerFeeEscrow.NotDeployer.selector);
        fresh.initialize(factory, locker);

        fresh.initialize(factory, locker);

        vm.expectRevert(PicklerFeeEscrow.AlreadyInitialized.selector);
        fresh.initialize(factory, locker);
    }
}
