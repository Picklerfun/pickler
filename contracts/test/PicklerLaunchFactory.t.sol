// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {LaunchGrantTest} from "./LaunchGrantTest.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

import {PicklerLaunchFactory} from "../src/PicklerLaunchFactory.sol";
import {PicklerPreset} from "../src/libraries/PicklerPreset.sol";
import {PicklerCurveMath} from "../src/libraries/PicklerCurveMath.sol";
import {ICurveDeployer} from "../src/interfaces/ICurveDeployer.sol";

/// Stands in for A3's curve. The factory must not care what a curve is beyond where to send
/// the supply, which is exactly what a stub proves.
contract StubCurveDeployer is ICurveDeployer {
    address public lastToken;

    function deployCurve(address token, PicklerPreset.LaunchPreset calldata) external returns (address curve) {
        lastToken = token;

        return address(new StubCurve());
    }
}

contract StubCurve {}

/// A minimal ERC-1271 wallet: creators on smart accounts have no private key to sign with,
/// so the factory has to accept a contract's own verdict on its signatures.
contract SmartWallet {
    address private immutable SIGNER;

    constructor(address signer_) {
        SIGNER = signer_;
    }

    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        (bytes32 r, bytes32 s) = (bytes32(signature[0:32]), bytes32(signature[32:64]));
        uint8 v = uint8(signature[64]);

        return ecrecover(digest, v, r, s) == SIGNER ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

contract PicklerLaunchFactoryTest is LaunchGrantTest {
    PicklerLaunchFactory internal factory;
    StubCurveDeployer internal curveDeployer;

    address internal operator = makeAddr("operator");
    address internal quoteToken = makeAddr("quoteToken");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal sponsor = makeAddr("sponsor");
    address internal stranger = makeAddr("stranger");

    uint256 internal creatorKey = 0xA11CE;
    address internal creator;

    bytes32 internal constant AGENT_KEY = keccak256("creator-namespace/agent-1");

    function setUp() public {
        creator = vm.addr(creatorKey);
        curveDeployer = new StubCurveDeployer();

        vm.prank(operator);
        factory = new PicklerLaunchFactory(operator, curveDeployer, vm.addr(PLATFORM_KEY));

        vm.prank(operator);
        factory.publishPreset(_preset());
    }

    function _preset() internal view returns (PicklerPreset.LaunchPreset memory preset) {
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

    function _params() internal view returns (PicklerLaunchFactory.LaunchParams memory) {
        return PicklerLaunchFactory.LaunchParams({
            agentKey: AGENT_KEY,
            creator: creator,
            creatorFeeRecipient: feeRecipient,
            name: "Pickler Agent",
            symbol: "AGENT",
            metadataURI: "ipfs://agent",
            metadataHash: keccak256("metadata"),
            presetId: 1,
            presetVersion: 1,
            expectedConfigHash: PicklerPreset.configHash(_preset()),
            nonce: 0,
            deadline: block.timestamp + 5 minutes
        });
    }

    function _sign(PicklerLaunchFactory.LaunchParams memory params, uint256 key) internal view returns (bytes memory) {
        bytes32 digest = factory.authorizationDigest(params);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);

        return abi.encodePacked(r, s, v);
    }

    function _grant(PicklerLaunchFactory.LaunchParams memory params, uint256 key, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 sigS) = vm.sign(key, factory.grantDigest(params, nonce, deadline));
        return abi.encodePacked(r, sigS, v);
    }

    function testFuzz_allGrantParametersAreBound(uint8 changed) public {
        changed = uint8(bound(changed, 0, 9));
        PicklerLaunchFactory.LaunchParams memory params = _params();
        bytes memory grant = _grant(params, PLATFORM_KEY, 1, params.deadline);
        uint256 deadline = params.deadline;
        if (changed == 0) params.symbol = "OTHER";
        if (changed == 1) params.metadataURI = "ipfs://other";
        if (changed == 2) params.metadataHash = keccak256("other");
        if (changed == 3) params.presetId = 2;
        if (changed == 4) params.presetVersion = 2;
        if (changed == 5) params.expectedConfigHash = keccak256("other-config");
        if (changed == 6) params.nonce = 2;
        if (changed == 7) params.deadline -= 1;
        if (changed == 8) params.creatorFeeRecipient = sponsor;
        if (changed == 9) params.agentKey = keccak256("other-agent");
        vm.prank(creator);
        vm.expectRevert(PicklerLaunchFactory.InvalidGrant.selector);
        factory.createLaunch(params, "", 1, deadline, grant);
    }

    function test_directCreatorCannotUseExpiredCreatorParameters() public {
        PicklerLaunchFactory.LaunchParams memory params = _params();
        params.deadline = block.timestamp - 1;
        uint256 deadline = block.timestamp + 300;
        bytes memory grant = _grant(params, PLATFORM_KEY, 1, deadline);
        vm.prank(creator);
        vm.expectRevert(PicklerLaunchFactory.AuthorizationExpired.selector);
        factory.createLaunch(params, "", 1, deadline, grant);
    }

    function test_directCreatorStillRequiresPicklerGrant() public {
        PicklerLaunchFactory.LaunchParams memory params = _params();
        vm.prank(creator);
        vm.expectRevert(PicklerLaunchFactory.InvalidGrant.selector);
        factory.createLaunch(params, "", 1, params.deadline, "");
    }

    function test_alteredParametersRejectPlatformGrant() public {
        PicklerLaunchFactory.LaunchParams memory params = _params();
        bytes memory grant = _grant(params, PLATFORM_KEY, 1, params.deadline);
        params.name = "Changed";
        vm.prank(creator);
        vm.expectRevert(PicklerLaunchFactory.InvalidGrant.selector);
        factory.createLaunch(params, "", 1, params.deadline, grant);
    }

    function test_differentWalletRejectsPlatformGrant() public {
        PicklerLaunchFactory.LaunchParams memory params = _params();
        bytes memory grant = _grant(params, PLATFORM_KEY, 1, params.deadline);
        params.creator = sponsor;
        vm.prank(sponsor);
        vm.expectRevert(PicklerLaunchFactory.InvalidGrant.selector);
        factory.createLaunch(params, "", 1, params.deadline, grant);
    }

    function test_differentNetworkRejectsPlatformGrant() public {
        PicklerLaunchFactory.LaunchParams memory params = _params();
        bytes memory grant = _grant(params, PLATFORM_KEY, 1, params.deadline);
        vm.chainId(block.chainid + 1);
        vm.prank(creator);
        vm.expectRevert(PicklerLaunchFactory.InvalidGrant.selector);
        factory.createLaunch(params, "", 1, params.deadline, grant);
    }

    function test_differentFactoryRejectsPlatformGrant() public {
        PicklerLaunchFactory.LaunchParams memory params = _params();
        bytes memory grant = _grant(params, PLATFORM_KEY, 1, params.deadline);
        PicklerLaunchFactory other = new PicklerLaunchFactory(operator, curveDeployer, vm.addr(PLATFORM_KEY));
        vm.prank(creator);
        vm.expectRevert(PicklerLaunchFactory.InvalidGrant.selector);
        other.createLaunch(params, "", 1, params.deadline, grant);
    }

    function test_authorityRotationInvalidatesOldGrant() public {
        PicklerLaunchFactory.LaunchParams memory params = _params();
        bytes memory oldGrant = _grant(params, PLATFORM_KEY, 1, params.deadline);
        vm.prank(operator);
        factory.setLaunchAuthority(vm.addr(0x12345));
        vm.prank(creator);
        vm.expectRevert(PicklerLaunchFactory.InvalidGrant.selector);
        factory.createLaunch(params, "", 1, params.deadline, oldGrant);
        bytes memory nextGrant = _grant(params, 0x12345, 1, params.deadline);
        vm.prank(creator);
        factory.createLaunch(params, "", 1, params.deadline, nextGrant);
    }

    function test_grantNonceCannotBeReusedForAnotherAgent() public {
        PicklerLaunchFactory.LaunchParams memory params = _params();
        bytes memory grant = _grant(params, PLATFORM_KEY, 1, params.deadline);
        vm.prank(creator);
        factory.createLaunch(params, "", 1, params.deadline, grant);
        params.agentKey = keccak256("second-agent");
        params.nonce = 1;
        bytes memory second = _grant(params, PLATFORM_KEY, 1, params.deadline);
        vm.prank(creator);
        vm.expectRevert(PicklerLaunchFactory.GrantAlreadyUsed.selector);
        factory.createLaunch(params, "", 1, params.deadline, second);
    }

    function test_platformGrantCannotLastLongerThanFiveMinutes() public {
        PicklerLaunchFactory.LaunchParams memory params = _params();
        uint256 deadline = block.timestamp + 301;
        bytes memory grant = _grant(params, PLATFORM_KEY, 1, deadline);
        vm.prank(creator);
        vm.expectRevert(PicklerLaunchFactory.GrantTooLong.selector);
        factory.createLaunch(params, "", 1, deadline, grant);
    }

    function test_failedCreatorAuthorizationDoesNotConsumeGrant() public {
        PicklerLaunchFactory.LaunchParams memory params = _params();
        bytes memory grant = _grant(params, PLATFORM_KEY, 1, params.deadline);
        vm.prank(sponsor);
        vm.expectRevert(PicklerLaunchFactory.InvalidAuthorization.selector);
        factory.createLaunch(params, "", 1, params.deadline, grant);
        assertFalse(factory.grantUsed(1));
        vm.prank(creator);
        factory.createLaunch(params, "", 1, params.deadline, grant);
    }

    function test_theCreatorCanLaunchDirectly() public {
        vm.prank(creator);
        (address token, address curve) = factory.createLaunch(
            _params(), "", uint256(_params().agentKey), _params().deadline, _platformGrant(factory, _params())
        );

        assertTrue(token != address(0), "no token");
        assertTrue(curve != address(0), "no curve");
    }

    /// The whole sale inventory has to end up on the curve, and none of it may stay behind.
    function test_theEntireSupplyLandsOnTheCurve() public {
        vm.prank(creator);
        (address token, address curve) = factory.createLaunch(
            _params(), "", uint256(_params().agentKey), _params().deadline, _platformGrant(factory, _params())
        );

        assertEq(IERC20(token).balanceOf(curve), 1_000e18, "curve did not receive the supply");
        assertEq(IERC20(token).balanceOf(address(factory)), 0, "factory kept some of the supply");
        assertEq(IERC20(token).totalSupply(), 1_000e18);
    }

    /// A sponsor may pay the gas. That must not make the sponsor the creator.
    function test_aSponsorMaySubmitButDoesNotBecomeTheCreator() public {
        PicklerLaunchFactory.LaunchParams memory params = _params();
        bytes memory authorization = _sign(params, creatorKey);

        vm.prank(sponsor);
        (address token,) = factory.createLaunch(
            params, authorization, uint256(params.agentKey), params.deadline, _platformGrant(factory, params)
        );

        PicklerLaunchFactory.LaunchRecord memory record = factory.getLaunch(token);

        assertEq(record.creator, creator, "sponsor was recorded as the creator");
    }

    /// Resubmitting the exact authorization that already created a launch.
    function test_theSameAuthorizationCannotBeSubmittedTwice() public {
        PicklerLaunchFactory.LaunchParams memory params = _params();
        bytes memory authorization = _sign(params, creatorKey);

        vm.prank(sponsor);
        factory.createLaunch(
            params, authorization, uint256(params.agentKey), params.deadline, _platformGrant(factory, params)
        );

        vm.prank(sponsor);
        vm.expectRevert(PicklerLaunchFactory.AgentAlreadyLaunched.selector);
        factory.createLaunch(
            params, authorization, uint256(params.agentKey), params.deadline, _platformGrant(factory, params)
        );
    }

    /// A spent nonce cannot authorize a different launch either, even freshly signed. Without
    /// this, one authorization the creator issued would license launches indefinitely.
    function test_aSpentNonceCannotAuthorizeASecondLaunch() public {
        PicklerLaunchFactory.LaunchParams memory params = _params();

        vm.prank(sponsor);
        factory.createLaunch(
            params,
            _sign(params, creatorKey),
            uint256(params.agentKey),
            params.deadline,
            _platformGrant(factory, params)
        );

        PicklerLaunchFactory.LaunchParams memory second = _params();
        second.agentKey = keccak256("creator-namespace/agent-2");
        // Signed before the prank: signing reads the factory, and a call made between
        // expectRevert and the call under test would satisfy the expectation instead.
        bytes memory reusedNonce = _sign(second, creatorKey);

        vm.prank(sponsor);
        vm.expectRevert(PicklerLaunchFactory.AuthorizationAlreadyUsed.selector);
        factory.createLaunch(
            second, reusedNonce, uint256(second.agentKey), second.deadline, _platformGrant(factory, second)
        );
    }

    function test_aSmartWalletCreatorCanAuthorizeALaunch() public {
        SmartWallet wallet = new SmartWallet(creator);

        PicklerLaunchFactory.LaunchParams memory params = _params();
        params.creator = address(wallet);

        bytes memory authorization = _sign(params, creatorKey);

        vm.prank(sponsor);
        (address token,) = factory.createLaunch(
            params, authorization, uint256(params.agentKey), params.deadline, _platformGrant(factory, params)
        );

        assertEq(factory.getLaunch(token).creator, address(wallet), "smart wallet was not recorded as creator");
    }

    function test_aSmartWalletRejectingASignatureBlocksTheLaunch() public {
        SmartWallet wallet = new SmartWallet(creator);

        PicklerLaunchFactory.LaunchParams memory params = _params();
        params.creator = address(wallet);

        bytes memory signedByStranger = _sign(params, 0xB0B);

        vm.prank(sponsor);
        vm.expectRevert(PicklerLaunchFactory.InvalidAuthorization.selector);
        factory.createLaunch(
            params, signedByStranger, uint256(params.agentKey), params.deadline, _platformGrant(factory, params)
        );
    }

    /// Signing for someone else's agent key must not work, or anyone could squat an identity.
    function test_aStrangerCannotLaunchAnotherCreatorsAgent() public {
        PicklerLaunchFactory.LaunchParams memory params = _params();
        uint256 strangerKey = 0xB0B;

        bytes memory forged = _sign(params, strangerKey);

        vm.prank(stranger);
        vm.expectRevert(PicklerLaunchFactory.InvalidAuthorization.selector);
        factory.createLaunch(params, forged, uint256(params.agentKey), params.deadline, _platformGrant(factory, params));
    }

    /// A signature produced for another chain must not be valid here.
    function test_anAuthorizationFromAnotherChainIsRejected() public {
        PicklerLaunchFactory.LaunchParams memory params = _params();

        uint256 originalChainId = block.chainid;
        vm.chainId(originalChainId + 1);
        bytes32 foreignDigest = factory.authorizationDigest(params);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(creatorKey, foreignDigest);
        vm.chainId(originalChainId);

        vm.prank(sponsor);
        vm.expectRevert(PicklerLaunchFactory.InvalidAuthorization.selector);
        factory.createLaunch(
            params,
            abi.encodePacked(r, s, v),
            uint256(params.agentKey),
            params.deadline,
            _platformGrant(factory, params)
        );
    }

    function test_anExpiredAuthorizationIsRejected() public {
        PicklerLaunchFactory.LaunchParams memory params = _params();
        bytes memory authorization = _sign(params, creatorKey);

        vm.warp(params.deadline + 1);

        vm.prank(sponsor);
        vm.expectRevert(PicklerLaunchFactory.GrantExpired.selector);
        factory.createLaunch(
            params, authorization, uint256(params.agentKey), params.deadline, _platformGrant(factory, params)
        );
    }

    /// One canonical token per agent per factory. A second launch is not a new market.
    function test_anAgentKeyCanOnlyLaunchOnce() public {
        vm.prank(creator);
        factory.createLaunch(
            _params(), "", uint256(_params().agentKey), _params().deadline, _platformGrant(factory, _params())
        );

        PicklerLaunchFactory.LaunchParams memory second = _params();
        second.nonce = 1;

        vm.prank(creator);
        vm.expectRevert(PicklerLaunchFactory.AgentAlreadyLaunched.selector);
        factory.createLaunch(second, "", uint256(second.agentKey), second.deadline, _platformGrant(factory, second));
    }

    /// A launch commits to the exact economics the caller reviewed.
    function test_aPresetChangedUnderTheCallerIsRejected() public {
        PicklerLaunchFactory.LaunchParams memory params = _params();
        params.expectedConfigHash = keccak256("something else");

        vm.prank(creator);
        vm.expectRevert(PicklerLaunchFactory.ConfigChanged.selector);
        factory.createLaunch(params, "", uint256(params.agentKey), params.deadline, _platformGrant(factory, params));
    }

    function test_onlyTheOperatorPublishesPresets() public {
        PicklerPreset.LaunchPreset memory preset = _preset();
        preset.version = 2;

        vm.prank(stranger);
        vm.expectRevert(PicklerLaunchFactory.NotOperator.selector);
        factory.publishPreset(preset);
    }

    /// An operator may publish new versions but may never rewrite one a launch may point at.
    function test_aPublishedPresetIsImmutable() public {
        PicklerPreset.LaunchPreset memory rewritten = _preset();
        rewritten.buyFeeBps = 400;

        vm.prank(operator);
        vm.expectRevert(PicklerLaunchFactory.PresetAlreadyPublished.selector);
        factory.publishPreset(rewritten);
    }

    function test_theOperatorCanSuspendNewLaunchesOnly() public {
        vm.prank(operator);
        factory.setLaunchesEnabled(false);

        vm.prank(creator);
        vm.expectRevert(PicklerLaunchFactory.LaunchesSuspended.selector);
        factory.createLaunch(
            _params(), "", uint256(_params().agentKey), _params().deadline, _platformGrant(factory, _params())
        );
    }

    /// Suspension must not reach a launch that already exists. Nothing here can stop trading.
    function test_suspensionDoesNotTouchAnExistingLaunch() public {
        vm.prank(creator);
        (address token, address curve) = factory.createLaunch(
            _params(), "", uint256(_params().agentKey), _params().deadline, _platformGrant(factory, _params())
        );

        vm.prank(operator);
        factory.setLaunchesEnabled(false);

        assertEq(IERC20(token).balanceOf(curve), 1_000e18, "an existing launch was disturbed");

        vm.prank(curve);
        assertTrue(IERC20(token).transfer(stranger, 1e18), "transfer returned false");

        assertEq(IERC20(token).balanceOf(stranger), 1e18, "suspension blocked an existing token transfer");
    }

    function test_theLaunchRecordIsResolvableBothWays() public {
        vm.prank(creator);
        (address token, address curve) = factory.createLaunch(
            _params(), "", uint256(_params().agentKey), _params().deadline, _platformGrant(factory, _params())
        );

        PicklerLaunchFactory.LaunchRecord memory record = factory.getLaunch(token);

        assertEq(record.token, token);
        assertEq(record.curve, curve);
        assertEq(record.agentKey, AGENT_KEY);
        assertEq(record.quoteToken, quoteToken);
        assertEq(record.creatorFeeRecipient, feeRecipient);
        assertEq(record.presetHash, PicklerPreset.configHash(_preset()));
        assertEq(factory.tokenForAgent(AGENT_KEY), token);
    }

    /// Deployment has to fit in a block alongside everything else in the transaction.
    function test_launchGasStaysWithinABlock() public {
        vm.prank(creator);

        uint256 before = gasleft();
        factory.createLaunch(
            _params(), "", uint256(_params().agentKey), _params().deadline, _platformGrant(factory, _params())
        );
        uint256 used = before - gasleft();

        assertLt(used, 5_000_000, "a launch costs more gas than intended");
        emit log_named_uint("launch gas", used);
    }

    function test_theFactoryFitsUnderTheContractSizeLimit() public view {
        uint256 contractSizeLimit = 24576;

        assertLt(address(factory).code.length, contractSizeLimit, "factory exceeds the contract size limit");
    }
}
