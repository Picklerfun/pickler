// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PicklerAgentToken} from "./PicklerAgentToken.sol";
import {PicklerPreset} from "./libraries/PicklerPreset.sol";
import {ICurveDeployer} from "./interfaces/ICurveDeployer.sol";

/// @title Pickler launch factory
/// @notice Creates a launch: one token, one curve, one canonical record per agent.
/// @dev Holds the rules about *who may launch what*, and nothing about how a curve prices a
///      trade. Three properties it exists to guarantee:
///
///      - A launch is authorized by its creator, either directly or by an EIP-712 signature
///        that a third party may submit. Paying the gas does not make you the creator.
///      - An agent key launches once. A second token for the same agent is not a new market,
///        it is a way to confuse buyers about which one is real.
///      - A launch is fixed to the exact preset the caller reviewed, checked by hash, and a
///        published preset is never rewritten — only superseded by a new version.
///
///      The operator can stop new launches and publish new presets. It cannot touch a launch
///      that already exists: no pause, no withdrawal, no reassignment. Suspension is a gate
///      on creation, never on trading.
contract PicklerLaunchFactory is EIP712 {
    using PicklerPreset for PicklerPreset.LaunchPreset;

    struct LaunchParams {
        bytes32 agentKey;
        address creator;
        address creatorFeeRecipient;
        string name;
        string symbol;
        string metadataURI;
        bytes32 metadataHash;
        uint32 presetId;
        uint32 presetVersion;
        bytes32 expectedConfigHash;
        uint256 nonce;
        uint256 deadline;
    }

    struct LaunchRecord {
        address token;
        address curve;
        address creator;
        address creatorFeeRecipient;
        address quoteToken;
        bytes32 agentKey;
        bytes32 presetHash;
        uint64 creationBlock;
    }

    error NotOperator();
    error LaunchesSuspended();
    error PresetAlreadyPublished();
    error PresetNotPublished();
    error ConfigChanged();
    error AgentAlreadyLaunched();
    error InvalidAuthorization();
    error AuthorizationExpired();
    error AuthorizationAlreadyUsed();
    error InvalidAgentKey();
    error SupplyTransferFailed();
    error NotFeeRecipient();
    error NotPendingFeeRecipient();

    event PresetPublished(uint32 indexed presetId, uint32 indexed version, bytes32 configHash);
    event LaunchesEnabledChanged(bool enabled);
    event CreatorFeeRecipientTransferStarted(address indexed token, address indexed from, address indexed to);
    event CreatorFeeRecipientChanged(address indexed token, address indexed from, address indexed to);
    event LaunchCreated(
        address indexed token,
        address indexed curve,
        bytes32 indexed agentKey,
        address creator,
        address quoteToken,
        bytes32 presetHash,
        bytes32 metadataHash
    );

    bytes32 private constant LAUNCH_AUTHORIZATION_TYPEHASH = keccak256(
        "LaunchAuthorization(bytes32 agentKey,address creator,address creatorFeeRecipient,bytes32 paramsHash,uint256 nonce,uint256 deadline)"
    );

    // These are public getters, so their names are part of the ABI that the indexer and the
    // SDK read. Kept lowerCamelCase for that reason rather than renamed to satisfy style.
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    address public immutable operator;
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    ICurveDeployer public immutable curveDeployer;

    bool public launchesEnabled = true;

    mapping(uint32 presetId => mapping(uint32 version => PicklerPreset.LaunchPreset)) private _presets;
    mapping(uint32 presetId => mapping(uint32 version => bool)) public presetPublished;

    mapping(address token => LaunchRecord) private _launches;
    mapping(bytes32 agentKey => address token) public tokenForAgent;
    mapping(address creator => mapping(uint256 nonce => bool)) public authorizationUsed;
    mapping(address token => address) public pendingFeeRecipient;

    constructor(address operator_, ICurveDeployer curveDeployer_) EIP712("Pickler", "1") {
        operator = operator_;
        curveDeployer = curveDeployer_;
    }

    // The suggestion is to move this into a function to shrink bytecode. The factory has
    // one modifier and sits well under the size limit, so clarity wins.
    // forge-lint: disable-next-item(unwrapped-modifier-logic)
    modifier onlyOperator() {
        if (msg.sender != operator) {
            revert NotOperator();
        }
        _;
    }

    /// @notice Publishes a preset version. Validated here so an incoherent one never exists.
    /// @dev A published version is immutable. Changing economics means a new version, which
    ///      leaves every launch already pointing at the old one exactly as it was.
    function publishPreset(PicklerPreset.LaunchPreset calldata preset) external onlyOperator {
        if (presetPublished[preset.presetId][preset.version]) {
            revert PresetAlreadyPublished();
        }

        preset.validate();

        _presets[preset.presetId][preset.version] = preset;
        presetPublished[preset.presetId][preset.version] = true;

        emit PresetPublished(preset.presetId, preset.version, preset.configHash());
    }

    /// @notice Stops new launches. Existing launches are untouched and keep trading.
    function setLaunchesEnabled(bool enabled) external onlyOperator {
        launchesEnabled = enabled;

        emit LaunchesEnabledChanged(enabled);
    }

    /// @notice Creates a launch.
    /// @param authorization Empty when the creator calls directly; otherwise an EIP-712
    ///        signature by the creator, which anyone may submit and pay for.
    function createLaunch(LaunchParams calldata params, bytes calldata authorization)
        external
        returns (address token, address curve)
    {
        if (!launchesEnabled) {
            revert LaunchesSuspended();
        }
        if (params.agentKey == bytes32(0)) {
            revert InvalidAgentKey();
        }
        if (tokenForAgent[params.agentKey] != address(0)) {
            revert AgentAlreadyLaunched();
        }

        _authorize(params, authorization);

        PicklerPreset.LaunchPreset memory preset = getPreset(params.presetId, params.presetVersion);

        bytes32 presetHash = preset.configHash();
        if (presetHash != params.expectedConfigHash) {
            revert ConfigChanged();
        }

        // The token mints to the factory so the curve's address can be known before the
        // supply moves; both happen in this call, so the factory never holds it across
        // transactions and the test asserts it holds nothing afterwards.
        token = address(new PicklerAgentToken(params.name, params.symbol, preset.totalSupply, address(this)));
        curve = curveDeployer.deployCurve(token, preset);

        // PicklerAgentToken reverts rather than returning false, but the return value is
        // checked anyway: this is the single point where a launch's entire inventory moves,
        // and it should not rely on a property of the token to stay correct.
        if (!IERC20(token).transfer(curve, preset.totalSupply)) {
            revert SupplyTransferFailed();
        }

        _launches[token] = LaunchRecord({
            token: token,
            curve: curve,
            creator: params.creator,
            creatorFeeRecipient: params.creatorFeeRecipient,
            quoteToken: preset.quoteToken,
            agentKey: params.agentKey,
            presetHash: presetHash,
            creationBlock: uint64(block.number)
        });
        tokenForAgent[params.agentKey] = token;

        emit LaunchCreated(
            token, curve, params.agentKey, params.creator, preset.quoteToken, presetHash, params.metadataHash
        );
    }

    /// @notice Proposes a new recipient for a launch's future fees.
    /// @dev Two steps, because a fee stream sent to an address that cannot claim is a fee
    ///      stream lost. Nothing already accrued moves: the escrow credits a beneficiary at
    ///      the moment fees arrive, so a change only ever affects what arrives afterwards.
    function transferCreatorFeeRecipient(address token, address newRecipient) external {
        LaunchRecord storage record = _launches[token];
        if (msg.sender != record.creatorFeeRecipient) {
            revert NotFeeRecipient();
        }

        pendingFeeRecipient[token] = newRecipient;

        emit CreatorFeeRecipientTransferStarted(token, record.creatorFeeRecipient, newRecipient);
    }

    /// @notice Accepts a proposed fee recipient transfer, proving the new address can act.
    function acceptCreatorFeeRecipient(address token) external {
        if (msg.sender != pendingFeeRecipient[token]) {
            revert NotPendingFeeRecipient();
        }

        LaunchRecord storage record = _launches[token];
        address previous = record.creatorFeeRecipient;

        record.creatorFeeRecipient = msg.sender;
        pendingFeeRecipient[token] = address(0);

        emit CreatorFeeRecipientChanged(token, previous, msg.sender);
    }

    function getLaunch(address token) external view returns (LaunchRecord memory) {
        return _launches[token];
    }

    function getPreset(uint32 presetId, uint32 version) public view returns (PicklerPreset.LaunchPreset memory preset) {
        if (!presetPublished[presetId][version]) {
            revert PresetNotPublished();
        }

        return _presets[presetId][version];
    }

    /// @notice The digest a creator signs to authorize someone else to submit their launch.
    function authorizationDigest(LaunchParams calldata params) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    LAUNCH_AUTHORIZATION_TYPEHASH,
                    params.agentKey,
                    params.creator,
                    params.creatorFeeRecipient,
                    _paramsHash(params),
                    params.nonce,
                    params.deadline
                )
            )
        );
    }

    function _authorize(LaunchParams calldata params, bytes calldata authorization) private {
        if (msg.sender == params.creator && authorization.length == 0) {
            // A creator acting directly still spends the nonce, so a signature they issued
            // earlier for the same nonce cannot be submitted afterwards.
            _consumeNonce(params.creator, params.nonce);
            return;
        }

        if (block.timestamp > params.deadline) {
            revert AuthorizationExpired();
        }

        // SignatureChecker accepts both an EOA signature and an ERC-1271 smart wallet.
        if (!SignatureChecker.isValidSignatureNow(params.creator, authorizationDigest(params), authorization)) {
            revert InvalidAuthorization();
        }

        _consumeNonce(params.creator, params.nonce);
    }

    function _consumeNonce(address creator, uint256 nonce) private {
        if (authorizationUsed[creator][nonce]) {
            revert AuthorizationAlreadyUsed();
        }

        authorizationUsed[creator][nonce] = true;
    }

    /// @dev Everything the signature commits to beyond the fields named explicitly in the
    ///      typed data, so a submitter cannot alter the metadata or the preset being used.
    function _paramsHash(LaunchParams calldata params) private pure returns (bytes32) {
        // Hand-written assembly would save gas here, on a path called once per launch.
        // forge-lint: disable-next-item(asm-keccak256)
        return keccak256(
            abi.encode(
                keccak256(bytes(params.name)),
                keccak256(bytes(params.symbol)),
                keccak256(bytes(params.metadataURI)),
                params.metadataHash,
                params.presetId,
                params.presetVersion,
                params.expectedConfigHash
            )
        );
    }
}
