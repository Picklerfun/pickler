// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IEip3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
    function transfer(address to, uint256 value) external returns (bool);
}

/// @notice Receives one EIP-3009 payment for a paid advice analysis and splits it in the same call:
/// the creator's share to the agent wallet the buyer signed for, the rest to Pickler's treasury.
contract PicklerAdviceSplitter {
    uint16 public constant CREATOR_BPS = 6500;
    // The getter names `asset()` and `treasury()` are the public interface the API reads.
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    IEip3009 public immutable asset;
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    address public immutable treasury;

    event AdviceSettled(
        address indexed from,
        address indexed payee,
        bytes32 indexed nonce,
        uint256 value,
        uint256 creatorAmount,
        uint256 protocolAmount
    );

    error ZeroAddress();
    error InvalidPayee();
    error TransferFailed();

    constructor(address asset_, address treasury_) {
        if (asset_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        asset = IEip3009(asset_);
        treasury = treasury_;
    }

    function nonceFor(address payee, bytes32 salt) public pure returns (bytes32) {
        // forge-lint: disable-next-item(asm-keccak256)
        return keccak256(abi.encode(payee, salt));
    }

    function settle(
        address from,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        address payee,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 creatorAmount, uint256 protocolAmount) {
        if (payee == address(0) || payee == address(this) || payee == treasury) revert InvalidPayee();
        bytes32 nonce = nonceFor(payee, salt);
        asset.receiveWithAuthorization(from, address(this), value, validAfter, validBefore, nonce, v, r, s);
        creatorAmount = value * CREATOR_BPS / 10_000;
        protocolAmount = value - creatorAmount;
        if (!asset.transfer(payee, creatorAmount)) revert TransferFailed();
        if (!asset.transfer(treasury, protocolAmount)) revert TransferFailed();
        emit AdviceSettled(from, payee, nonce, value, creatorAmount, protocolAmount);
    }
}
