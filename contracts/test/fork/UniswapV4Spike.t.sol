// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";

/// Uniswap V4 spike against the real deployment — LP-02 in the product backlog.
///
/// Runs only when MONAD_TESTNET_RPC_URL is set, so the offline suite stays offline. Run with:
///   MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz npm run contracts:test:fork
///
/// The deployment this forks is Monad-maintained, NOT an official Uniswap deployment. Its
/// PoolManager is 34582 bytes where the official Monad mainnet one is 24009, so the two are
/// different builds and a result here does not transfer to mainnet unaided. Addresses and
/// pinned commits come from monad-developers/uniswap-v4-hooks-example, recorded in
/// packages/chain/src/deployments.ts.
contract UniswapV4SpikeTest is Test {
    // Monad-maintained v4 on Monad testnet 10143.
    IPoolManager internal constant POOL_MANAGER = IPoolManager(0x451D64ab3b650040d2aE1886602b97ed6eDc643d);
    IPositionManager internal constant POSITION_MANAGER =
        IPositionManager(payable(0x3Bb14E3D0Cd50aBe3EdACa06d06c29C78676C31A));
    address internal constant STATE_VIEW = 0xB639209539c61BaF67AC04876315786F8D0b153c;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;

    /// The block the Monad manifest records as verified, so this test reads the same state
    /// Monad checked rather than whatever the chain happens to hold today.
    uint256 internal constant PINNED_BLOCK = 62279958;

    bool internal forked;

    function setUp() public {
        string memory rpcUrl = vm.envOr("MONAD_TESTNET_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            return;
        }

        vm.createSelectFork(rpcUrl, PINNED_BLOCK);
        forked = true;
    }

    modifier onlyForked() {
        if (!forked) {
            vm.skip(true);
        }
        _;
    }

    /// Nothing below means anything if the addresses are empty. The product specification
    /// requires verifying bytecode against a manifest before using any address, and an
    /// address list copied between environments is exactly how that goes wrong.
    function test_theDeploymentIsWhereTheManifestSaysItIs() public onlyForked {
        assertEq(block.chainid, 10143, "forked the wrong chain");

        assertGt(address(POOL_MANAGER).code.length, 0, "PoolManager has no code");
        assertGt(address(POSITION_MANAGER).code.length, 0, "PositionManager has no code");
        assertGt(STATE_VIEW.code.length, 0, "StateView has no code");
        assertGt(PERMIT2.code.length, 0, "Permit2 has no code");
        assertGt(AUSD.code.length, 0, "AUSD has no code");

        assertEq(IERC20(AUSD).decimals(), 6, "AUSD is not 6 decimals on this chain");
    }

    /// The PoolManager here is a different build from the official Monad mainnet one. Record
    /// that as a test rather than a comment, so nobody assumes a passing spike transfers.
    function test_thisPoolManagerIsNotTheMainnetBuild() public onlyForked {
        uint256 mainnetPoolManagerCodeSize = 24009;

        assertTrue(
            address(POOL_MANAGER).code.length != mainnetPoolManagerCodeSize,
            "code size now matches mainnet; re-verify whether the builds converged"
        );
    }
}
