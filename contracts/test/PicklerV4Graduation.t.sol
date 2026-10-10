// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {LaunchGrantTest} from "./LaunchGrantTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {IStateView} from "v4-periphery/src/interfaces/IStateView.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {ControlledV4Pool, ControlledV4Positions, ControlledV4State, ControlledV4Permit} from "./mocks/V4Mocks.sol";
import {PicklerPreset} from "../src/libraries/PicklerPreset.sol";
import {PicklerCurveMath} from "../src/libraries/PicklerCurveMath.sol";
import {PicklerLaunchFactory} from "../src/PicklerLaunchFactory.sol";
import {PicklerBondingCurve} from "../src/PicklerBondingCurve.sol";
import {PicklerGraduationAdapterV4V2} from "../src/PicklerGraduationAdapterV4V2.sol";
import {PicklerCurveDeployerV4V2} from "../src/PicklerCurveDeployerV4V2.sol";
import {PicklerFeeEscrowV2} from "../src/PicklerFeeEscrowV2.sol";
import {PicklerLiquidityLockerV2} from "../src/PicklerLiquidityLockerV2.sol";

/// @dev Controlled adversarial accounting tests; separate from real deployed-contract fork tests.
contract PicklerV4GraduationTest is LaunchGrantTest {
    ControlledV4Pool internal pool;
    ControlledV4Positions internal positions;
    ControlledV4State internal state;
    ControlledV4Permit internal permit;
    MockERC20 internal quote;
    PicklerFeeEscrowV2 internal escrow;
    PicklerGraduationAdapterV4V2 internal adapter;
    PicklerLiquidityLockerV2 internal locker;
    PicklerLaunchFactory internal factory;
    PicklerBondingCurve internal curve;
    address internal token;
    address internal creator = makeAddr("creator");
    address internal buyer = makeAddr("buyer");
    address internal treasury = makeAddr("treasury");

    function setUp() public virtual {
        vm.chainId(10143);
        pool = new ControlledV4Pool();
        permit = new ControlledV4Permit();
        positions = new ControlledV4Positions(address(pool), address(permit));
        state = new ControlledV4State(address(pool));
        quote = new MockERC20("Controlled AUSD", "AUSD", 6);
        escrow = new PicklerFeeEscrowV2(treasury);
        adapter = new PicklerGraduationAdapterV4V2(
            IPoolManager(address(pool)),
            IPositionManager(address(positions)),
            IStateView(address(state)),
            IAllowanceTransfer(address(permit)),
            escrow,
            PicklerGraduationAdapterV4V2.Config(1, address(quote), 10_000, 200, 5)
        );
        locker = adapter.locker();
        PicklerCurveDeployerV4V2 deployer = new PicklerCurveDeployerV4V2(adapter, address(escrow));
        factory = new PicklerLaunchFactory(address(this), deployer, vm.addr(PLATFORM_KEY));
        escrow.initialize(factory, address(locker));
        factory.publishPresetWithVenue(_preset(), adapter.venueConfigHash());
        (token, curve) = _launch("first");
        quote.mint(buyer, 1_000_000e6);
    }

    function _preset() internal view returns (PicklerPreset.LaunchPreset memory) {
        (uint256 x, uint256 q) = PicklerCurveMath.deriveReserves(16_800_000e18, 4_200_000e18, 32_000e6);
        return PicklerPreset.LaunchPreset(
            1,
            4,
            address(quote),
            21_000_000e18,
            16_800_000e18,
            4_200_000e18,
            x,
            q,
            100,
            100,
            5000,
            5000,
            10_000,
            200,
            0,
            2
        );
    }

    function _launch(string memory key) internal returns (address t, PicklerBondingCurve c) {
        PicklerLaunchFactory.LaunchParams memory p = PicklerLaunchFactory.LaunchParams(
            keccak256(bytes(key)),
            creator,
            creator,
            "Controlled",
            "CTRL",
            "https://controlled.invalid/immutable",
            keccak256("metadata"),
            1,
            4,
            factory.getPresetConfigHash(1, 4),
            uint256(keccak256(bytes(key))),
            block.timestamp + 5 minutes
        );
        vm.prank(creator);
        address c_;
        (t, c_) = factory.createLaunch(p, "", uint256(p.agentKey), p.deadline, _platformGrant(factory, p));
        c = PicklerBondingCurve(c_);
    }

    function _exhaust(PicklerBondingCurve c) internal {
        vm.startPrank(buyer);
        quote.approve(address(c), type(uint256).max);
        c.buyExactOutput(16_800_000e18, c.quoteBuyExactOutput(16_800_000e18), buyer, block.timestamp + 1);
        vm.stopPrank();
    }

    function _graduate() internal returns (PicklerLiquidityLockerV2.LockedPosition memory p) {
        _exhaust(curve);
        adapter.finalizeGraduation(curve);
        return locker.getLockedPosition(token);
    }

    function _fees(PicklerLiquidityLockerV2.LockedPosition memory p, uint128 base, uint128 q) internal {
        vm.prank(buyer);
        assertTrue(IERC20(token).transfer(address(positions), base));
        quote.mint(address(positions), q);
        if (Currency.unwrap(p.poolKey.currency0) == token) positions.setFees(p.tokenId, base, q);
        else positions.setFees(p.tokenId, q, base);
    }

    function test_referenceBackingPermanentPrincipalAndRemnants() public {
        PicklerLiquidityLockerV2.LockedPosition memory p = _graduate();
        assertEq(uint8(curve.phase()), uint8(PicklerBondingCurve.Phase.POOL_ACTIVE));
        assertEq(positions.ownerOf(p.tokenId), address(locker));
        assertGt(p.liquidity, 0);
        assertEq(p.tokenRemainder, 1);
        assertEq(p.quoteRemainder, 1);
        assertEq(IERC20(token).balanceOf(address(positions)) + p.tokenRemainder, 4_200_000e18);
        assertEq(quote.balanceOf(address(positions)) + p.quoteRemainder, 31_999_999_998);
        assertEq(IERC20(token).balanceOf(address(adapter)), 0);
        assertEq(quote.balanceOf(address(adapter)), 0);
        assertEq(IERC20(token).allowance(address(adapter), address(permit)), 0);
        assertEq(permit.allowed(address(adapter), token, address(positions)), 0);
        vm.expectRevert();
        adapter.finalizeGraduation(curve);
    }

    function test_beforeExhaustionAndWrongLaunchAreRejected() public {
        vm.expectRevert();
        adapter.finalizeGraduation(curve);
    }

    function test_failedMintRollsBackAllAssetsAndGraduation() public {
        _exhaust(curve);
        positions.setFault(1);
        uint256 backing = quote.balanceOf(address(curve));
        vm.expectRevert();
        adapter.finalizeGraduation(curve);
        assertEq(quote.balanceOf(address(curve)), backing);
        assertFalse(adapter.graduated(address(curve)));
        assertEq(uint8(curve.phase()), uint8(PicklerBondingCurve.Phase.READY_TO_GRADUATE));
    }

    function test_existingPoolAtWrongPriceRollsBack() public {
        _exhaust(curve);
        (address a, address b) = token < address(quote) ? (token, address(quote)) : (address(quote), token);
        PoolKey memory key = PoolKey(Currency.wrap(a), Currency.wrap(b), 10_000, 200, IHooks(address(0)));
        pool.initialize(key, uint160(1 << 96));
        vm.expectRevert(PicklerGraduationAdapterV4V2.InvalidPrice.selector);
        adapter.finalizeGraduation(curve);
        assertFalse(adapter.graduated(address(curve)));
    }

    function testFuzz_exactFeeSplitAndRepeatedCollection(uint128 base, uint128 q) public {
        base = uint128(bound(base, 1, 1_000_000e18));
        q = uint128(bound(q, 1, 100e6));
        PicklerLiquidityLockerV2.LockedPosition memory p = _graduate();
        _fees(p, base, q);
        locker.collectFees(token);
        assertEq(escrow.claimable(creator, token), uint256(base) - uint256(base) / 2);
        assertEq(escrow.claimable(treasury, token), uint256(base) / 2);
        assertEq(escrow.claimable(creator, address(quote)), uint256(q) - uint256(q) / 2);
        assertEq(positions.getPositionLiquidity(p.tokenId), p.liquidity);
        locker.collectFees(token);
        assertEq(escrow.accounted(token), base);
        assertEq(IERC20(token).balanceOf(address(locker)), p.tokenRemainder);
    }

    function test_donationsNeverBecomeFees() public {
        PicklerLiquidityLockerV2.LockedPosition memory p = _graduate();
        quote.mint(address(locker), 999e6);
        quote.mint(address(escrow), 888e6);
        quote.mint(address(adapter), 777e6);
        locker.collectFees(token);
        assertEq(escrow.accounted(address(quote)), 0);
        assertEq(quote.balanceOf(address(locker)), 999e6 + p.quoteRemainder);
        curve.remitFees();
        assertEq(escrow.accounted(address(quote)), curve.totalFeesRemitted());
    }

    function test_principalChangeDuringCollectionReverts() public {
        PicklerLiquidityLockerV2.LockedPosition memory p = _graduate();
        _fees(p, 10e18, 10e6);
        positions.setFault(2);
        vm.expectRevert(PicklerLiquidityLockerV2.InvalidPosition.selector);
        locker.collectFees(token);
        assertEq(positions.getPositionLiquidity(p.tokenId), p.liquidity);
        assertEq(escrow.accounted(token), 0);
    }

    function test_cannotRegisterSomeoneElsesPosition() public {
        PicklerLiquidityLockerV2.LockedPosition memory p = _graduate();
        vm.expectRevert(PicklerLiquidityLockerV2.NotAdapter.selector);
        locker.lockPosition(token, p.tokenId, p.poolKey, 0, 0);
    }

    function test_secondAgentCannotClaimFirstAgentsFees() public {
        PicklerLiquidityLockerV2.LockedPosition memory p = _graduate();
        _fees(p, 10e18, 10e6);
        locker.collectFees(token);
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert();
        escrow.claim(token, stranger);
        vm.prank(creator);
        escrow.claim(token, creator);
        assertEq(IERC20(token).balanceOf(creator), 5e18);
    }

    function test_twoLaunchesHaveSeparatePositionsResidualsAndFeeAssets() public {
        PicklerLiquidityLockerV2.LockedPosition memory first = _graduate();
        (address secondToken, PicklerBondingCurve secondCurve) = _launch("second");
        _exhaust(secondCurve);
        adapter.finalizeGraduation(secondCurve);
        PicklerLiquidityLockerV2.LockedPosition memory second = locker.getLockedPosition(secondToken);
        assertTrue(first.tokenId != second.tokenId);
        _fees(first, 12e18, 8e6);
        locker.collectFees(secondToken);
        assertEq(escrow.accounted(token), 0);
        locker.collectFees(token);
        assertEq(escrow.accounted(token), 12e18);
        assertEq(escrow.accounted(secondToken), 0);
        assertEq(IERC20(secondToken).balanceOf(address(locker)), second.tokenRemainder);
        assertEq(quote.balanceOf(address(locker)), first.quoteRemainder + second.quoteRemainder);
        assertEq(positions.getPositionLiquidity(first.tokenId), first.liquidity);
        assertEq(positions.getPositionLiquidity(second.tokenId), second.liquidity);
    }

    function test_modifiedDependencyRejectsBeforeReleasingPrincipal() public {
        _exhaust(curve);
        vm.etch(address(positions), hex"00");
        vm.expectRevert(PicklerGraduationAdapterV4V2.InvalidConfiguration.selector);
        adapter.finalizeGraduation(curve);
        assertEq(curve.realQuoteReserve(), 31_999_999_998);
        assertFalse(adapter.graduated(address(curve)));
    }

    function test_lockerExposesNoPrincipalAuthority() public {
        _graduate();
        for (uint256 i; i < 4; ++i) {
            bytes memory payload;
            if (i == 0) {
                payload = abi.encodeWithSignature("withdraw(address)", token);
            } else if (i == 1) {
                payload = abi.encodeWithSignature("approve(address,uint256)", buyer, 1);
            } else if (i == 2) {
                payload = abi.encodeWithSignature("transferFrom(address,address,uint256)", address(locker), buyer, 1);
            } else {
                payload = abi.encodeWithSignature("execute(address,bytes)", address(quote), bytes(""));
            }
            (bool success,) = address(locker).call(payload);
            assertFalse(success);
        }
    }
}
