// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {PicklerBondingCurve} from "../src/PicklerBondingCurve.sol";
import {PicklerAgentToken} from "../src/PicklerAgentToken.sol";
import {PicklerPreset} from "../src/libraries/PicklerPreset.sol";
import {PicklerCurveMath} from "../src/libraries/PicklerCurveMath.sol";

/// Writes the vectors the TypeScript preview is checked against, so the chain is always the
/// source of the numbers and the preview can only ever be wrong loudly.
/// Regenerate with: forge test --root contracts --match-contract CurveVectorsTest
contract CurveVectorsTest is Test {
    string internal constant FIXTURE_PATH = "../packages/core/test/fixtures/curve-vectors.json";

    function test_writeVectors() public {
        (uint256 x0, uint256 q0) = PicklerCurveMath.deriveReserves(800e18, 200e18, 1_000e6);

        PicklerCurveMath.CurveConfig memory config =
            PicklerCurveMath.CurveConfig({virtualTokenReserve: x0, virtualQuoteReserve: q0, saleAllocation: 800e18});

        uint256[6] memory quoteInputs = [uint256(1), 1e6, 10e6, 100e6, 500e6, 1_000e6];
        uint256[4] memory netSoldPoints = [uint256(0), 1e18, 100e18, 400e18];

        string[] memory buys = new string[](quoteInputs.length * netSoldPoints.length);

        uint256 cursor = 0;
        for (uint256 i = 0; i < netSoldPoints.length; i++) {
            for (uint256 j = 0; j < quoteInputs.length; j++) {
                string memory entry = string.concat("buy", vm.toString(cursor));

                vm.serializeString(entry, "netSold", vm.toString(netSoldPoints[i]));
                vm.serializeString(entry, "quoteNetIn", vm.toString(quoteInputs[j]));

                buys[cursor] = vm.serializeString(
                    entry,
                    "tokensOut",
                    vm.toString(PicklerCurveMath.tokensOutForQuoteIn(config, netSoldPoints[i], quoteInputs[j]))
                );

                cursor++;
            }
        }

        string memory json = "vectors";
        vm.serializeString(json, "virtualTokenReserve", vm.toString(x0));
        vm.serializeString(json, "virtualQuoteReserve", vm.toString(q0));
        vm.serializeString(json, "saleAllocation", vm.toString(uint256(800e18)));

        string memory output = vm.serializeString(json, "buys", buys);

        vm.writeJson(output, FIXTURE_PATH);
    }
}

/// Additional vectors retain the original fixture and cover the actual six-decimal profile.
contract ReferenceCurveVectorsTest is Test {
    string[] internal buys;
    string[] internal sells;
    string[] internal exact;
    string[] internal prices;

    function test_writeReferenceVectors() public {
        (uint256 x0, uint256 q0) = PicklerCurveMath.deriveReserves(16_800_000e18, 4_200_000e18, 32_000e6);
        PicklerCurveMath.CurveConfig memory config = PicklerCurveMath.CurveConfig(x0, q0, 16_800_000e18);
        uint256[4] memory points = [uint256(0), 1e18, 8_400_000e18, 16_799_999e18];
        for (uint256 i = 0; i < points.length; i++) {
            PicklerBondingCurve curve = _curveAt(points[i], x0, q0);
            _price(points[i], curve.marginalPriceWad());
            _buys(curve, points[i]);
            _sells(curve, config, points[i]);
            _exact(curve, config, points[i]);
        }
        _price(16_800_000e18, PicklerCurveMath.marginalPriceWad(config, 16_800_000e18, 6));

        string memory key = "reference-vectors";
        vm.serializeString(key, "virtualTokenReserve", vm.toString(x0));
        vm.serializeString(key, "virtualQuoteReserve", vm.toString(q0));
        vm.serializeString(key, "saleAllocation", vm.toString(uint256(16_800_000e18)));
        vm.serializeString(key, "lpAllocation", vm.toString(uint256(4_200_000e18)));
        vm.serializeString(key, "targetReserve", vm.toString(uint256(32_000e6)));
        vm.serializeString(key, "buys", buys);
        vm.serializeString(key, "sells", sells);
        vm.serializeString(key, "exact", exact);
        string memory output = vm.serializeString(key, "prices", prices);
        vm.writeJson(output, "../packages/core/test/fixtures/curve-reference-vectors.json");
    }

    function _price(uint256 netSold, uint256 price) internal {
        string memory key = string.concat("reference-price-", vm.toString(prices.length));
        vm.serializeString(key, "netSold", vm.toString(netSold));
        prices.push(vm.serializeString(key, "priceWad", vm.toString(price)));
    }

    function _buys(PicklerBondingCurve curve, uint256 netSold) internal {
        uint256[6] memory inputs = [uint256(0), 1, 1e6, 100e6, 8_000e6, 32_000e6];
        for (uint256 j = 0; j < inputs.length; j++) {
            string memory key = string.concat("reference-buy-", vm.toString(buys.length));
            uint256 fee = inputs[j] == 0 ? 0 : (inputs[j] - 1) / 100 + 1;
            vm.serializeString(key, "netSold", vm.toString(netSold));
            vm.serializeString(key, "grossQuote", vm.toString(inputs[j]));
            vm.serializeString(key, "fee", vm.toString(fee));
            vm.serializeString(key, "netQuote", vm.toString(inputs[j] - fee));
            buys.push(vm.serializeString(key, "tokensOut", vm.toString(curve.quoteBuy(inputs[j]))));
        }
    }

    function _sells(PicklerBondingCurve curve, PicklerCurveMath.CurveConfig memory config, uint256 netSold) internal {
        uint256[3] memory inputs = [uint256(0), 1, 1e18];
        for (uint256 j = 0; j < inputs.length; j++) {
            string memory key = string.concat("reference-sell-", vm.toString(sells.length));
            vm.serializeString(key, "netSold", vm.toString(netSold));
            vm.serializeString(key, "tokensIn", vm.toString(inputs[j]));
            vm.serializeString(
                key, "grossQuote", vm.toString(PicklerCurveMath.quoteOutForTokensIn(config, netSold, inputs[j]))
            );
            sells.push(vm.serializeString(key, "netQuote", vm.toString(curve.quoteSell(inputs[j]))));
        }
    }

    function _exact(PicklerBondingCurve curve, PicklerCurveMath.CurveConfig memory config, uint256 netSold) internal {
        uint256[3] memory outputs = [uint256(0), 1, 16_800_000e18 - netSold];
        for (uint256 j = 0; j < outputs.length; j++) {
            string memory key = string.concat("reference-exact-", vm.toString(exact.length));
            vm.serializeString(key, "netSold", vm.toString(netSold));
            vm.serializeString(key, "tokensOut", vm.toString(outputs[j]));
            vm.serializeString(
                key, "netQuote", vm.toString(PicklerCurveMath.quoteInForTokensOut(config, netSold, outputs[j]))
            );
            exact.push(vm.serializeString(key, "grossQuote", vm.toString(curve.quoteBuyExactOutput(outputs[j]))));
        }
    }

    function _curveAt(uint256 netSold, uint256 x0, uint256 q0) internal returns (PicklerBondingCurve curve) {
        MockERC20 quote = new MockERC20("Controlled AUSD", "AUSD", 6);
        PicklerPreset.LaunchPreset memory preset = PicklerPreset.LaunchPreset({
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
            lpCreatorShareBps: 0,
            lpFeeTier: 0,
            lpTickSpacing: 0,
            launchFee: 0,
            roundingPolicyVersion: 2
        });
        curve = new PicklerBondingCurve(preset, makeAddr("adapter"), makeAddr("escrow"));
        PicklerAgentToken token = new PicklerAgentToken("Reference", "REF", 21_000_000e18, address(curve));
        curve.initialize(address(token));
        if (netSold > 0) {
            uint256 gross = curve.quoteBuyExactOutput(netSold);
            quote.mint(address(this), gross);
            quote.approve(address(curve), gross);
            curve.buyExactOutput(netSold, gross, address(this), block.timestamp + 1);
        }
    }
}
