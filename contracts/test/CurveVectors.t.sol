// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
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
