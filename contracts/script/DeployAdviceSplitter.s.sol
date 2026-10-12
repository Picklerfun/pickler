// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";

import {PicklerAdviceSplitter} from "../src/PicklerAdviceSplitter.sol";

/// Explicit deployment of the advice splitter on Monad testnet (10143). Nothing here runs as a side
/// effect of build or test. The signing key is supplied only by forge (`--private-key` or
/// `--account`); no key or treasury address lives in code.
///
/// Inputs: ADVICE_SPLITTER_TREASURY (required) and AUSD_ADDRESS (default: testnet AUSD).
contract DeployAdviceSplitter is Script {
    uint256 internal constant MONAD_TESTNET_CHAIN_ID = 10_143;
    address internal constant DEFAULT_AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;

    error WrongChain(uint256 chainId);
    error AssetHasNoCode(address asset);

    function run() external returns (PicklerAdviceSplitter splitter) {
        if (block.chainid != MONAD_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);

        address treasury = vm.envAddress("ADVICE_SPLITTER_TREASURY");
        address ausd = vm.envOr("AUSD_ADDRESS", DEFAULT_AUSD);

        if (ausd.code.length == 0) revert AssetHasNoCode(ausd);

        // Logged before broadcasting so a dry run shows exactly what a broadcast would deploy.
        console2.log("chainId", block.chainid);
        console2.log("asset", ausd);
        console2.log("treasury", treasury);

        vm.startBroadcast();
        splitter = new PicklerAdviceSplitter(ausd, treasury);
        vm.stopBroadcast();

        console2.log("PicklerAdviceSplitter", address(splitter));
        console2.log("block", block.number);
    }
}
