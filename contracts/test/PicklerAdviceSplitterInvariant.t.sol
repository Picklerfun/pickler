// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {PicklerAdviceSplitter} from "../src/PicklerAdviceSplitter.sol";
import {MockEip3009Token} from "./mocks/MockEip3009Token.sol";

/// Settles signed payments through the splitter in whatever order and amounts the fuzzer picks,
/// including payees the splitter refuses. It never sends the splitter a plain transfer: spec S4
/// leaves such tokens stranded, so the invariant is about what `settle` itself leaves behind.
contract SplitterSettler is Test {
    PicklerAdviceSplitter public immutable SPLITTER;
    MockEip3009Token public immutable TOKEN;
    address public immutable TREASURY;

    uint256 internal constant BUYER_KEY = 0xB0B;
    uint256 internal constant MAX_VALUE = 1_000_000_000e6;

    address public immutable BUYER;

    address[3] internal agents;

    uint256 public settlesFilled;
    uint256 public refused;
    uint256 public paid;
    uint256 public toAgents;
    uint256 internal salts;

    constructor(PicklerAdviceSplitter splitter_, MockEip3009Token token_, address treasury_) {
        SPLITTER = splitter_;
        TOKEN = token_;
        TREASURY = treasury_;
        BUYER = vm.addr(BUYER_KEY);

        agents[0] = makeAddr("agentA");
        agents[1] = makeAddr("agentB");
        agents[2] = makeAddr("agentC");
    }

    function agentBalances() external view returns (uint256 total) {
        for (uint256 index = 0; index < agents.length; index++) {
            total += TOKEN.balanceOf(agents[index]);
        }
    }

    /// One payment to a valid agent wallet.
    function settle(uint256 value, uint256 agentIndex) external {
        value = bound(value, 0, MAX_VALUE);
        address payee = agents[agentIndex % agents.length];

        if (_settle(value, payee)) {
            settlesFilled++;
            paid += value;
        }
    }

    /// A payment signed for a payee the splitter must refuse: zero, itself or the treasury.
    function settleRefused(uint256 value, uint256 choice) external {
        value = bound(value, 0, MAX_VALUE);
        address[3] memory refusedPayees = [address(0), address(SPLITTER), TREASURY];
        address payee = refusedPayees[choice % refusedPayees.length];

        if (!_settle(value, payee)) {
            refused++;
        }
    }

    struct Signed {
        uint256 validAfter;
        uint256 validBefore;
        bytes32 salt;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    function _sign(uint256 value, address payee) internal returns (Signed memory a) {
        a.validAfter = block.timestamp - 1;
        a.validBefore = block.timestamp + 300;
        a.salt = bytes32(++salts);

        bytes32 nonce = SPLITTER.nonceFor(payee, a.salt);
        bytes32 structHash = keccak256(
            abi.encode(
                TOKEN.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                BUYER,
                address(SPLITTER),
                value,
                a.validAfter,
                a.validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", TOKEN.DOMAIN_SEPARATOR(), structHash));

        (a.v, a.r, a.s) = vm.sign(BUYER_KEY, digest);
    }

    function _settle(uint256 value, address payee) internal returns (bool) {
        TOKEN.mint(BUYER, value);
        Signed memory a = _sign(value, payee);

        try SPLITTER.settle(BUYER, value, a.validAfter, a.validBefore, a.salt, payee, a.v, a.r, a.s) returns (
            uint256 creatorAmount, uint256
        ) {
            toAgents += creatorAmount;
            return true;
        } catch {
            return false;
        }
    }
}

contract PicklerAdviceSplitterInvariantTest is Test {
    MockEip3009Token internal token;
    PicklerAdviceSplitter internal splitter;
    SplitterSettler internal settler;

    address internal treasury = makeAddr("treasury");

    function setUp() public {
        vm.warp(1_800_000_000);

        token = new MockEip3009Token();
        splitter = new PicklerAdviceSplitter(address(token), treasury);
        settler = new SplitterSettler(splitter, token, treasury);

        targetContract(address(settler));
    }

    /// Guards against the suite passing because nothing happened: a handler whose every settle
    /// reverted into its try/catch would satisfy every invariant below.
    function afterInvariant() public view {
        assertGt(settler.settlesFilled(), 0, "no settle ever filled; the invariants proved nothing");
        assertGt(settler.refused(), 0, "no refused payee was ever tried");
    }

    /// The splitter retains nothing: every unit a settle receives leaves in the same call.
    function invariant_theSplitterHoldsNoAusd() public view {
        assertEq(token.balanceOf(address(splitter)), 0);
    }

    /// Everything paid reached the agents and the treasury, and the agents got exactly their shares.
    function invariant_everyPaymentReachesTheAgentsAndTheTreasury() public view {
        assertEq(settler.agentBalances(), settler.toAgents());
        assertEq(settler.agentBalances() + token.balanceOf(treasury), settler.paid());
    }
}
