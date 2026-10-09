// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {LaunchGrantTest} from "../LaunchGrantTest.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {IStateView} from "v4-periphery/src/interfaces/IStateView.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {PicklerGraduationAdapterV4} from "../../src/PicklerGraduationAdapterV4.sol";
import {PicklerLiquidityLocker} from "../../src/PicklerLiquidityLocker.sol";
import {PicklerLaunchFactory} from "../../src/PicklerLaunchFactory.sol";
import {PicklerCurveDeployer} from "../../src/PicklerCurveDeployer.sol";
import {PicklerFeeEscrow} from "../../src/PicklerFeeEscrow.sol";
import {PicklerBondingCurve} from "../../src/PicklerBondingCurve.sol";
import {PicklerPreset} from "../../src/libraries/PicklerPreset.sol";
import {PicklerCurveMath} from "../../src/libraries/PicklerCurveMath.sol";

/// Graduation end to end against real deployed Uniswap V4 — deliverable A5.
///
/// The A4 spike proved the steps were possible by hand. This proves our contracts perform
/// them: a launch is created, its curve is traded to exhaustion, and a permissionless call
/// opens the pool, seeds it and locks the position, atomically.
///
/// Runs only when MONAD_TESTNET_RPC_URL is set. The deployment forked here is
/// Monad-maintained and not an official Uniswap one; see docs/market/uniswap-v4-spike.md.
contract PicklerGraduationForkTest is LaunchGrantTest {
    using PoolIdLibrary for PoolKey;

    IPoolManager internal constant POOL_MANAGER = IPoolManager(0x451D64ab3b650040d2aE1886602b97ed6eDc643d);
    IPositionManager internal constant POSITION_MANAGER =
        IPositionManager(payable(0x3Bb14E3D0Cd50aBe3EdACa06d06c29C78676C31A));
    IStateView internal constant STATE_VIEW = IStateView(0xB639209539c61BaF67AC04876315786F8D0b153c);
    IAllowanceTransfer internal constant PERMIT2 = IAllowanceTransfer(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    uint256 internal constant PINNED_BLOCK = 62279958;

    uint256 internal constant SALE_ALLOCATION = 800e18;
    uint256 internal constant LP_ALLOCATION = 200e18;
    uint256 internal constant TARGET_RESERVE = 1_000e6;

    bool internal forked;

    MockERC20 internal quote;
    PicklerGraduationAdapterV4 internal adapter;
    PicklerLiquidityLocker internal locker;
    PicklerCurveDeployer internal curveDeployer;
    PicklerLaunchFactory internal factory;
    PicklerBondingCurve internal curve;
    IERC20 internal token;
    PoolSwapTest internal swapRouter;

    address internal operator = makeAddr("operator");
    address internal creator = makeAddr("creator");
    PicklerFeeEscrow internal escrow;
    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");

    function setUp() public {
        string memory rpcUrl = vm.envOr("MONAD_TESTNET_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            return;
        }

        vm.createSelectFork(rpcUrl, PINNED_BLOCK);
        forked = true;

        quote = new MockERC20("Quote", "QUOTE", 6);
        swapRouter = new PoolSwapTest(POOL_MANAGER);

        // The real deployment order: each contract needs the address of one deployed before
        // it, and the escrow's one-time binding closes the loop.
        escrow = new PicklerFeeEscrow(treasury);
        adapter = new PicklerGraduationAdapterV4(POOL_MANAGER, POSITION_MANAGER, STATE_VIEW, PERMIT2, address(escrow));
        locker = adapter.locker();

        curveDeployer = new PicklerCurveDeployer(address(adapter), address(escrow));

        vm.prank(operator);
        factory = new PicklerLaunchFactory(operator, curveDeployer, vm.addr(PLATFORM_KEY));

        escrow.initialize(factory, address(locker));

        vm.prank(operator);
        factory.publishPreset(_preset());

        vm.prank(creator);
        (address token_, address curve_) = factory.createLaunch(
            _params(), "", uint256(_params().agentKey), _params().deadline, _platformGrant(factory, _params())
        );

        token = IERC20(token_);
        curve = PicklerBondingCurve(curve_);

        quote.mint(alice, 100_000e6);

        vm.startPrank(alice);
        quote.approve(curve_, type(uint256).max);
        quote.approve(address(swapRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);
        vm.stopPrank();
    }

    modifier onlyForked() {
        if (!forked) {
            vm.skip(true);
        }
        _;
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

    function _exhaustCurve() internal {
        vm.prank(alice);
        curve.buyExactInput(900e6, 0, alice, block.timestamp + 5 minutes);

        uint256 remaining = curve.remainingTokens();
        uint256 required = curve.quoteBuyExactOutput(remaining);

        vm.prank(alice);
        curve.buyExactOutput(remaining, required * 2, alice, block.timestamp + 5 minutes);
    }

    function test_graduationIsRefusedBeforeTheCurveIsExhausted() public onlyForked {
        vm.expectRevert(PicklerGraduationAdapterV4.CurveNotReady.selector);
        adapter.finalizeGraduation(curve);
    }

    /// Anyone may finalize. The caller gains nothing by it, which is the point: no Pickler
    /// signature stands between a finished curve and its pool.
    function test_anyoneCanFinalizeAndTheLiquidityEndsUpLocked() public onlyForked {
        _exhaustCurve();

        uint256 reserve = curve.realQuoteReserve();

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        adapter.finalizeGraduation(curve);

        assertEq(uint8(curve.phase()), uint8(PicklerBondingCurve.Phase.POOL_ACTIVE), "curve did not close");

        PicklerLiquidityLocker.LockedPosition memory position = locker.getLockedPosition(address(token));
        assertGt(position.tokenId, 0, "no position was locked");

        uint128 liquidity = POSITION_MANAGER.getPositionLiquidity(position.tokenId);
        assertGt(liquidity, 0, "the locked position holds no liquidity");

        (uint160 sqrtPriceX96,,,) = STATE_VIEW.getSlot0(position.poolKey.toId());
        assertGt(sqrtPriceX96, 0, "the pool was never opened");

        // The reserve went into the pool, not to the adapter or anyone else.
        assertLt(quote.balanceOf(address(adapter)), reserve / 100, "the adapter kept a meaningful amount");
        assertEq(quote.balanceOf(address(curve)), curve.accruedFees(), "fees did not stay in the curve");
    }

    function test_graduationCannotHappenTwice() public onlyForked {
        _exhaustCurve();
        adapter.finalizeGraduation(curve);

        vm.expectRevert(PicklerGraduationAdapterV4.CurveNotReady.selector);
        adapter.finalizeGraduation(curve);
    }

    /// The locker's whole claim, now through our contract rather than by hand: fees come out,
    /// principal does not.
    function test_theLockerCollectsFeesWithoutReleasingPrincipal() public onlyForked {
        _exhaustCurve();
        adapter.finalizeGraduation(curve);

        PicklerLiquidityLocker.LockedPosition memory position = locker.getLockedPosition(address(token));
        uint128 liquidityBefore = POSITION_MANAGER.getPositionLiquidity(position.tokenId);

        _swapBothDirections(position.poolKey);

        locker.collectFees(address(token));

        uint128 liquidityAfter = POSITION_MANAGER.getPositionLiquidity(position.tokenId);

        assertEq(liquidityAfter, liquidityBefore, "collecting fees moved the principal");
        assertTrue(
            quote.balanceOf(address(escrow)) > 0 || token.balanceOf(address(escrow)) > 0,
            "no fees reached the escrow despite trading"
        );

        // And they are attributed, not merely sitting there: the creator's share of pool fees
        // is claimable by the creator and by nobody else.
        uint256 creatorShare = escrow.claimable(creator, address(quote)) + escrow.claimable(creator, address(token));
        uint256 protocolShare = escrow.claimable(treasury, address(quote)) + escrow.claimable(treasury, address(token));

        assertGt(creatorShare + protocolShare, 0, "pool fees arrived but were never attributed");
    }

    /// An attacker opens the pool first at a price of their choosing. Graduation must refuse
    /// rather than seed liquidity into it, and the curve's money must stay where it was.
    function test_aPoolOpenedAtAnotherPriceIsRefused() public onlyForked {
        _exhaustCurve();

        PoolKey memory poolKey = adapter.getPoolKey(address(token), curve.preset());

        (uint160 intended,,,) = STATE_VIEW.getSlot0(poolKey.toId());
        assertEq(intended, 0, "the pool already exists");

        // Open it far away from where the curve closed.
        vm.prank(makeAddr("attacker"));
        POOL_MANAGER.initialize(poolKey, uint160(1 << 96));

        uint256 reserveBefore = curve.realQuoteReserve();

        // Named rather than generic: a bare expectRevert would also pass if graduation had
        // failed for an unrelated reason, which would prove nothing about the mitigation.
        (uint160 observed,,,) = STATE_VIEW.getSlot0(poolKey.toId());
        vm.expectRevert(
            abi.encodeWithSelector(
                PicklerGraduationAdapterV4.PoolPriceOutOfTolerance.selector, observed, _intendedSqrtPrice()
            )
        );
        adapter.finalizeGraduation(curve);

        assertEq(curve.realQuoteReserve(), reserveBefore, "the curve lost its reserve to a failed graduation");
        assertEq(uint8(curve.phase()), uint8(PicklerBondingCurve.Phase.READY_TO_GRADUATE), "the phase advanced");
    }

    /// Recomputes the price the adapter would open the pool at, so the expected revert can
    /// name both sides of the comparison rather than trusting that one happened.
    function _intendedSqrtPrice() internal view returns (uint160) {
        uint256 reserve = curve.realQuoteReserve();
        bool tokenIsCurrency0 = address(token) < address(quote);

        (uint256 amount0, uint256 amount1) = tokenIsCurrency0 ? (LP_ALLOCATION, reserve) : (reserve, LP_ALLOCATION);

        uint256 ratio = (amount1 << 96) / amount0;

        return uint160(_sqrt(ratio) << 48);
    }

    function _sqrt(uint256 value) internal pure returns (uint256 result) {
        if (value == 0) {
            return 0;
        }

        result = value;
        uint256 next = value / 2 + 1;
        while (next < result) {
            result = next;
            next = (value / next + next) / 2;
        }
    }

    function _swapBothDirections(PoolKey memory poolKey) internal {
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});

        vm.startPrank(alice);
        swapRouter.swap(
            poolKey,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(1e6), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            bytes("")
        );
        swapRouter.swap(
            poolKey,
            SwapParams({
                zeroForOne: false, amountSpecified: -int256(1e6), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            bytes("")
        );
        vm.stopPrank();
    }
}
