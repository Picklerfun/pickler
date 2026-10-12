// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";

import {PicklerAdviceSplitter} from "../src/PicklerAdviceSplitter.sol";
import {MockEip3009Token} from "./mocks/MockEip3009Token.sol";

contract PicklerAdviceSplitterTest is Test {
    event AdviceSettled(
        address indexed from,
        address indexed payee,
        bytes32 indexed nonce,
        uint256 value,
        uint256 creatorAmount,
        uint256 protocolAmount
    );

    MockEip3009Token internal token;
    PicklerAdviceSplitter internal splitter;

    address internal treasury = makeAddr("treasury");
    address internal agent = makeAddr("agent");
    address internal otherAgent = makeAddr("otherAgent");
    address internal relayer = makeAddr("relayer");

    uint256 internal buyerKey = 0xB0B;
    address internal buyer;

    struct Authorization {
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 salt;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    function setUp() public {
        vm.warp(1_800_000_000);

        buyer = vm.addr(buyerKey);
        token = new MockEip3009Token();
        splitter = new PicklerAdviceSplitter(address(token), treasury);
    }

    function _sign(uint256 value, bytes32 salt, address signedPayee) internal view returns (Authorization memory a) {
        a.value = value;
        a.validAfter = block.timestamp - 1;
        a.validBefore = block.timestamp + 300;
        a.salt = salt;

        // The buyer's app derives the nonce the way the splitter will recompute it. test_nonceFor and
        // the event in test_splitsOnePointFive pin that derivation to the spec independently.
        bytes32 nonce = splitter.nonceFor(signedPayee, salt);
        bytes32 structHash = keccak256(
            abi.encode(
                token.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                buyer,
                address(splitter),
                value,
                a.validAfter,
                a.validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));

        (a.v, a.r, a.s) = vm.sign(buyerKey, digest);
    }

    function _settle(Authorization memory a, address payee) internal returns (uint256, uint256) {
        vm.prank(relayer);

        return splitter.settle(buyer, a.value, a.validAfter, a.validBefore, a.salt, payee, a.v, a.r, a.s);
    }

    function _assertSplit(uint256 value, bytes32 salt) internal {
        token.mint(buyer, value);
        uint256 creatorBefore = token.balanceOf(agent);
        uint256 treasuryBefore = token.balanceOf(treasury);
        Authorization memory a = _sign(value, salt, agent);

        (uint256 creatorAmount, uint256 protocolAmount) = _settle(a, agent);

        assertEq(creatorAmount, value * 6500 / 10_000);
        assertEq(protocolAmount, value - creatorAmount);
        assertEq(creatorAmount + protocolAmount, value);
        assertEq(token.balanceOf(agent) - creatorBefore, creatorAmount);
        assertEq(token.balanceOf(treasury) - treasuryBefore, protocolAmount);
        assertEq(token.balanceOf(address(splitter)), 0);
    }

    function test_splitsOnePointFive() public {
        token.mint(buyer, 1_500_000);
        bytes32 salt = bytes32(uint256(7));
        Authorization memory a = _sign(1_500_000, salt, agent);
        bytes32 nonce = keccak256(abi.encode(agent, salt));

        vm.expectEmit(address(splitter));
        emit AdviceSettled(buyer, agent, nonce, 1_500_000, 975_000, 525_000);
        (uint256 creatorAmount, uint256 protocolAmount) = _settle(a, agent);

        assertEq(creatorAmount, 975_000);
        assertEq(protocolAmount, 525_000);
        assertEq(token.balanceOf(agent), 975_000);
        assertEq(token.balanceOf(treasury), 525_000);
        assertEq(token.balanceOf(buyer), 0);
        assertEq(token.balanceOf(address(splitter)), 0);
        assertTrue(token.authorizationState(buyer, nonce));
    }

    function test_edges() public {
        _assertSplit(100_000, bytes32(uint256(1)));
        _assertSplit(100_000_000, bytes32(uint256(2)));
        _assertSplit(1, bytes32(uint256(3)));
        _assertSplit(3, bytes32(uint256(4)));

        assertEq(uint256(1) * 6500 / 10_000, 0);
        assertEq(uint256(3) * 6500 / 10_000, 1);
    }

    function testFuzz_sharesSumToValue(uint256 value, bytes32 salt) public {
        value = bound(value, 1, 1e30);

        _assertSplit(value, salt);
    }

    function test_otherPayeeFailsSignature() public {
        token.mint(buyer, 1_500_000);
        Authorization memory a = _sign(1_500_000, bytes32(uint256(9)), agent);

        vm.expectRevert(MockEip3009Token.InvalidSignature.selector);
        _settle(a, otherAgent);

        assertEq(token.balanceOf(buyer), 1_500_000);
        assertEq(token.balanceOf(agent), 0);
        assertEq(token.balanceOf(otherAgent), 0);
        assertEq(token.balanceOf(treasury), 0);
        assertEq(token.balanceOf(address(splitter)), 0);
    }

    function test_replayReverts() public {
        token.mint(buyer, 3_000_000);
        Authorization memory a = _sign(1_500_000, bytes32(uint256(11)), agent);
        _settle(a, agent);

        vm.expectRevert(MockEip3009Token.AuthorizationUsed.selector);
        _settle(a, agent);

        assertEq(token.balanceOf(buyer), 1_500_000);
        assertEq(token.balanceOf(agent), 975_000);
        assertEq(token.balanceOf(treasury), 525_000);
    }

    function test_invalidPayee() public {
        token.mint(buyer, 1_500_000);
        address[3] memory payees = [address(0), address(splitter), treasury];

        for (uint256 i = 0; i < payees.length; i++) {
            Authorization memory a = _sign(1_500_000, bytes32(uint256(20 + i)), payees[i]);

            vm.expectRevert(PicklerAdviceSplitter.InvalidPayee.selector);
            _settle(a, payees[i]);
        }

        assertEq(token.balanceOf(buyer), 1_500_000);
    }

    function test_constructorZero() public {
        vm.expectRevert(PicklerAdviceSplitter.ZeroAddress.selector);
        new PicklerAdviceSplitter(address(0), treasury);

        vm.expectRevert(PicklerAdviceSplitter.ZeroAddress.selector);
        new PicklerAdviceSplitter(address(token), address(0));
    }

    function test_payeeTransferFalseReverts() public {
        token.mint(buyer, 1_500_000);
        Authorization memory a = _sign(1_500_000, bytes32(uint256(30)), agent);
        token.setTransferFailsTo(agent);

        vm.expectRevert(PicklerAdviceSplitter.TransferFailed.selector);
        _settle(a, agent);

        assertEq(token.balanceOf(buyer), 1_500_000);
        assertEq(token.balanceOf(address(splitter)), 0);
        assertFalse(token.authorizationState(buyer, keccak256(abi.encode(agent, a.salt))));
    }

    function test_treasuryTransferFalseReverts() public {
        token.mint(buyer, 1_500_000);
        Authorization memory a = _sign(1_500_000, bytes32(uint256(31)), agent);
        token.setTransferFailsTo(treasury);

        vm.expectRevert(PicklerAdviceSplitter.TransferFailed.selector);
        _settle(a, agent);

        assertEq(token.balanceOf(buyer), 1_500_000);
        assertEq(token.balanceOf(agent), 0);
        assertEq(token.balanceOf(treasury), 0);
        assertEq(token.balanceOf(address(splitter)), 0);
        assertFalse(token.authorizationState(buyer, keccak256(abi.encode(agent, a.salt))));
    }

    function test_immutables() public view {
        assertEq(address(splitter.asset()), address(token));
        assertEq(splitter.treasury(), treasury);
        assertEq(splitter.CREATOR_BPS(), 6500);
    }

    function test_nonceFor() public view {
        bytes32 salt = keccak256("salt");
        assertEq(splitter.nonceFor(agent, salt), keccak256(abi.encode(agent, salt)));

        // Shared vector for the TypeScript gateway's nonce derivation.
        address vectorPayee = 0x000000000000000000000000000000000000dEaD;
        bytes32 vectorSalt = bytes32(uint256(1));
        bytes32 vector = splitter.nonceFor(vectorPayee, vectorSalt);
        console2.log("nonceFor(0x...dEaD, bytes32(uint256(1))):");
        console2.logBytes32(vector);
        assertEq(vector, keccak256(abi.encode(vectorPayee, vectorSalt)));
    }
}
