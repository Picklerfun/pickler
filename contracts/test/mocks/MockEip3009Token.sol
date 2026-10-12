// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice A six-decimal token with AUSD's EIP-3009 `receiveWithAuthorization` semantics, for
/// offline tests only. The signature is checked against the real EIP-712 digest (domain
/// "Agora Dollar", version "1", this chain, this contract) over the standard typehash, so a
/// changed `to`, value or nonce breaks it exactly as it would on chain.
contract MockEip3009Token {
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
        0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8;

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    // ERC-20 metadata getter name.
    // forge-lint: disable-next-line(screaming-snake-case-const)
    uint8 public constant decimals = 6;

    mapping(address account => uint256 balance) public balanceOf;
    mapping(address authorizer => mapping(bytes32 nonce => bool used)) public authorizationState;

    bool public transferReturnsFalse;

    error CallerMustBePayee();
    error AuthorizationNotYetValid();
    error AuthorizationExpired();
    error AuthorizationUsed();
    error InvalidSignature();
    error InsufficientBalance();

    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
    }

    function setTransferReturnsFalse(bool value) external {
        transferReturnsFalse = value;
    }

    // The EIP-2612/EIP-3009 getter name AUSD exposes.
    // forge-lint: disable-next-item(mixed-case-function)
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return
            keccak256(
                abi.encode(DOMAIN_TYPEHASH, keccak256("Agora Dollar"), keccak256("1"), block.chainid, address(this))
            );
    }

    function transfer(address to, uint256 value) external returns (bool) {
        if (transferReturnsFalse) {
            return false;
        }

        _move(msg.sender, to, value);

        return true;
    }

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
    ) external {
        if (msg.sender != to) revert CallerMustBePayee();
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
        if (authorizationState[from][nonce]) revert AuthorizationUsed();

        bytes32 structHash =
            keccak256(abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0) || signer != from) revert InvalidSignature();

        authorizationState[from][nonce] = true;
        _move(from, to, value);
    }

    function _move(address from, address to, uint256 value) internal {
        if (balanceOf[from] < value) revert InsufficientBalance();
        balanceOf[from] -= value;
        balanceOf[to] += value;
    }
}
