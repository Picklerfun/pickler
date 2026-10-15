// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {LaunchGrantTest} from "../LaunchGrantTest.sol";
import {stdStorage, StdStorage} from "forge-std/StdStorage.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IV4Router} from "v4-periphery/src/interfaces/IV4Router.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";
import {IUniswapV4Router} from "../../src/interfaces/IUniswapV4Router.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {IStateView} from "v4-periphery/src/interfaces/IStateView.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {PicklerGraduationAdapterV4V2} from "../../src/PicklerGraduationAdapterV4V2.sol";
import {PicklerLiquidityLockerV2} from "../../src/PicklerLiquidityLockerV2.sol";
import {PicklerLaunchFactory} from "../../src/PicklerLaunchFactory.sol";
import {PicklerCurveDeployerV4V2} from "../../src/PicklerCurveDeployerV4V2.sol";
import {PicklerFeeEscrowV2} from "../../src/PicklerFeeEscrowV2.sol";
import {PicklerBondingCurve} from "../../src/PicklerBondingCurve.sol";
import {PicklerPreset} from "../../src/libraries/PicklerPreset.sol";
import {PicklerCurveMath} from "../../src/libraries/PicklerCurveMath.sol";

/// @dev Explicit current-state fork. Real deployed V4 and AUSD; local funding/signatures only.
/// No transaction is sent and no deployed Pickler launcher is asserted by this suite.
contract PicklerV4ReferenceForkTest is LaunchGrantTest {
    using stdStorage for StdStorage;
    IPoolManager internal constant POOL = IPoolManager(0x451D64ab3b650040d2aE1886602b97ed6eDc643d);
    IPositionManager internal constant POSITIONS =
        IPositionManager(payable(0x3Bb14E3D0Cd50aBe3EdACa06d06c29C78676C31A));
    IStateView internal constant STATE = IStateView(0xB639209539c61BaF67AC04876315786F8D0b153c);
    IAllowanceTransfer internal constant PERMIT = IAllowanceTransfer(0x000000000022D473030F116dDEE9F6B43aC78BA3);
    IERC20 internal constant QUOTE = IERC20(0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC);
    bool internal forked;
    PicklerGraduationAdapterV4V2 internal adapter;
    PicklerLiquidityLockerV2 internal locker;
    PicklerLaunchFactory internal factory;
    PicklerFeeEscrowV2 internal escrow;
    PicklerBondingCurve internal curve;
    IERC20 internal token;
    IUniswapV4Router internal constant ROUTER = IUniswapV4Router(0x1b7bFCd2870329B987191910D85c22C7287f3c22);
    address internal creator = makeAddr("creator");
    address internal buyer = makeAddr("buyer");
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        string memory url = vm.envOr("MONAD_TESTNET_RPC_URL", string(""));
        if (bytes(url).length == 0) return;
        vm.createSelectFork(url, 69_853_802);
        assertEq(block.chainid, 10143);
        assertEq(address(POOL).codehash, 0x61199025286997b715457c68f86dbc42c847753f01e0773668394a405d53d579);
        assertEq(address(POSITIONS).codehash, 0x3452caf821d383d2b18ae48cc0d1467b179b07a1198b8d72153181fcbc556ed5);
        assertEq(address(STATE).codehash, 0xeedadde80f69c3b89437996025759b839a65e12db6c8379a7327a34aa269fa5e);
        assertEq(address(PERMIT).codehash, 0xe8ca368abb6fa7f5d31b388b14e16d3654281140695486df9a22d7d9b75df310);
        assertEq(address(ROUTER).codehash, 0x82fe297858b607b6f6b5599928724441acd046e3dbd19971ec3d6be6587997c6);
        forked = true;
        escrow = new PicklerFeeEscrowV2(treasury);
        adapter = new PicklerGraduationAdapterV4V2(
            POOL,
            POSITIONS,
            STATE,
            PERMIT,
            escrow,
            PicklerGraduationAdapterV4V2.Config(1, address(QUOTE), 10_000, 200, 5)
        );
        locker = adapter.locker();
        PicklerCurveDeployerV4V2 deployer = new PicklerCurveDeployerV4V2(adapter, address(escrow));
        factory = new PicklerLaunchFactory(address(this), deployer, vm.addr(PLATFORM_KEY));
        escrow.initialize(factory, address(locker));
        (uint256 x, uint256 q) = PicklerCurveMath.deriveReserves(16_800_000e18, 4_200_000e18, 32_000e6);
        factory.publishPresetWithVenue(
            PicklerPreset.LaunchPreset(
                1,
                4,
                address(QUOTE),
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
            ),
            adapter.venueConfigHash()
        );
        PicklerLaunchFactory.LaunchParams memory p = PicklerLaunchFactory.LaunchParams(
            keccak256("reference-agent"),
            creator,
            creator,
            "Reference",
            "REF",
            "https://controlled.invalid/metadata",
            keccak256("metadata"),
            1,
            4,
            factory.getPresetConfigHash(1, 4),
            0,
            block.timestamp + 5 minutes
        );
        vm.prank(creator);
        (address t, address c) =
            factory.createLaunch(p, "", uint256(p.agentKey), p.deadline, _platformGrant(factory, p));
        token = IERC20(t);
        curve = PicklerBondingCurve(c);
        uint256 slot = stdstore.target(address(QUOTE)).sig("balanceOf(address)").with_key(buyer).find();
        bytes32 old = vm.load(address(QUOTE), bytes32(slot));
        vm.store(address(QUOTE), bytes32(slot), bytes32((uint256(old) & 255) | (uint256(1_000_000e6) << 8)));
        assertEq(QUOTE.balanceOf(buyer), 1_000_000e6);
        vm.startPrank(buyer);
        QUOTE.approve(c, type(uint256).max);
        vm.stopPrank();
    }
    modifier onlyForked() {
        if (!forked) vm.skip(true);
        _;
    }

    function _swap(PoolKey memory key, address input, uint128 amount) private {
        bool zeroForOne = input == Currency.unwrap(key.currency0);
        address output = Currency.unwrap(zeroForOne ? key.currency1 : key.currency0);
        uint256 beforeOutput = IERC20(output).balanceOf(buyer);
        IERC20(input).approve(address(PERMIT), amount);
        PERMIT.approve(input, address(ROUTER), amount, uint48(block.timestamp + 1));

        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(IV4Router.ExactInputSingleParams(key, zeroForOne, amount, 1, 0, ""));
        params[1] = abi.encode(Currency.wrap(input), uint256(amount));
        params[2] = abi.encode(Currency.wrap(output), uint256(1));
        bytes[] memory commands = new bytes[](1);
        commands[0] = abi.encode(
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE_ALL)),
            params
        );
        ROUTER.execute(hex"10", commands, block.timestamp + 1);

        assertGt(IERC20(output).balanceOf(buyer), beforeOutput);
        PERMIT.approve(input, address(ROUTER), 0, 0);
        IERC20(input).approve(address(PERMIT), 0);
    }

    function test_referenceLaunchCurveGraduationSwapsFeeClaimsAndPermanentLock() public onlyForked {
        vm.startPrank(buyer);
        curve.buyExactOutput(1000e18, curve.quoteBuyExactOutput(1000e18), buyer, block.timestamp + 1);
        token.approve(address(curve), 1000e18);
        curve.sellExactInput(1000e18, 0, buyer, block.timestamp + 1);
        uint256 remaining = curve.remainingTokens();
        curve.buyExactOutput(remaining, curve.quoteBuyExactOutput(remaining), buyer, block.timestamp + 1);
        vm.stopPrank();
        uint256 actualBacking = curve.realQuoteReserve();
        adapter.finalizeGraduation(curve);
        PicklerLiquidityLockerV2.LockedPosition memory p = locker.getLockedPosition(address(token));
        assertGt(p.liquidity, 0);
        assertEq(POSITIONS.getPositionLiquidity(p.tokenId), p.liquidity);
        assertEq(token.balanceOf(address(locker)), p.tokenRemainder);
        assertEq(QUOTE.balanceOf(address(locker)), p.quoteRemainder);
        assertLt(p.quoteRemainder, actualBacking / 1000);
        vm.startPrank(buyer);
        _swap(p.poolKey, address(QUOTE), 100e6);
        _swap(p.poolKey, address(token), 10_000e18);
        vm.stopPrank();
        locker.collectFees(address(token));
        assertEq(POSITIONS.getPositionLiquidity(p.tokenId), p.liquidity);
        assertGt(escrow.accounted(address(QUOTE)) + escrow.accounted(address(token)), 0);
        uint256 claim = escrow.claimable(creator, address(QUOTE));
        if (claim != 0) {
            vm.prank(creator);
            escrow.claim(address(QUOTE), creator);
            assertEq(QUOTE.balanceOf(creator), claim);
        }
        curve.remitFees();
        uint256 accounted = escrow.accounted(address(QUOTE));
        locker.collectFees(address(token));
        assertEq(escrow.accounted(address(QUOTE)), accounted);
        assertEq(POSITIONS.getPositionLiquidity(p.tokenId), p.liquidity);
        vm.expectRevert(PicklerGraduationAdapterV4V2.CurveNotReady.selector);
        adapter.finalizeGraduation(curve);
    }
}
