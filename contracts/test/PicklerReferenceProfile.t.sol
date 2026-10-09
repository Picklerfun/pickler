// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {LaunchGrantTest} from "./LaunchGrantTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {PicklerPreset} from "../src/libraries/PicklerPreset.sol";
import {PicklerCurveMath} from "../src/libraries/PicklerCurveMath.sol";
import {PicklerLaunchFactory} from "../src/PicklerLaunchFactory.sol";
import {PicklerCurveDeployer} from "../src/PicklerCurveDeployer.sol";
import {PicklerBondingCurve} from "../src/PicklerBondingCurve.sol";
import {PicklerAgentToken} from "../src/PicklerAgentToken.sol";
import {PicklerFeeEscrow} from "../src/PicklerFeeEscrow.sol";

/// Test-only handover receiver; deliberately has no pool creation or remote venue.
contract ReferenceHandoverAdapter {
    uint256 public backing;
    uint256 public liquidity;

    function accept(PicklerBondingCurve curve) external {
        (backing, liquidity) = curve.releaseForGraduation();
    }
}

/// Actual reference economics on a controlled six-decimal quote. No RPC or DEX.
contract PicklerReferenceProfileTest is LaunchGrantTest {
    PicklerLaunchFactory internal factory;
    PicklerBondingCurve internal curve;
    PicklerAgentToken internal token;
    MockERC20 internal quote;
    address internal adapter;
    address internal escrow;
    address internal creator = makeAddr("creator");
    address internal treasury = makeAddr("treasury");
    address internal buyer = makeAddr("buyer");

    function setUp() public {
        adapter = address(new ReferenceHandoverAdapter());
        quote = new MockERC20("Controlled AUSD", "AUSD", 6);
        escrow = address(new PicklerFeeEscrow(treasury));
        PicklerCurveDeployer deployer = new PicklerCurveDeployer(adapter, escrow);
        factory = new PicklerLaunchFactory(address(this), deployer, vm.addr(PLATFORM_KEY));
        PicklerFeeEscrow(escrow).initialize(factory, makeAddr("controlled-locker"));
        PicklerPreset.LaunchPreset memory preset = _preset();
        factory.publishPreset(preset);
        PicklerLaunchFactory.LaunchParams memory params = PicklerLaunchFactory.LaunchParams({
            agentKey: keccak256("controlled/reference"),
            creator: creator,
            creatorFeeRecipient: creator,
            name: "Reference",
            symbol: "REF",
            metadataURI: "ipfs://controlled-only",
            metadataHash: keccak256("controlled"),
            presetId: 1,
            presetVersion: 2,
            expectedConfigHash: PicklerPreset.configHash(preset),
            nonce: 1,
            deadline: block.timestamp + 5 minutes
        });
        vm.prank(creator);
        (address token_, address curve_) =
            factory.createLaunch(params, "", uint256(params.agentKey), params.deadline, _platformGrant(factory, params));
        token = PicklerAgentToken(token_);
        curve = PicklerBondingCurve(curve_);
        quote.mint(buyer, 100_000e6);
        vm.startPrank(buyer);
        quote.approve(curve_, type(uint256).max);
        token.approve(curve_, type(uint256).max);
        vm.stopPrank();
    }

    function _preset() internal view returns (PicklerPreset.LaunchPreset memory) {
        (uint256 x0, uint256 q0) = PicklerCurveMath.deriveReserves(16_800_000e18, 4_200_000e18, 32_000e6);
        return PicklerPreset.LaunchPreset({
            presetId: 1,
            version: 2,
            quoteToken: address(quote),
            totalSupply: 21_000_000e18,
            saleAllocation: 16_800_000e18,
            lpAllocation: 4_200_000e18,
            virtualTokenReserve: x0,
            virtualQuoteReserve: q0,
            buyFeeBps: 100,
            sellFeeBps: 100,
            protocolShareBps: 5000,
            // Controlled handover only. These are not an approved DEX configuration.
            lpCreatorShareBps: 0,
            lpFeeTier: 0,
            lpTickSpacing: 0,
            launchFee: 0,
            roundingPolicyVersion: 2
        });
    }

    function validate(PicklerPreset.LaunchPreset memory preset) external pure {
        PicklerPreset.validate(preset);
    }

    function test_actualPricesAndEndReserveArePreciselyRepresentable() public {
        assertEq(curve.marginalPriceWad(), 476190476160714);
        uint256 gross = curve.quoteBuyExactOutput(16_800_000e18);
        vm.prank(buyer);
        curve.buyExactOutput(16_800_000e18, gross, buyer, block.timestamp + 1);
        assertEq(curve.marginalPriceWad(), 7619047618571428);
        assertEq(curve.realQuoteReserve(), 31_999_999_998);
        assertEq(curve.accruedFees(), gross - 31_999_999_998);
        assertEq(token.totalSupply(), 21_000_000e18);
        assertEq(token.balanceOf(address(curve)), 4_200_000e18);
        assertEq(uint8(curve.phase()), uint8(PicklerBondingCurve.Phase.READY_TO_GRADUATE));

        vm.expectRevert(PicklerBondingCurve.CurveClosed.selector);
        vm.prank(buyer);
        curve.sellExactInput(1e18, 0, buyer, block.timestamp + 1);

        uint256 fees = curve.accruedFees();
        ReferenceHandoverAdapter receiver = ReferenceHandoverAdapter(adapter);
        receiver.accept(curve);
        uint256 backing = receiver.backing();
        uint256 liquidity = receiver.liquidity();
        assertEq(backing, 31_999_999_998);
        assertEq(liquidity, 4_200_000e18);
        assertEq(quote.balanceOf(adapter), backing);
        assertEq(token.balanceOf(adapter), liquidity);
        assertEq(quote.balanceOf(address(curve)), fees);
    }

    function test_actualTradeFeesAreSplitWithoutTakingBacking() public {
        vm.startPrank(buyer);
        uint256 tokens = curve.buyExactInput(100e6, 0, buyer, block.timestamp + 1);
        curve.sellExactInput(tokens / 4, 0, buyer, block.timestamp + 1);
        vm.stopPrank();

        uint256 fees = curve.accruedFees();
        uint256 reserve = curve.realQuoteReserve();
        curve.remitFees();
        uint256 creatorFees = PicklerFeeEscrow(escrow).claimable(creator, address(quote));
        uint256 protocolFees = PicklerFeeEscrow(escrow).claimable(treasury, address(quote));
        assertEq(creatorFees + protocolFees, fees);
        assertGe(creatorFees, protocolFees);
        assertLe(creatorFees - protocolFees, 1);
        assertEq(curve.realQuoteReserve(), reserve);
        assertEq(curve.accruedFees(), 0);
        assertEq(quote.balanceOf(address(curve)), reserve);
    }

    function test_donationsDoNotChangePriceOrBackingOrFees() public {
        uint256 price = curve.marginalPriceWad();
        uint256 quoted = curve.quoteBuy(100e6);
        quote.mint(address(curve), 1_000e6);
        assertEq(curve.marginalPriceWad(), price);
        assertEq(curve.quoteBuy(100e6), quoted);
        assertEq(curve.realQuoteReserve(), 0);
        assertEq(curve.accruedFees(), 0);
    }

    function testFuzz_roundTripCannotCreateQuote(uint256 gross) public {
        gross = bound(gross, 1, 8_000e6);
        uint256 before = quote.balanceOf(buyer);
        vm.startPrank(buyer);
        uint256 received = curve.buyExactInput(gross, curve.quoteBuy(gross), buyer, block.timestamp + 1);
        if (received > 0) {
            uint256 quoted = curve.quoteSell(received);
            uint256 paid = curve.sellExactInput(received, quoted, buyer, block.timestamp + 1);
            assertEq(paid, quoted);
        }
        vm.stopPrank();
        assertLe(quote.balanceOf(buyer), before);
        assertGe(quote.balanceOf(address(curve)), curve.realQuoteReserve() + curve.accruedFees());
        assertEq(token.balanceOf(address(curve)) + token.balanceOf(buyer), token.totalSupply());
    }

    function test_referenceCannotUseLegacyPrecisionOrUnknownPolicy() public {
        PicklerPreset.LaunchPreset memory preset = _preset();
        preset.roundingPolicyVersion = 1;
        vm.expectRevert(PicklerPreset.EndPriceBelowPrecisionFloor.selector);
        this.validate(preset);
        preset.roundingPolicyVersion = 3;
        vm.expectRevert(PicklerPreset.UnsupportedPrecisionPolicy.selector);
        this.validate(preset);
    }

    function test_referenceRejectsNonzeroLaunchFeeAndAlteredEconomics() public {
        PicklerPreset.LaunchPreset memory preset = _preset();
        preset.launchFee = 1;
        vm.expectRevert(PicklerPreset.InvalidReferenceProfile.selector);
        this.validate(preset);
        preset.launchFee = 0;
        preset.buyFeeBps = 101;
        vm.expectRevert(PicklerPreset.InvalidReferenceProfile.selector);
        this.validate(preset);
    }

    function test_wrongOrMissingQuoteDecimalsFailBeforePresetPublication() public {
        PicklerPreset.LaunchPreset memory preset = _preset();
        preset.version = 3;
        preset.quoteToken = address(new MockERC20("Wrong quote", "WRONG", 18));
        vm.expectRevert(PicklerPreset.InvalidQuoteDecimals.selector);
        factory.publishPreset(preset);
        vm.expectRevert(PicklerPreset.InvalidQuoteDecimals.selector);
        new PicklerBondingCurve(preset, adapter, escrow);
        preset.quoteToken = makeAddr("no-metadata");
        vm.expectRevert(PicklerPreset.InvalidQuoteDecimals.selector);
        factory.publishPreset(preset);
    }

    function test_normalizedEndPriceMatchesLpBackingWithinOneWad() public pure {
        (uint256 x0, uint256 q0) = PicklerCurveMath.deriveReserves(16_800_000e18, 4_200_000e18, 32_000e6);
        PicklerCurveMath.CurveConfig memory config = PicklerCurveMath.CurveConfig(x0, q0, 16_800_000e18);
        uint256 net = PicklerCurveMath.quoteInForTokensOut(config, 0, 16_800_000e18);
        uint256 lpPrice = (net * 1e30) / 4_200_000e18;
        assertEq(lpPrice, PicklerCurveMath.marginalPriceWad(config, 16_800_000e18, 6));
    }
}
