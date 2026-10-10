// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {LaunchGrantTest} from "./LaunchGrantTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ControlledAccountCore, ControlledSpotRouter, ControlledPassiveMarket} from "./mocks/KuruPassiveMocks.sol";
import {IKuruAccountCore, IKuruSpotRouter, IKuruOrderBook} from "../src/interfaces/IKuruPassive.sol";
import {PicklerKuruPolicy} from "../src/libraries/PicklerKuruPolicy.sol";
import {PicklerPreset} from "../src/libraries/PicklerPreset.sol";
import {PicklerCurveMath} from "../src/libraries/PicklerCurveMath.sol";
import {PicklerLaunchFactory} from "../src/PicklerLaunchFactory.sol";
import {PicklerBondingCurve} from "../src/PicklerBondingCurve.sol";
import {PicklerGraduationAdapterKuru} from "../src/PicklerGraduationAdapterKuru.sol";
import {PicklerCurveDeployerKuru} from "../src/PicklerCurveDeployerKuru.sol";
import {PicklerFeeEscrowV2} from "../src/PicklerFeeEscrowV2.sol";
import {PicklerKuruPositionVault} from "../src/PicklerKuruPositionVault.sol";
import {PicklerKuruLiquidityLocker} from "../src/PicklerKuruLiquidityLocker.sol";

/// @dev Offline controlled ABI/atomic-unit acceptance. This is not a Kuru source equivalence test.
contract PicklerKuruGraduationTest is LaunchGrantTest {
    ControlledAccountCore private core;
    ControlledSpotRouter private router;
    MockERC20 private quote;
    PicklerFeeEscrowV2 private escrow;
    PicklerGraduationAdapterKuru private adapter;
    PicklerCurveDeployerKuru private deployer;
    PicklerLaunchFactory private factory;
    PicklerBondingCurve private curve;
    address private token;
    address private creator = makeAddr("creator");
    address private buyer = makeAddr("buyer");
    address private treasury = makeAddr("treasury");

    function setUp() public {
        vm.chainId(10143);
        core = new ControlledAccountCore();
        router = new ControlledSpotRouter(core);
        quote = new MockERC20("Controlled AUSD", "AUSD", 6);
        core.admit(address(quote), 6);
        escrow = new PicklerFeeEscrowV2(treasury);
        adapter = new PicklerGraduationAdapterKuru(
            IKuruSpotRouter(address(router)), IKuruAccountCore(address(core)), escrow, _policy()
        );
        deployer = new PicklerCurveDeployerKuru(adapter, address(escrow));
        factory = new PicklerLaunchFactory(address(this), deployer, vm.addr(PLATFORM_KEY));
        escrow.initialize(factory, address(adapter.locker()));
        factory.publishPresetWithVenue(_preset(), adapter.venueConfigHash());
        (token, curve) = _launch("first");
        quote.mint(buyer, 1_000_000e6);
    }

    function _policy() private view returns (PicklerKuruPolicy.Config memory config) {
        // Illustrative precision and bands only, never an approved commercial Kuru profile.
        config = PicklerKuruPolicy.Config(
            1, address(quote), 1e6, 1e9, 1, 100, 1, type(uint96).max, 10, 5, new PicklerKuruPolicy.Band[](2)
        );
        config.bands[0] = PicklerKuruPolicy.Band(-50, 5001, 5001, 1);
        config.bands[1] = PicklerKuruPolicy.Band(50, 4999, 4999, 1);
    }

    function _preset() private view returns (PicklerPreset.LaunchPreset memory) {
        (uint256 x, uint256 q) = PicklerCurveMath.deriveReserves(16_800_000e18, 4_200_000e18, 32_000e6);
        return PicklerPreset.LaunchPreset(
            1, 3, address(quote), 21_000_000e18, 16_800_000e18, 4_200_000e18, x, q, 100, 100, 5000, 5000, 0, 0, 0, 2
        );
    }

    function _launch(string memory key) private returns (address t, PicklerBondingCurve c) {
        PicklerLaunchFactory.LaunchParams memory params = PicklerLaunchFactory.LaunchParams(
            keccak256(bytes(key)),
            creator,
            creator,
            "Controlled",
            "CTRL",
            "https://controlled.invalid/immutable",
            keccak256("metadata"),
            1,
            3,
            factory.getPresetConfigHash(1, 3),
            uint256(keccak256(bytes(key))),
            block.timestamp + 5 minutes
        );
        vm.prank(creator);
        address c_;
        (t, c_) = factory.createLaunch(
            params, "", uint256(params.agentKey), params.deadline, _platformGrant(factory, params)
        );
        c = PicklerBondingCurve(c_);
        core.admit(t, 18);
    }

    function _exhaust(PicklerBondingCurve c) private {
        vm.startPrank(buyer);
        quote.approve(address(c), type(uint256).max);
        c.buyExactOutput(16_800_000e18, c.quoteBuyExactOutput(16_800_000e18), buyer, block.timestamp + 1);
        vm.stopPrank();
    }

    function _graduate() private returns (PicklerKuruPositionVault v, ControlledPassiveMarket m) {
        _exhaust(curve);
        adapter.finalizeGraduation(curve);
        v = adapter.locker().vaults(token);
        m = ControlledPassiveMarket(address(v.market()));
    }

    function _fees(PicklerKuruPositionVault v, ControlledPassiveMarket m, uint128 b, uint128 q) private {
        vm.prank(buyer);
        assertTrue(IERC20(token).transfer(address(core), b));
        quote.mint(address(core), q);
        m.setFees(v.positionIds(0), b, q);
    }

    function test_completeReferenceGraduationUsesActualBackingAndLocksRemainders() public {
        (PicklerKuruPositionVault v,) = _graduate();
        assertEq(uint8(curve.phase()), uint8(PicklerBondingCurve.Phase.POOL_ACTIVE));
        assertEq(core.getAccountOwner(v.accountId()), address(v));
        assertEq(core.getBalance(v.accountId(), token) + v.baseReserved(), 4_200_000e18);
        assertEq(core.getBalance(v.accountId(), address(quote)) + v.quoteReserved(), 31_999_999_998);
        assertGt(core.getBalance(v.accountId(), token), 0);
        assertGt(core.getBalance(v.accountId(), address(quote)), 0);
        assertEq(IERC20(token).balanceOf(address(adapter)), 0);
        assertEq(quote.balanceOf(address(adapter)), 0);
        assertEq(IERC20(token).allowance(address(adapter), address(adapter.locker())), 0);
        assertEq(quote.allowance(address(v), address(core)), 0);
        assertEq(IERC20(token).totalSupply(), 21_000_000e18);
        vm.expectRevert();
        adapter.finalizeGraduation(curve);
    }

    function test_precreationLedgerDonationCannotBlockGraduationOrBecomeFees() public {
        address predicted = vm.computeCreateAddress(address(adapter.locker()), 1);
        core.ensureRootAccount(predicted);
        quote.mint(address(this), 1);
        quote.approve(address(core), 1);
        core.deposit(predicted, address(quote), 1);
        (PicklerKuruPositionVault v,) = _graduate();
        assertEq(address(v), predicted);
        assertEq(v.preexistingQuote(), 1);
        adapter.locker().collectFees(token);
        assertEq(escrow.accounted(address(quote)), 0);
        assertEq(core.getBalance(v.accountId(), address(quote)) + v.quoteReserved(), 31_999_999_999);
    }

    function test_beforeExhaustionCannotGraduate() public {
        vm.expectRevert(PicklerGraduationAdapterKuru.CurveNotReady.selector);
        adapter.finalizeGraduation(curve);
    }

    function testFuzz_failedMarketOrMintRevertsEntireGraduation(uint8 fault) public {
        fault = uint8(bound(fault, 0, 3));
        uint8[4] memory faults = [uint8(1), 2, 6, 7];
        router.setFault(faults[fault]);
        _exhaust(curve);
        uint256 fees = curve.accruedFees();
        vm.expectRevert();
        adapter.finalizeGraduation(curve);
        assertEq(uint8(curve.phase()), uint8(PicklerBondingCurve.Phase.READY_TO_GRADUATE));
        assertFalse(adapter.graduated(address(curve)));
        assertEq(quote.balanceOf(address(curve)), 31_999_999_998 + fees);
        assertEq(IERC20(token).balanceOf(address(curve)), 4_200_000e18);
        assertEq(address(adapter.locker().vaults(token)), address(0));
    }

    function test_unadmittedTokenAndWrongUnitsBlockGraduation() public {
        _exhaust(curve);
        core.admit(token, 6);
        vm.expectRevert(PicklerGraduationAdapterKuru.InvalidConfiguration.selector);
        adapter.finalizeGraduation(curve);
    }

    function testFuzz_exactFeesSplitInReceivedAssetsWithoutPrincipal(uint128 b, uint128 q) public {
        b = SafeCast.toUint128(bound(b, 0, 100e18));
        q = SafeCast.toUint128(bound(q, 0, 100e6));
        (PicklerKuruPositionVault v, ControlledPassiveMarket m) = _graduate();
        uint256 beforeB = core.getBalance(v.accountId(), token);
        uint256 beforeQ = core.getBalance(v.accountId(), address(quote));
        uint256 reservedB = core.getSpotReservedBalance(v.accountId(), token);
        uint256 reservedQ = core.getSpotReservedBalance(v.accountId(), address(quote));
        _fees(v, m, b, q);
        adapter.locker().collectFees(token);
        assertEq(escrow.claimable(creator, token) + escrow.claimable(treasury, token), b);
        assertEq(escrow.claimable(creator, address(quote)) + escrow.claimable(treasury, address(quote)), q);
        assertEq(escrow.claimable(treasury, token), b / 2);
        assertEq(escrow.claimable(treasury, address(quote)), q / 2);
        assertEq(core.getBalance(v.accountId(), token), beforeB);
        assertEq(core.getBalance(v.accountId(), address(quote)), beforeQ);
        assertEq(core.getSpotReservedBalance(v.accountId(), token), reservedB);
        assertEq(core.getSpotReservedBalance(v.accountId(), address(quote)), reservedQ);
        adapter.locker().collectFees(token);
        assertEq(escrow.accounted(token), b);
        assertEq(escrow.accounted(address(quote)), q);
        assertEq(IERC20(token).allowance(address(adapter.locker()), address(escrow)), 0);
    }

    function testFuzz_mutatedPositionsOrFeeResponsesRevertCollection(uint8 fault) public {
        fault = uint8(bound(fault, 3, 5));
        (PicklerKuruPositionVault v, ControlledPassiveMarket m) = _graduate();
        _fees(v, m, 10e18, 10e6);
        m.setFault(fault);
        uint256 beforeQ = core.getBalance(v.accountId(), address(quote));
        PicklerKuruLiquidityLocker l = adapter.locker();
        vm.expectRevert();
        l.collectFees(token);
        assertEq(core.getBalance(v.accountId(), address(quote)), beforeQ);
        assertEq(escrow.accounted(address(quote)), 0);
        assertEq(m.quoteFees(v.positionIds(0)), 10e6);
    }

    function test_withdrawalCannotMutateReservedPrincipal() public {
        (PicklerKuruPositionVault v, ControlledPassiveMarket m) = _graduate();
        _fees(v, m, 1e18, 1e6);
        core.setCorruptOnWithdraw(true);
        PicklerKuruLiquidityLocker l = adapter.locker();
        uint256 reserved = core.getSpotReservedBalance(v.accountId(), token);
        vm.expectRevert(PicklerKuruPositionVault.InvalidPosition.selector);
        l.collectFees(token);
        assertEq(core.getSpotReservedBalance(v.accountId(), token), reserved);
        assertEq(escrow.accounted(token), 0);
    }

    function test_donationsAtEveryCustodyLayerStayUnattributed() public {
        (PicklerKuruPositionVault v, ControlledPassiveMarket m) = _graduate();
        quote.mint(address(v), 7e6);
        quote.mint(address(adapter.locker()), 11e6);
        quote.mint(address(escrow), 13e6);
        _fees(v, m, 2e18, 3e6);
        adapter.locker().collectFees(token);
        assertEq(escrow.accounted(address(quote)), 3e6);
        assertEq(quote.balanceOf(address(escrow)), 16e6);
        assertEq(quote.balanceOf(address(v)), 7e6);
        assertEq(quote.balanceOf(address(adapter.locker())), 11e6);
        curve.remitFees();
        assertEq(escrow.accounted(address(quote)), 3e6 + curve.totalFeesRemitted());
        curve.remitFees();
        assertEq(escrow.accounted(address(quote)), 3e6 + curve.totalFeesRemitted());
    }

    function test_twoLaunchesHaveIsolatedAccountsAndRevenue() public {
        (PicklerKuruPositionVault v, ControlledPassiveMarket m) = _graduate();
        (address other, PicklerBondingCurve c) = _launch("second");
        _exhaust(c);
        adapter.finalizeGraduation(c);
        PicklerKuruPositionVault v2 = adapter.locker().vaults(other);
        assertNotEq(v.accountId(), v2.accountId());
        _fees(v, m, 1e18, 1e6);
        adapter.locker().collectFees(other);
        assertEq(escrow.accounted(address(quote)), 0);
        adapter.locker().collectFees(token);
        assertEq(escrow.accounted(token), 1e18);
        assertEq(escrow.accounted(other), 0);
        assertEq(core.getSpotReservedBalance(v2.accountId(), other), v2.baseReserved());
    }

    function test_principalAndPositionsHaveNoCallableExitOrDelegation() public {
        (PicklerKuruPositionVault v,) = _graduate();
        bytes[5] memory calls = [
            abi.encodeWithSignature("withdraw(address,uint256)", token, 1),
            abi.encodeWithSignature("transferPosition(uint64,address)", v.positionIds(0), buyer),
            abi.encodeWithSignature("approve(address,uint256)", buyer, type(uint256).max),
            abi.encodeWithSignature("rescue(address)", token),
            abi.encodeWithSignature("upgradeTo(address)", buyer)
        ];
        for (uint256 i; i < calls.length; ++i) {
            (bool ok,) = address(v).call(calls[i]);
            assertFalse(ok);
        }
        uint40 id = v.accountId();
        vm.expectRevert("owner");
        core.withdraw(id, token, 1, buyer);
        vm.expectRevert(PicklerKuruPositionVault.NotLocker.selector);
        v.collectFees();
    }

    function test_venueCommitmentCannotBeTamperedOrPublishedTwice() public {
        PicklerPreset.LaunchPreset memory p = _preset();
        assertNotEq(factory.getPresetConfigHash(1, 3), PicklerPreset.configHash(p));
        p.version++;
        vm.expectRevert(PicklerLaunchFactory.InvalidVenueConfiguration.selector);
        factory.publishPresetWithVenue(p, keccak256("other"));
        factory.publishPresetWithVenue(p, adapter.venueConfigHash());
        bytes32 hash = adapter.venueConfigHash();
        vm.expectRevert(PicklerLaunchFactory.PresetAlreadyPublished.selector);
        factory.publishPresetWithVenue(p, hash);
    }

    function test_policyRejectsUnknownVersionDuplicateBandsAndUnbalancedWeights() public {
        PicklerKuruPolicy.Config memory p = _policy();
        p.version = 2;
        vm.expectRevert(PicklerKuruPolicy.InvalidKuruPolicy.selector);
        this.validate(p);
        p = _policy();
        p.bands[1].offsetTicks = p.bands[0].offsetTicks;
        vm.expectRevert(PicklerKuruPolicy.InvalidKuruPolicy.selector);
        this.validate(p);
        p = _policy();
        p.bands[1].quoteWeightBps++;
        vm.expectRevert(PicklerKuruPolicy.InvalidKuruPolicy.selector);
        this.validate(p);
    }

    function test_claimIsExplicitAndCannotDebitAnotherBeneficiary() public {
        (PicklerKuruPositionVault v, ControlledPassiveMarket m) = _graduate();
        _fees(v, m, 5e18, 7e6);
        adapter.locker().collectFees(token);
        vm.expectRevert();
        escrow.claim(address(quote), buyer);
        uint256 owed = escrow.claimable(creator, address(quote));
        vm.prank(creator);
        escrow.claim(address(quote), creator);
        assertEq(quote.balanceOf(creator), owed);
        assertEq(escrow.claimable(creator, address(quote)), 0);
        assertEq(escrow.claimable(treasury, address(quote)), 7e6 / 2);
        vm.expectRevert();
        vm.prank(creator);
        escrow.claim(address(quote), creator);
    }

    function validate(PicklerKuruPolicy.Config memory p) external pure {
        PicklerKuruPolicy.validate(p);
    }

    function test_mismatchedEscrowAndUnrepresentablePriceFailBeforeAdmission() public {
        PicklerFeeEscrowV2 other = new PicklerFeeEscrowV2(treasury);
        vm.expectRevert(PicklerCurveDeployerKuru.InvalidKuruPreset.selector);
        new PicklerCurveDeployerKuru(adapter, address(other));
        PicklerKuruPolicy.Config memory p = _policy();
        p.pricePrecision = 1;
        vm.expectRevert(PicklerGraduationAdapterKuru.InvalidPrice.selector);
        new PicklerGraduationAdapterKuru(IKuruSpotRouter(address(router)), IKuruAccountCore(address(core)), escrow, p);
    }

    function test_mainnetAdapterConstructionIsDisabled() public {
        vm.chainId(143);
        vm.expectRevert(PicklerGraduationAdapterKuru.InvalidConfiguration.selector);
        new PicklerGraduationAdapterKuru(
            IKuruSpotRouter(address(router)), IKuruAccountCore(address(core)), escrow, _policy()
        );
    }
}
