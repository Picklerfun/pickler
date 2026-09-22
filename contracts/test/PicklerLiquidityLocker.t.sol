// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {RecordingFeeEscrow} from "./mocks/RecordingFeeEscrow.sol";

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";

import {PicklerLiquidityLocker} from "../src/PicklerLiquidityLocker.sol";

/// Records what the locker asks it to do, so the request itself can be asserted. The fork
/// suite proves the real PositionManager honours it; this proves we ask for the right thing
/// even when no chain is available.
contract RecordingPositionManager {
    bytes public lastUnlockData;
    uint256 public callCount;

    function modifyLiquidities(bytes calldata unlockData, uint256) external payable {
        lastUnlockData = unlockData;
        callCount++;
    }
}

contract PicklerLiquidityLockerTest is Test {
    RecordingPositionManager internal positionManager;
    PicklerLiquidityLocker internal locker;

    address internal adapter = makeAddr("adapter");
    address internal feeEscrow;
    address internal token = makeAddr("token");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant TOKEN_ID = 42;

    function setUp() public {
        feeEscrow = address(new RecordingFeeEscrow());

        positionManager = new RecordingPositionManager();
        locker = new PicklerLiquidityLocker(IPositionManager(payable(address(positionManager))), feeEscrow, adapter);

        vm.prank(adapter);
        locker.lockPosition(token, TOKEN_ID, _poolKey());
    }

    function _poolKey() internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0x1111)),
            currency1: Currency.wrap(address(0x2222)),
            fee: 10000,
            tickSpacing: 200,
            hooks: IHooks(address(0))
        });
    }

    function test_onlyTheAdapterCanLockAPosition() public {
        vm.prank(stranger);
        vm.expectRevert(PicklerLiquidityLocker.NotAdapter.selector);
        locker.lockPosition(makeAddr("other"), 7, _poolKey());
    }

    /// A second position for the same launch would make "the locked liquidity" ambiguous.
    function test_aLaunchCanOnlyLockOnce() public {
        vm.prank(adapter);
        vm.expectRevert(PicklerLiquidityLocker.PositionAlreadyLocked.selector);
        locker.lockPosition(token, 43, _poolKey());
    }

    function test_collectingForAnUnknownLaunchReverts() public {
        vm.expectRevert(PicklerLiquidityLocker.NoPositionForLaunch.selector);
        locker.collectFees(makeAddr("unlaunched"));
    }

    /// The locker's entire safety claim, checked on the request it actually builds: the
    /// liquidity it asks to withdraw is zero, and the recipient is the fixed escrow.
    function test_collectionAsksToWithdrawZeroLiquidityAndPaysTheEscrow() public {
        locker.collectFees(token);

        assertEq(positionManager.callCount(), 1, "the position manager was not called");

        (bytes memory actions, bytes[] memory params) = abi.decode(positionManager.lastUnlockData(), (bytes, bytes[]));

        assertEq(
            actions,
            abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR)),
            "collection is not a zero decrease followed by a take"
        );

        (uint256 tokenId, uint256 liquidity, uint128 amount0Min, uint128 amount1Min,) =
            abi.decode(params[0], (uint256, uint256, uint128, uint128, bytes));

        assertEq(tokenId, TOKEN_ID);
        assertEq(liquidity, 0, "the locker asked to withdraw principal");
        assertEq(amount0Min, 0);
        assertEq(amount1Min, 0);

        (,, address recipient) = abi.decode(params[1], (Currency, Currency, address));

        assertEq(recipient, feeEscrow, "fees were directed somewhere other than the escrow");
    }

    /// Anyone may trigger collection: the caller picks nothing, so there is nothing to abuse.
    function test_collectionIsPermissionless() public {
        vm.prank(stranger);
        locker.collectFees(token);

        assertEq(positionManager.callCount(), 1);
    }

    function test_onlyThePositionManagerCanHandItAnNft() public {
        vm.prank(stranger);
        vm.expectRevert(PicklerLiquidityLocker.NotPositionManager.selector);
        locker.onERC721Received(stranger, stranger, 1, "");

        vm.prank(address(positionManager));
        assertEq(
            locker.onERC721Received(address(0), address(0), 1, ""),
            bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"))
        );
    }

    /// The position must not be able to leave. There is no function to send it anywhere, and
    /// no generic call that could be pointed at the position manager to approve it away.
    function test_theLockerExposesNoWayToMoveThePosition() public view {
        bytes4[6] memory forbidden = [
            bytes4(keccak256("transferFrom(address,address,uint256)")),
            bytes4(keccak256("safeTransferFrom(address,address,uint256)")),
            bytes4(keccak256("approve(address,uint256)")),
            bytes4(keccak256("setApprovalForAll(address,bool)")),
            bytes4(keccak256("execute(address,bytes)")),
            bytes4(keccak256("owner()"))
        ];

        bytes memory code = address(locker).code;

        for (uint256 i = 0; i < forbidden.length; i++) {
            assertFalse(_containsSelector(code, forbidden[i]), "the locker exposes a way out");
        }
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
