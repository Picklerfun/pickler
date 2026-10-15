// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {PicklerAdviceSplitter} from "../../src/PicklerAdviceSplitter.sol";

interface IAusd {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function RECEIVE_WITH_AUTHORIZATION_TYPEHASH() external view returns (bytes32);
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// A real AUSD `ReceiveWithAuthorization`, signed by a test key, settled through the splitter on a
/// Monad testnet fork. It proves the splitter speaks the deployed token's EIP-3009 dialect, not
/// only the offline mock's.
///
/// Runs only when MONAD_TESTNET_RPC_URL is set, so the offline suite stays offline. Run with:
///   MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz npm run contracts:test:fork
contract AdviceSplitterForkTest is Test {
    IAusd internal constant AUSD = IAusd(0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC);

    uint256 internal constant PINNED_BLOCK = 70_289_600;

    /// Holds about 64.5M AUSD at the pinned block. `deal` cannot be used: forge-std's storage
    /// search fails to write AUSD's balance slot ("Failed to write value"), so the buyer is funded
    /// by a pranked transfer from this holder instead.
    address internal constant AUSD_HOLDER = 0x1964C32f0bE608E7D29302AFF5E61268E72080cc;

    bytes32 internal constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
        0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8;

    bool internal forked;

    PicklerAdviceSplitter internal splitter;

    address internal treasury = makeAddr("treasury");
    address internal agent = makeAddr("agent");
    uint256 internal buyerKey = 0xB0B;
    address internal buyer;

    function setUp() public {
        string memory rpcUrl = vm.envOr("MONAD_TESTNET_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            return;
        }

        vm.createSelectFork(rpcUrl, PINNED_BLOCK);
        forked = true;

        buyer = vm.addr(buyerKey);
        splitter = new PicklerAdviceSplitter(address(AUSD), treasury);
    }

    function test_domainMatchesSpec() public {
        if (!forked) vm.skip(true);

        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Agora Dollar"),
                keccak256("1"),
                uint256(10_143),
                address(AUSD)
            )
        );

        assertEq(block.chainid, 10_143);
        assertEq(AUSD.DOMAIN_SEPARATOR(), expected);
        assertEq(AUSD.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), RECEIVE_WITH_AUTHORIZATION_TYPEHASH);
    }

    function test_settlesRealAusdAuthorization() public {
        if (!forked) vm.skip(true);

        uint256 value = 1_500_000;
        vm.prank(AUSD_HOLDER);
        assertTrue(AUSD.transfer(buyer, value));
        assertEq(AUSD.balanceOf(buyer), value);

        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 300;
        bytes32 salt = keccak256("advice-splitter-fork");
        bytes32 nonce = splitter.nonceFor(agent, salt);
        bytes32 structHash = keccak256(
            abi.encode(
                RECEIVE_WITH_AUTHORIZATION_TYPEHASH, buyer, address(splitter), value, validAfter, validBefore, nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", AUSD.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerKey, digest);
        assertFalse(AUSD.authorizationState(buyer, nonce));

        (uint256 creatorAmount, uint256 protocolAmount) =
            splitter.settle(buyer, value, validAfter, validBefore, salt, agent, v, r, s);

        assertEq(creatorAmount, 975_000);
        assertEq(protocolAmount, 525_000);
        assertEq(AUSD.balanceOf(buyer), 0);
        assertEq(AUSD.balanceOf(agent), 975_000);
        assertEq(AUSD.balanceOf(treasury), 525_000);
        assertEq(AUSD.balanceOf(address(splitter)), 0);
        assertTrue(AUSD.authorizationState(buyer, nonce));
    }

    /// AUSD itself enforces that only the payee (`to`) may execute a ReceiveWithAuthorization. A
    /// third party holding a valid buyer signature cannot pull the funds, and the authorization is
    /// not consumed. AUSD reverts with selector 0xfea94442 (caller, payee) for caller != to.
    function test_thirdPartyCannotExecuteReceiveWithAuthorization() public {
        if (!forked) vm.skip(true);

        uint256 value = 1_500_000;
        vm.prank(AUSD_HOLDER);
        assertTrue(AUSD.transfer(buyer, value));

        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 300;
        bytes32 nonce = splitter.nonceFor(agent, keccak256("third-party"));
        bytes32 structHash = keccak256(
            abi.encode(
                RECEIVE_WITH_AUTHORIZATION_TYPEHASH, buyer, address(splitter), value, validAfter, validBefore, nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", AUSD.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerKey, digest);

        vm.prank(makeAddr("thirdParty"));
        vm.expectPartialRevert(bytes4(0xfea94442));
        AUSD.receiveWithAuthorization(buyer, address(splitter), value, validAfter, validBefore, nonce, v, r, s);

        assertFalse(AUSD.authorizationState(buyer, nonce));
        assertEq(AUSD.balanceOf(buyer), value);
        assertEq(AUSD.balanceOf(address(splitter)), 0);
    }
}
