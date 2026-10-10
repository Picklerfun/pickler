// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IKuruAccountCore, IKuruOrderBook} from "./interfaces/IKuruPassive.sol";
import {PicklerKuruPolicy} from "./libraries/PicklerKuruPolicy.sol";
import {PicklerKuruPositionVault} from "./PicklerKuruPositionVault.sol";
import {PicklerFeeEscrowV2} from "./PicklerFeeEscrowV2.sol";

/// @notice Fixed custody. Every launch has a separate account; only verified fees can leave.
/// @dev No withdrawal, position transfer, delegation, rescue, arbitrary call or upgrade.
contract PicklerKuruLiquidityLocker is ReentrancyGuard {
    using SafeERC20 for IERC20;
    error NotAdapter();
    error InvalidLaunch();
    error InvalidReceipt();
    address public immutable adapter;
    IKuruAccountCore public immutable accountCore;
    PicklerFeeEscrowV2 public immutable escrow;
    mapping(address token => PicklerKuruPositionVault) public vaults;

    event PositionsLocked(address indexed token, address indexed market, address indexed vault, uint40 accountId);
    event PassiveFeesCollected(address indexed token, uint256 baseFees, uint256 quoteFees);

    constructor(address adapter_, IKuruAccountCore core_, PicklerFeeEscrowV2 escrow_) {
        adapter = adapter_;
        accountCore = core_;
        escrow = escrow_;
    }

    function lockPositions(
        address token,
        IKuruOrderBook market,
        PicklerKuruPolicy.Config calldata config,
        uint32 center,
        uint256 base,
        uint256 quote
    ) external nonReentrant returns (PicklerKuruPositionVault vault) {
        if (msg.sender != adapter) revert NotAdapter();
        if (address(vaults[token]) != address(0)) revert InvalidLaunch();
        vault = new PicklerKuruPositionVault(accountCore, market, token, config.quoteToken);
        vaults[token] = vault;
        _fund(token, address(vault), base);
        _fund(config.quoteToken, address(vault), quote);
        vault.seed(config, center, base, quote);
        emit PositionsLocked(token, address(market), address(vault), vault.accountId());
    }

    function _fund(address asset, address vault, uint256 amount) private {
        uint256 before = IERC20(asset).balanceOf(vault);
        IERC20(asset).safeTransferFrom(adapter, vault, amount);
        if (IERC20(asset).balanceOf(vault) != before + amount) revert InvalidReceipt();
    }

    /// @notice Permissionless collection into the escrow; recipient and split cannot be supplied.
    function collectFees(address token) external nonReentrant returns (uint256 baseFees, uint256 quoteFees) {
        PicklerKuruPositionVault vault = vaults[token];
        if (address(vault) == address(0)) revert InvalidLaunch();
        address quote = vault.quoteToken();
        uint256 beforeBase = IERC20(token).balanceOf(address(this));
        uint256 beforeQuote = IERC20(quote).balanceOf(address(this));
        (baseFees, quoteFees) = vault.collectFees();
        if (
            IERC20(token).balanceOf(address(this)) != beforeBase + baseFees
                || IERC20(quote).balanceOf(address(this)) != beforeQuote + quoteFees
        ) revert InvalidReceipt();
        _remit(token, token, baseFees);
        _remit(token, quote, quoteFees);
        emit PassiveFeesCollected(token, baseFees, quoteFees);
    }

    function _remit(address token, address asset, uint256 amount) private {
        if (amount == 0) return;
        IERC20(asset).forceApprove(address(escrow), amount);
        escrow.receivePoolFees(token, asset, amount);
        IERC20(asset).forceApprove(address(escrow), 0);
    }
}
