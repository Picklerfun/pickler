// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {PicklerPreset} from "../src/libraries/PicklerPreset.sol";
import {PicklerCurveMath} from "../src/libraries/PicklerCurveMath.sol";

contract PicklerPresetTest is Test {
    address internal quoteToken = makeAddr("quoteToken");

    function _valid() internal view returns (PicklerPreset.LaunchPreset memory preset) {
        (uint256 x0, uint256 q0) = PicklerCurveMath.deriveReserves(800e18, 200e18, 1_000e6);

        preset = PicklerPreset.LaunchPreset({
            presetId: 1,
            version: 1,
            quoteToken: quoteToken,
            totalSupply: 1_000e18,
            saleAllocation: 800e18,
            lpAllocation: 200e18,
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

    function test_aCoherentPresetValidates() public view {
        PicklerPreset.validate(_valid());
    }

    function test_allocationsMustAccountForTheWholeSupply() public {
        PicklerPreset.LaunchPreset memory preset = _valid();
        preset.totalSupply = 1_001e18;

        vm.expectRevert(PicklerPreset.AllocationsDoNotSumToSupply.selector);
        this.exposedValidate(preset);
    }

    function test_theReservesMustBeTheOnesTheAllocationsImply() public {
        PicklerPreset.LaunchPreset memory preset = _valid();
        preset.virtualTokenReserve += 1e18;

        vm.expectRevert(PicklerPreset.ReservesDoNotMatchAllocations.selector);
        this.exposedValidate(preset);
    }

    /// The floor the fuzzer found in A1. A preset landing under it prices a token more finely
    /// than the arithmetic can represent, so it is refused here rather than deployed.
    function test_aPresetBelowThePrecisionFloorIsRefused() public {
        uint256 saleAllocation = 1e27;
        uint256 lpAllocation = 99e25;
        uint256 targetReserve = 100e6;

        (uint256 x0, uint256 q0) = PicklerCurveMath.deriveReserves(saleAllocation, lpAllocation, targetReserve);

        PicklerPreset.LaunchPreset memory preset = _valid();
        preset.totalSupply = saleAllocation + lpAllocation;
        preset.saleAllocation = saleAllocation;
        preset.lpAllocation = lpAllocation;
        preset.virtualTokenReserve = x0;
        preset.virtualQuoteReserve = q0;

        vm.expectRevert(PicklerPreset.EndPriceBelowPrecisionFloor.selector);
        this.exposedValidate(preset);
    }

    function test_feesCannotExceedTheirScale() public {
        PicklerPreset.LaunchPreset memory preset = _valid();
        preset.buyFeeBps = 10_001;

        vm.expectRevert(PicklerPreset.FeeOutOfRange.selector);
        this.exposedValidate(preset);
    }

    /// A fee high enough to make trading pointless is a configuration error, not a choice.
    function test_feesAreCappedWellBelowTheirScale() public {
        PicklerPreset.LaunchPreset memory preset = _valid();
        preset.sellFeeBps = PicklerPreset.MAX_TRADE_FEE_BPS + 1;

        vm.expectRevert(PicklerPreset.FeeOutOfRange.selector);
        this.exposedValidate(preset);
    }

    function test_theRevenueSplitCannotExceedWhatThereIsToSplit() public {
        PicklerPreset.LaunchPreset memory preset = _valid();
        preset.lpCreatorShareBps = 10_001;

        vm.expectRevert(PicklerPreset.FeeOutOfRange.selector);
        this.exposedValidate(preset);
    }

    function test_theQuoteTokenMustExist() public {
        PicklerPreset.LaunchPreset memory preset = _valid();
        preset.quoteToken = address(0);

        vm.expectRevert(PicklerPreset.InvalidQuoteToken.selector);
        this.exposedValidate(preset);
    }

    /// The hash is what a launch commits to. Any field changing it is the point: a preset
    /// that differs anywhere is a different preset, and cannot be swapped in silently.
    function test_theConfigHashCoversEveryField() public view {
        PicklerPreset.LaunchPreset memory preset = _valid();
        bytes32 baseline = PicklerPreset.configHash(preset);

        PicklerPreset.LaunchPreset memory changed = _valid();
        changed.buyFeeBps += 1;
        assertTrue(PicklerPreset.configHash(changed) != baseline, "buyFeeBps left the hash unchanged");

        changed = _valid();
        changed.version += 1;
        assertTrue(PicklerPreset.configHash(changed) != baseline, "version left the hash unchanged");

        changed = _valid();
        changed.lpFeeTier = 3000;
        assertTrue(PicklerPreset.configHash(changed) != baseline, "lpFeeTier left the hash unchanged");

        changed = _valid();
        changed.roundingPolicyVersion += 1;
        assertTrue(PicklerPreset.configHash(changed) != baseline, "roundingPolicyVersion left the hash unchanged");
    }

    function test_theSameConfigAlwaysHashesTheSame() public view {
        assertEq(PicklerPreset.configHash(_valid()), PicklerPreset.configHash(_valid()));
    }

    function exposedValidate(PicklerPreset.LaunchPreset memory preset) external pure {
        PicklerPreset.validate(preset);
    }
}
