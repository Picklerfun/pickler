// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PicklerFeeEscrow} from "./PicklerFeeEscrow.sol";
import {PicklerLaunchFactory} from "./PicklerLaunchFactory.sol";
import {PicklerBondingCurve} from "./PicklerBondingCurve.sol";
import {PicklerPreset} from "./libraries/PicklerPreset.sol";

interface IKuruEscrowDeployerBinding {
    function feeEscrow() external view returns (address);
    function graduationAdapter() external view returns (address);
}

interface IKuruEscrowLockerBinding {
    function escrow() external view returns (address);
    function adapter() external view returns (address);
}

interface IKuruEscrowAdapterBinding {
    function escrow() external view returns (address);
    function locker() external view returns (address);
}

/// @notice Exact per-launch fee attribution. Donations never become someone else's revenue.
/// @dev New deployments only; historical escrows retain their original accounting.
contract PicklerFeeEscrowV2 is PicklerFeeEscrow {
    using SafeERC20 for IERC20;
    error InvalidAsset();
    error InvalidReceipt();
    error ExactReceiptRequired();
    mapping(address launchToken => uint256) public recordedRemittances;

    constructor(address treasury_) PicklerFeeEscrow(treasury_) {
        if (treasury_ == address(0)) revert InvalidRecipient();
    }

    function initialize(PicklerLaunchFactory factory_, address locker_) external override {
        if (msg.sender != deployer) revert NotDeployer();
        if (address(factory) != address(0)) revert AlreadyInitialized();
        IKuruEscrowDeployerBinding d = IKuruEscrowDeployerBinding(address(factory_.curveDeployer()));
        address a = d.graduationAdapter();
        if (
            d.feeEscrow() != address(this) || IKuruEscrowAdapterBinding(a).escrow() != address(this)
                || IKuruEscrowAdapterBinding(a).locker() != locker_ || IKuruEscrowLockerBinding(locker_).adapter() != a
                || IKuruEscrowLockerBinding(locker_).escrow() != address(this)
        ) revert InvalidReceipt();
        factory = factory_;
        locker = locker_;
    }

    function syncCurveFees(address launchToken, address asset) external override nonReentrant {
        PicklerLaunchFactory.LaunchRecord memory record = _requireLaunch(launchToken);
        if (msg.sender != record.curve) revert NotTheLaunchCurve();
        if (asset != record.quoteToken) revert InvalidAsset();
        uint256 total = PicklerBondingCurve(record.curve).totalFeesRemitted();
        uint256 received = total - recordedRemittances[launchToken];
        recordedRemittances[launchToken] = total;
        if (IERC20(asset).balanceOf(address(this)) < accounted[asset] + received) revert InvalidReceipt();
        PicklerPreset.LaunchPreset memory preset = PicklerBondingCurve(record.curve).preset();
        _credit(launchToken, asset, record.creatorFeeRecipient, preset.protocolShareBps, FeeSource.CURVE, received);
    }

    function syncPoolFees(address, address) external pure override {
        revert ExactReceiptRequired();
    }

    /// @notice Pulls precisely the verified fee receipt from the fixed locker.
    function receivePoolFees(address launchToken, address asset, uint256 amount) external nonReentrant {
        if (msg.sender != locker) revert NotTheLocker();
        PicklerLaunchFactory.LaunchRecord memory record = _requireLaunch(launchToken);
        if (asset != launchToken && asset != record.quoteToken) revert InvalidAsset();
        PicklerPreset.LaunchPreset memory preset = PicklerBondingCurve(record.curve).preset();
        if (preset.lpCreatorShareBps != 5000) revert InvalidReceipt();
        uint256 before = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(asset).balanceOf(address(this)) != before + amount) revert InvalidReceipt();
        _credit(launchToken, asset, record.creatorFeeRecipient, 5000, FeeSource.POOL, amount);
    }
}
