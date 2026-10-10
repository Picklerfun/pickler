// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {PicklerLaunchFactory} from "./PicklerLaunchFactory.sol";
import {PicklerBondingCurve} from "./PicklerBondingCurve.sol";
import {PicklerPreset} from "./libraries/PicklerPreset.sol";

/// @title Pickler fee escrow
/// @notice Splits a launch's fees between its creator and the protocol, and pays them out.
/// @dev Two sources send fees here, and each has its own split, so each has its own entry
///      point and each may only be called by the contract that owns that source: the launch's
///      curve for trading fees, the locker for pool fees. That is also what makes attribution
///      unambiguous — the caller identifies the launch, rather than the escrow guessing which
///      of several launches a balance increase belonged to.
///
///      Crediting is atomic with the transfer that funds it. Both callers move the asset and
///      call here in the same transaction, so no second launch can remit in between and have
///      its fees attributed to the first.
///
///      `claim` debits only the caller's own balance. A beneficiary whose address rejects
///      transfers can therefore block nobody but themselves, and a beneficiary changed on the
///      factory keeps whatever was already credited to the old address — the split is read at
///      credit time, never re-applied afterwards.
contract PicklerFeeEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error NotDeployer();
    error AlreadyInitialized();
    error NotInitialized();
    error NotTheLaunchCurve();
    error NotTheLocker();
    error UnknownLaunch();
    error NothingToClaim();
    error InvalidRecipient();

    event FeeAccrued(
        address indexed launchToken,
        address indexed beneficiary,
        address indexed asset,
        uint256 amount,
        FeeSource source
    );
    event FeeClaimed(address indexed beneficiary, address indexed asset, address recipient, uint256 amount);

    enum FeeSource {
        CURVE,
        POOL
    }

    /// @notice The launch registry this escrow reads beneficiaries from.
    /// @dev Bound after construction because the factory's curve deployer needs this escrow's
    ///      address, so the two cannot both be constructor arguments. Binding is one-time and
    ///      restricted to whoever deployed this contract.
    PicklerLaunchFactory public factory;

    // forge-lint: disable-next-item(screaming-snake-case-immutable)
    address public immutable deployer;

    /// @notice Where the protocol's share accrues.
    // forge-lint: disable-next-item(screaming-snake-case-immutable)
    address public immutable treasury;

    /// @notice The only contract allowed to attribute pool fees.
    /// @dev Bound with the factory rather than at construction: the locker is created by the
    ///      graduation adapter, which needs this escrow's address first.
    address public locker;

    mapping(address beneficiary => mapping(address asset => uint256)) public claimable;

    /// @notice What the escrow has already attributed, per asset.
    /// @dev The difference between this and the real balance is what a sync attributes. It
    ///      also means a direct donation to this contract is not lost: it is credited to
    ///      whichever launch syncs next, which is imprecise but never leaves funds stranded.
    mapping(address asset => uint256) public accounted;

    constructor(address treasury_) {
        treasury = treasury_;
        deployer = msg.sender;
    }

    /// @notice Binds the escrow to its launch registry and its locker, once.
    /// @dev Deployment order is escrow, adapter (which creates the locker), curve deployer,
    ///      factory, then this. Every one of those needs the address of something deployed
    ///      before it, and this closes the loop without leaving anything mutable afterwards.
    function initialize(PicklerLaunchFactory factory_, address locker_) external {
        if (msg.sender != deployer) {
            revert NotDeployer();
        }
        if (address(factory) != address(0)) {
            revert AlreadyInitialized();
        }

        factory = factory_;
        locker = locker_;
    }

    /// @notice Attributes trading fees a curve has just transferred here.
    /// @dev Callable only by the launch's own curve, which is what identifies the launch.
    function syncCurveFees(address launchToken, address asset) external nonReentrant {
        PicklerLaunchFactory.LaunchRecord memory record = _requireLaunch(launchToken);
        if (msg.sender != record.curve) {
            revert NotTheLaunchCurve();
        }

        PicklerPreset.LaunchPreset memory preset = PicklerBondingCurve(record.curve).preset();

        _attribute(launchToken, asset, record.creatorFeeRecipient, preset.protocolShareBps, FeeSource.CURVE);
    }

    /// @notice Attributes pool fees the locker has just collected here.
    function syncPoolFees(address launchToken, address asset) external nonReentrant {
        if (msg.sender != locker) {
            revert NotTheLocker();
        }

        PicklerLaunchFactory.LaunchRecord memory record = _requireLaunch(launchToken);
        PicklerPreset.LaunchPreset memory preset = PicklerBondingCurve(record.curve).preset();

        // lpCreatorShareBps is the creator's share of pool fees, so the protocol's is the rest.
        uint256 protocolShareBps = PicklerPreset.BPS_SCALE - preset.lpCreatorShareBps;

        _attribute(launchToken, asset, record.creatorFeeRecipient, protocolShareBps, FeeSource.POOL);
    }

    /// @notice Pays out what the caller has accrued in an asset.
    function claim(address asset, address recipient) external nonReentrant returns (uint256 amount) {
        if (recipient == address(0)) {
            revert InvalidRecipient();
        }

        amount = claimable[msg.sender][asset];
        if (amount == 0) {
            revert NothingToClaim();
        }

        claimable[msg.sender][asset] = 0;
        accounted[asset] -= amount;

        IERC20(asset).safeTransfer(recipient, amount);

        emit FeeClaimed(msg.sender, asset, recipient, amount);
    }

    function _requireLaunch(address launchToken)
        private
        view
        returns (PicklerLaunchFactory.LaunchRecord memory record)
    {
        if (address(factory) == address(0)) {
            revert NotInitialized();
        }

        record = factory.getLaunch(launchToken);
        if (record.token == address(0)) {
            revert UnknownLaunch();
        }
    }

    /// @dev Splits whatever arrived since the last sync. The protocol takes its share of the
    ///      rounding, so the creator is never credited more than the split allows.
    function _attribute(
        address launchToken,
        address asset,
        address creatorRecipient,
        uint256 protocolShareBps,
        FeeSource source
    ) private {
        uint256 balance = IERC20(asset).balanceOf(address(this));
        uint256 received = balance - accounted[asset];
        if (received == 0) {
            return;
        }

        accounted[asset] = balance;

        uint256 protocolAmount = (received * protocolShareBps) / PicklerPreset.BPS_SCALE;
        uint256 creatorAmount = received - protocolAmount;

        if (protocolAmount > 0) {
            claimable[treasury][asset] += protocolAmount;

            emit FeeAccrued(launchToken, treasury, asset, protocolAmount, source);
        }

        if (creatorAmount > 0) {
            claimable[creatorRecipient][asset] += creatorAmount;

            emit FeeAccrued(launchToken, creatorRecipient, asset, creatorAmount, source);
        }
    }
}
