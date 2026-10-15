// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {stdStorage, StdStorage} from "forge-std/StdStorage.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {IV4Router} from "v4-periphery/src/interfaces/IV4Router.sol";
import {IUniswapV4Router} from "../../src/interfaces/IUniswapV4Router.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {IStateView} from "v4-periphery/src/interfaces/IStateView.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";

import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

/// The graduation lifecycle against real deployed Uniswap V4 — LP-02.
///
/// Every step the adapter in A5 will have to perform, executed once here to find out what it
/// actually costs and where it breaks: open the pool at the price the curve closed at, mint a
/// full-range position, trade against it, and collect fees without touching the principal.
///
/// Explicit live-state fork verification requires MONAD_TESTNET_RPC_URL and
/// pins block 69,853,802. Balance injection is controlled; no transaction is sent.
/// The deployment is Monad-maintained, not an official Uniswap deployment.
contract UniswapV4ReferenceTest is Test {
    using PoolIdLibrary for PoolKey;
    using stdStorage for StdStorage;

    IPoolManager internal constant POOL_MANAGER = IPoolManager(0x451D64ab3b650040d2aE1886602b97ed6eDc643d);
    IPositionManager internal constant POSITION_MANAGER =
        IPositionManager(payable(0x3Bb14E3D0Cd50aBe3EdACa06d06c29C78676C31A));
    IStateView internal constant STATE_VIEW = IStateView(0xB639209539c61BaF67AC04876315786F8D0b153c);
    IAllowanceTransfer internal constant PERMIT2 = IAllowanceTransfer(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    address internal constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;

    /// 1% fee tier with its conventional spacing. The tier is still an open product decision;
    /// what this fixes is that the spike measured one specific tier, not "Uniswap V4".
    uint24 internal constant FEE_TIER = 10000;
    int24 internal constant TICK_SPACING = 200;

    // The curve this pool inherits from, matching the parity vectors.
    uint256 internal constant LP_ALLOCATION = 4_200_000e18;
    uint256 internal constant TARGET_RESERVE = 31_999_999998;

    bool internal forked;

    MockERC20 internal agentToken;
    MockERC20 internal quoteToken;
    IUniswapV4Router internal constant SWAP_ROUTER = IUniswapV4Router(0x1b7bFCd2870329B987191910D85c22C7287f3c22);

    PoolKey internal poolKey;
    uint256 internal positionId;

    function setUp() public {
        string memory rpcUrl = vm.envOr("MONAD_TESTNET_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            return;
        }

        vm.createSelectFork(rpcUrl, 69_853_802);
        assertEq(block.chainid, 10143);
        assertEq(address(POOL_MANAGER).codehash, 0x61199025286997b715457c68f86dbc42c847753f01e0773668394a405d53d579);
        assertEq(address(POSITION_MANAGER).codehash, 0x3452caf821d383d2b18ae48cc0d1467b179b07a1198b8d72153181fcbc556ed5);
        assertEq(address(STATE_VIEW).codehash, 0xeedadde80f69c3b89437996025759b839a65e12db6c8379a7327a34aa269fa5e);
        assertEq(address(PERMIT2).codehash, 0xe8ca368abb6fa7f5d31b388b14e16d3654281140695486df9a22d7d9b75df310);
        assertEq(address(SWAP_ROUTER).codehash, 0x82fe297858b607b6f6b5599928724441acd046e3dbd19971ec3d6be6587997c6);
        forked = true;

        // The chain deployment is real AUSD; balance injection is fork-only and sends no transaction.
        agentToken = new MockERC20("Pickler Agent", "AGENT", 18);
        quoteToken = MockERC20(AUSD);
        assertEq(quoteToken.decimals(), 6);

        agentToken.mint(address(this), 21_000_000e18);
        // AUSD packs its balance above an eight-bit flag. Discover the balance slot
        // on this fork, preserve flags and verify the getter before exercising transfers.
        uint256 balanceSlot = stdstore.target(AUSD).sig("balanceOf(address)").with_key(address(this)).find();
        bytes32 previous = vm.load(AUSD, bytes32(balanceSlot));
        vm.store(AUSD, bytes32(balanceSlot), bytes32((uint256(previous) & 255) | (uint256(1_000_000e6) << 8)));
        assertEq(quoteToken.balanceOf(address(this)), 1_000_000e6);

        _approveThroughPermit2(address(agentToken));
        _approveThroughPermit2(address(quoteToken));
    }

    modifier onlyForked() {
        if (!forked) {
            vm.skip(true);
        }
        _;
    }

    function _approveThroughPermit2(address token) internal {
        IERC20(token).approve(address(PERMIT2), type(uint256).max);
        PERMIT2.approve(token, address(POSITION_MANAGER), type(uint160).max, type(uint48).max);
        PERMIT2.approve(token, address(SWAP_ROUTER), type(uint160).max, type(uint48).max);
    }

    /// Currency order is dictated by address, not by which token we consider the quote. The
    /// adapter cannot assume the agent token is currency0.
    function _buildPoolKey() internal view returns (PoolKey memory key, bool agentIsCurrency0) {
        agentIsCurrency0 = address(agentToken) < address(quoteToken);

        (address currency0, address currency1) =
            agentIsCurrency0 ? (address(agentToken), address(quoteToken)) : (address(quoteToken), address(agentToken));

        key = PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: FEE_TIER,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
    }

    /// sqrt(amount1 / amount0) in Q64.96, computed without overflowing: shifting by 96 and
    /// taking the root leaves a further 2^48 to apply.
    function _sqrtPriceX96(uint256 amount0, uint256 amount1) internal pure returns (uint160) {
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

    function _fullRangeTicks() internal pure returns (int24 tickLower, int24 tickUpper) {
        // Dividing before multiplying is the point: it floors the extreme tick onto a
        // multiple of the spacing, which is what "full range" means to the PoolManager.
        // forge-lint: disable-next-line(divide-before-multiply)
        tickLower = (TickMath.MIN_TICK / TICK_SPACING) * TICK_SPACING;
        // forge-lint: disable-next-line(divide-before-multiply)
        tickUpper = (TickMath.MAX_TICK / TICK_SPACING) * TICK_SPACING;
    }

    /// Opens the pool at the price the curve closed at and mints the locked full-range
    /// position, exactly as finalizeGraduation will have to.
    function _graduate() internal returns (uint256 amount0, uint256 amount1) {
        bool agentIsCurrency0;
        (poolKey, agentIsCurrency0) = _buildPoolKey();

        (amount0, amount1) = agentIsCurrency0 ? (LP_ALLOCATION, TARGET_RESERVE) : (TARGET_RESERVE, LP_ALLOCATION);

        uint160 sqrtPriceX96 = _sqrtPriceX96(amount0, amount1);
        POOL_MANAGER.initialize(poolKey, sqrtPriceX96);

        (int24 tickLower, int24 tickUpper) = _fullRangeTicks();

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            amount0,
            amount1
        );

        positionId = POSITION_MANAGER.nextTokenId();

        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));

        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            poolKey, tickLower, tickUpper, liquidity, type(uint128).max, type(uint128).max, address(this), bytes("")
        );
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1);

        POSITION_MANAGER.modifyLiquidities(abi.encode(actions, params), block.timestamp + 60);
    }

    function test_graduationOpensThePoolAndMintsALockedPosition() public onlyForked {
        _graduate();

        uint128 liquidity = POSITION_MANAGER.getPositionLiquidity(positionId);
        assertGt(liquidity, 0, "position holds no liquidity");

        (uint160 sqrtPriceX96,,,) = STATE_VIEW.getSlot0(poolKey.toId());
        assertGt(sqrtPriceX96, 0, "pool was never initialized");
    }

    /// A pool that already exists at a price we did not choose must be detected before any
    /// liquidity is committed. This is the pre-initialization case the product specification
    /// calls out; here it is reproduced rather than assumed.
    function test_aPreInitializedPoolIsDetectableBeforeCommittingLiquidity() public onlyForked {
        bool agentIsCurrency0;
        (poolKey, agentIsCurrency0) = _buildPoolKey();

        (uint256 amount0, uint256 amount1) =
            agentIsCurrency0 ? (LP_ALLOCATION, TARGET_RESERVE) : (TARGET_RESERVE, LP_ALLOCATION);

        uint160 intendedPrice = _sqrtPriceX96(amount0, amount1);

        // An attacker opens the pool first, at a wildly different price.
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        POOL_MANAGER.initialize(poolKey, intendedPrice * 4);

        (uint160 observedPrice,,,) = STATE_VIEW.getSlot0(poolKey.toId());

        assertGt(observedPrice, 0, "expected the pool to already exist");
        assertTrue(observedPrice != intendedPrice, "attacker price should differ from ours");

        // Re-initializing is not a way out: the adapter must compare and refuse.
        vm.expectRevert();
        POOL_MANAGER.initialize(poolKey, intendedPrice);
    }

    /// The locker's whole claim: fees can be taken out, principal cannot.
    function test_feesAreCollectableWithoutReleasingPrincipal() public onlyForked {
        _graduate();

        uint128 liquidityBeforeTrading = POSITION_MANAGER.getPositionLiquidity(positionId);

        _swapBothDirections();

        uint256 quoteBefore = quoteToken.balanceOf(address(this));
        uint256 agentBefore = agentToken.balanceOf(address(this));

        _collectFees();

        uint128 liquidityAfter = POSITION_MANAGER.getPositionLiquidity(positionId);

        assertEq(liquidityAfter, liquidityBeforeTrading, "collecting fees moved the principal");
        assertTrue(
            quoteToken.balanceOf(address(this)) > quoteBefore || agentToken.balanceOf(address(this)) > agentBefore,
            "no fees were collected despite trading"
        );
    }

    function _swapBothDirections() internal {
        _swap(true, uint128(Currency.unwrap(poolKey.currency0) == AUSD ? 100e6 : 10_000e18));
        _swap(false, uint128(Currency.unwrap(poolKey.currency1) == AUSD ? 100e6 : 10_000e18));
    }

    function _swap(bool zeroForOne, uint128 amount) private {
        Currency input = zeroForOne ? poolKey.currency0 : poolKey.currency1;
        Currency output = zeroForOne ? poolKey.currency1 : poolKey.currency0;
        uint256 beforeOutput = IERC20(Currency.unwrap(output)).balanceOf(address(this));
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(IV4Router.ExactInputSingleParams(poolKey, zeroForOne, amount, 1, 0, ""));
        params[1] = abi.encode(input, uint256(amount));
        params[2] = abi.encode(output, uint256(1));
        bytes[] memory commands = new bytes[](1);
        commands[0] = abi.encode(
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE_ALL)),
            params
        );
        SWAP_ROUTER.execute(hex"10", commands, block.timestamp + 1);
        assertGt(IERC20(Currency.unwrap(output)).balanceOf(address(this)), beforeOutput);
    }

    /// Collecting is a decrease of zero liquidity followed by taking what is owed — the only
    /// shape that moves fees without moving principal.
    function _collectFees() internal {
        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));

        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(positionId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1, address(this));

        POSITION_MANAGER.modifyLiquidities(abi.encode(actions, params), block.timestamp + 60);
    }

    /// The price the pool opens at must be the price the curve closed at. This is the join
    /// PicklerCurveMath.deriveReserves exists to guarantee, checked here in pool terms.
    function test_thePoolOpensAtThePriceTheCurveClosedAt() public onlyForked {
        (uint256 amount0, uint256 amount1) = _graduate();

        (uint160 sqrtPriceX96,,,) = STATE_VIEW.getSlot0(poolKey.toId());

        // priceX192 * 1e18 overflows uint256 whenever the agent token sorts as currency1,
        // which is half the time and depends only on a deployment address. FullMath carries
        // the 512-bit intermediate so the check does not depend on which side we land on.
        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        uint256 poolPrice = FullMath.mulDiv(priceX192, 1e18, 1 << 192);
        uint256 intendedPrice = FullMath.mulDiv(amount1, 1e18, amount0);

        assertApproxEqRel(poolPrice, intendedPrice, 0.001e18);
    }
}
