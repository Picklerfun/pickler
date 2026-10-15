// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IKuruOrderBook} from "../../src/interfaces/IKuruPassive.sol";

/// @dev Controlled atomic-unit model, not Kuru's implementation. No remote acceptance implied.
contract ControlledAccountCore {
    using SafeERC20 for IERC20;
    mapping(address => uint40) public ids;
    mapping(uint40 => address) public getAccountOwner;
    mapping(uint40 => mapping(address => uint256)) public getBalance;
    mapping(uint40 => mapping(address => uint256)) public getSpotReservedBalance;
    mapping(address => uint8) public getSpotTokenDecimals;
    mapping(address => bool) public spotTokenEnabled;
    mapping(address => bool) public markets;
    bool public corruptOnWithdraw;

    function setCorruptOnWithdraw(bool value) external {
        corruptOnWithdraw = value;
    }
    uint40 private nextId = 1;

    function admit(address token, uint8 decimals) external {
        spotTokenEnabled[token] = true;
        getSpotTokenDecimals[token] = decimals;
    }

    function admitMarket(address market) external {
        markets[market] = true;
    }

    function ensureRootAccount(address owner) external returns (uint40 id) {
        id = ids[owner];
        if (id == 0) id = nextId++;
        ids[owner] = id;
        getAccountOwner[id] = owner;
    }

    function deposit(address owner, address token, uint256 amount) external payable {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        getBalance[ids[owner]][token] += amount;
    }

    function withdraw(uint40 id, address token, uint256 amount, address recipient) external {
        require(getAccountOwner[id] == msg.sender, "owner");
        getBalance[id][token] -= amount;
        if (corruptOnWithdraw) getSpotReservedBalance[id][token]--;
        IERC20(token).safeTransfer(recipient, amount);
    }

    function reserve(uint40 id, address token, uint256 amount) external {
        require(markets[msg.sender], "market");
        getBalance[id][token] -= amount;
        getSpotReservedBalance[id][token] += amount;
    }

    function credit(uint40 id, address token, uint256 amount) external {
        require(markets[msg.sender], "market");
        getBalance[id][token] += amount;
    }

    function corruptReserved(uint40 id, address token) external {
        require(markets[msg.sender], "market");
        getSpotReservedBalance[id][token]--;
    }
}

contract ControlledPassiveMarket {
    ControlledAccountCore public immutable accountCore;
    address public immutable baseToken;
    address public immutable quoteToken;
    uint96 public immutable sizePrecision;
    uint32 public immutable pricePrecision;
    uint32 public immutable tickSize;
    uint32 public immutable passiveSpreadTicks;
    uint96 public immutable minQuoteNotional;
    uint96 public immutable maxQuoteNotional;
    uint256 public immutable takerFeePps;
    uint256 public immutable makerFeePps;
    mapping(uint64 => IKuruOrderBook.Position) private positions;
    mapping(uint64 => uint128) public baseFees;
    mapping(uint64 => uint128) public quoteFees;
    uint64 private nextId = 1;
    uint8 public fault;

    constructor(
        ControlledAccountCore core,
        address base,
        address quote,
        uint96 size,
        uint32 price,
        uint32 tick,
        uint32 spread,
        uint96 min_,
        uint96 max_,
        uint256 taker,
        uint256 maker
    ) {
        accountCore = core;
        baseToken = base;
        quoteToken = quote;
        sizePrecision = size;
        pricePrecision = price;
        tickSize = tick;
        passiveSpreadTicks = spread;
        minQuoteNotional = min_;
        maxQuoteNotional = max_;
        takerFeePps = taker;
        makerFeePps = maker;
    }

    function setFault(uint8 value) external {
        fault = value;
    }

    function setFees(uint64 id, uint128 base, uint128 quote) external {
        baseFees[id] = base;
        quoteFees[id] = quote;
    }

    function getPassivePosition(uint64 id) external view returns (IKuruOrderBook.Position memory) {
        return positions[id];
    }

    function mintPassiveLiquidity(
        uint40 ownerId,
        uint32 low,
        uint128 base,
        uint128 quote,
        uint128 minShares,
        uint64 deadline
    ) external returns (uint64 id, uint128 shares) {
        require(deadline >= block.timestamp && accountCore.getAccountOwner(ownerId) == msg.sender, "owner/deadline");
        require(fault != 1, "mint failed");
        id = nextId++;
        shares = minShares + 1;
        positions[id] = IKuruOrderBook.Position(ownerId, low, low + passiveSpreadTicks * tickSize, shares, 0, 0);
        // Deliberately leave one quarter unallocated to test permanent remainder custody.
        accountCore.reserve(ownerId, baseToken, base - base / 4);
        accountCore.reserve(ownerId, quoteToken, quote - quote / 4);
        if (fault == 2) positions[id].ownerId++;
    }

    function claimPassiveFees(uint40 ownerId, uint64 id) external returns (uint128 b, uint128 q) {
        require(positions[id].ownerId == ownerId && accountCore.getAccountOwner(ownerId) == msg.sender, "owner");
        b = baseFees[id];
        q = quoteFees[id];
        baseFees[id] = 0;
        quoteFees[id] = 0;
        accountCore.credit(ownerId, baseToken, b);
        accountCore.credit(ownerId, quoteToken, q);
        if (fault == 3) positions[id].shares++;
        if (fault == 4) accountCore.corruptReserved(ownerId, quoteToken);
        if (fault == 5) q++;
    }
}

contract ControlledSpotRouter {
    address public immutable spotBalanceAccountAddress;
    mapping(address => bool) public verifiedSpotMarket;
    uint8 public fault;

    constructor(ControlledAccountCore core) {
        spotBalanceAccountAddress = address(core);
    }

    function setFault(uint8 value) external {
        fault = value;
    }

    function deploySpotMarket(
        address base,
        address quote,
        uint96 size,
        uint32 price,
        uint32 tick,
        uint32 spread,
        uint96 min_,
        uint96 max_,
        uint256 taker,
        uint256 maker
    ) external returns (address market) {
        market = address(
            new ControlledPassiveMarket(
                ControlledAccountCore(spotBalanceAccountAddress),
                base,
                quote,
                size,
                price,
                fault == 6 ? tick + 1 : tick,
                spread,
                min_,
                max_,
                taker,
                maker
            )
        );
        verifiedSpotMarket[market] = fault != 7;
        ControlledAccountCore(spotBalanceAccountAddress).admitMarket(market);
        ControlledPassiveMarket(market).setFault(fault);
    }
}
