// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

import {PicklerAgentToken} from "../src/PicklerAgentToken.sol";

contract PicklerAgentTokenTest is Test {
    uint256 internal constant TOTAL_SUPPLY = 1_000e18;

    address internal curve = makeAddr("curve");
    address internal creator = makeAddr("creator");

    PicklerAgentToken internal token;

    function setUp() public {
        token = new PicklerAgentToken("Pickler Agent", "AGENT", TOTAL_SUPPLY, curve);
    }

    function test_theEntireSupplyExistsAtConstructionAndSitsWithTheCurve() public view {
        assertEq(token.totalSupply(), TOTAL_SUPPLY);
        assertEq(token.balanceOf(curve), TOTAL_SUPPLY);
    }

    function test_itIsAnOrdinaryTransferableErc20() public {
        vm.prank(curve);
        token.transfer(creator, 100e18);

        assertEq(token.balanceOf(creator), 100e18);
        assertEq(token.balanceOf(curve), TOTAL_SUPPLY - 100e18);
    }

    /// The token has no mint function at all, so there is no caller to test it with. What can
    /// be tested is that the supply is fixed for good, whoever asks.
    function test_thereIsNoWayToChangeTheSupply() public {
        vm.prank(curve);
        token.transfer(creator, 1e18);

        assertEq(token.totalSupply(), TOTAL_SUPPLY, "a transfer changed the supply");

        // An ERC-20 with no burn keeps supply constant even when tokens are sent nowhere.
        vm.prank(creator);
        token.transfer(address(0xdead), 1e18);

        assertEq(token.totalSupply(), TOTAL_SUPPLY, "supply moved after a burn-like transfer");
    }

    /// No owner, no admin, no pause: nothing on this contract answers to privilege. A launch
    /// whose creator can freeze transfers is not a launch anyone should buy into.
    function test_itExposesNoPrivilegedSurface() public view {
        bytes4[5] memory forbidden = [
            bytes4(keccak256("owner()")),
            bytes4(keccak256("mint(address,uint256)")),
            bytes4(keccak256("burn(uint256)")),
            bytes4(keccak256("pause()")),
            bytes4(keccak256("blacklist(address)"))
        ];

        bytes memory code = address(token).code;

        for (uint256 i = 0; i < forbidden.length; i++) {
            assertFalse(_containsSelector(code, forbidden[i]), "token exposes a privileged selector");
        }
    }

    function test_transferDoesNotTaxOrRebase() public {
        uint256 amount = 123_456_789;

        vm.prank(curve);
        token.transfer(creator, amount);

        // The curve's accounting assumes what it sends is what arrives. Fee-on-transfer and
        // rebasing tokens break that, and this asserts our own token never does.
        assertEq(token.balanceOf(creator), amount, "recipient received a different amount");
    }

    function test_theSupplyCannotBeZero() public {
        vm.expectRevert(PicklerAgentToken.InvalidSupply.selector);

        new PicklerAgentToken("Pickler Agent", "AGENT", 0, curve);
    }

    function test_theSupplyCannotBeStrandedAtTheZeroAddress() public {
        vm.expectRevert(PicklerAgentToken.InvalidRecipient.selector);

        new PicklerAgentToken("Pickler Agent", "AGENT", TOTAL_SUPPLY, address(0));
    }

    function _containsSelector(bytes memory code, bytes4 selector) private pure returns (bool) {
        for (uint256 i = 0; i + 4 <= code.length; i++) {
            if (
                code[i] == selector[0] && code[i + 1] == selector[1] && code[i + 2] == selector[2]
                    && code[i + 3] == selector[3]
            ) {
                return true;
            }
        }

        return false;
    }
}
