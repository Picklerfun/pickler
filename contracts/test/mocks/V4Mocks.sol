// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PositionInfo} from "v4-periphery/src/libraries/PositionInfoLibrary.sol";

contract ControlledV4Pool {
    using PoolIdLibrary for PoolKey;
    mapping(bytes32 => uint160) public prices;

    function initialize(PoolKey calldata key, uint160 price) external returns (int24) {
        require(prices[PoolId.unwrap(key.toId())] == 0);
        prices[PoolId.unwrap(key.toId())] = price;
        return 0;
    }
}

contract ControlledV4State {
    address public immutable poolManager;

    constructor(address manager) {
        poolManager = manager;
    }

    function getSlot0(PoolId id) external view returns (uint160, int24, uint24, uint24) {
        return (ControlledV4Pool(poolManager).prices(PoolId.unwrap(id)), 0, 0, 0);
    }
}

contract ControlledV4Permit {
    using SafeERC20 for IERC20;
    mapping(address => mapping(address => mapping(address => uint160))) public allowed;

    function approve(address token, address spender, uint160 amount, uint48) external {
        allowed[msg.sender][token][spender] = amount;
    }

    function transferFrom(address from, address to, uint160 amount, address token) external {
        allowed[from][token][msg.sender] -= amount;
        IERC20(token).safeTransferFrom(from, to, amount);
    }
}

contract ControlledV4Positions {
    using SafeERC20 for IERC20;
    address public immutable poolManager;
    address public immutable permit2;
    uint256 public nextTokenId = 1;
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => PoolKey) private keys;
    mapping(uint256 => uint128) public getPositionLiquidity;
    mapping(uint256 => uint256) public fees0;
    mapping(uint256 => uint256) public fees1;
    uint8 public fault;

    constructor(address pool, address permit) {
        poolManager = pool;
        permit2 = permit;
    }

    function setFault(uint8 value) external {
        fault = value;
    }

    function setFees(uint256 id, uint256 a, uint256 b) external {
        fees0[id] = a;
        fees1[id] = b;
    }

    function getPoolAndPositionInfo(uint256 id) external view returns (PoolKey memory, PositionInfo) {
        return (keys[id], PositionInfo.wrap(0));
    }

    function modifyLiquidities(bytes calldata payload, uint256) external {
        (bytes memory actions, bytes[] memory params) = abi.decode(payload, (bytes, bytes[]));
        if (uint8(actions[0]) == 2) {
            (
                PoolKey memory key,
                int24 lower,
                int24 upper,
                uint256 liquidity,
                uint128 a,
                uint128 b,
                address owner,
                bytes memory hook
            ) = abi.decode(params[0], (PoolKey, int24, int24, uint256, uint128, uint128, address, bytes));
            require(lower < upper && hook.length == 0 && fault != 1);
            uint256 id = nextTokenId++;
            ownerOf[id] = owner;
            keys[id] = key;
            getPositionLiquidity[id] = uint128(liquidity);
            ControlledV4Permit(permit2).transferFrom(msg.sender, address(this), a - 1, Currency.unwrap(key.currency0));
            ControlledV4Permit(permit2).transferFrom(msg.sender, address(this), b - 1, Currency.unwrap(key.currency1));
        } else {
            (uint256 id, uint256 amount,,,) = abi.decode(params[0], (uint256, uint256, uint128, uint128, bytes));
            require(ownerOf[id] == msg.sender && amount == 0);
            (,, address recipient) = abi.decode(params[1], (Currency, Currency, address));
            if (fault == 2) getPositionLiquidity[id]--;
            IERC20(Currency.unwrap(keys[id].currency0)).safeTransfer(recipient, fees0[id]);
            IERC20(Currency.unwrap(keys[id].currency1)).safeTransfer(recipient, fees1[id]);
            fees0[id] = 0;
            fees1[id] = 0;
        }
    }
}
