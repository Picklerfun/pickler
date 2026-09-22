// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {PicklerCurveMath} from "./libraries/PicklerCurveMath.sol";
import {PicklerPreset} from "./libraries/PicklerPreset.sol";

/// @title Pickler bonding curve
/// @notice Sells and buys back a launch's inventory before it graduates to a pool.
/// @dev Keeps three amounts strictly apart, because conflating any two of them would let one
///      party spend what belongs to another:
///
///      - `realQuoteReserve`, which backs sales and is handed to graduation untouched;
///      - `accruedFees`, which belongs to the escrow and is never spendable as reserve;
///      - the token inventory, of which only `saleAllocation` is ever sold. The LP allocation
///        sits here until graduation and cannot be bought.
///
///      Both are tracked in storage rather than read from balances. A donation to this
///      contract therefore changes no price, credits no one, and cannot trigger graduation.
///
///      All arithmetic lives in PicklerCurveMath, which rounds in the curve's favour. Fees
///      round the same way, so a trader can never extract value through rounding alone.
contract PicklerBondingCurve is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PicklerCurveMath for PicklerCurveMath.CurveConfig;

    enum Phase {
        CURVE_ACTIVE,
        READY_TO_GRADUATE,
        POOL_ACTIVE
    }

    error AlreadyInitialized();
    error NotInitialized();
    error NotDeployer();
    error CurveClosed();
    error NotReady();
    error NotAdapter();
    error DeadlinePassed();
    error SlippageExceeded();
    error ExceedsRemainingSupply();
    error UnexpectedQuoteAmount();
    error ZeroAmount();

    event CurveBought(
        address indexed payer,
        address indexed recipient,
        uint256 grossQuoteIn,
        uint256 netQuoteIn,
        uint256 tokensOut,
        uint256 totalFee,
        uint256 reserveAfter,
        uint256 netSoldAfter
    );
    event CurveSold(
        address indexed seller,
        address indexed recipient,
        uint256 tokensIn,
        uint256 grossQuoteOut,
        uint256 netQuoteOut,
        uint256 totalFee,
        uint256 reserveAfter,
        uint256 netSoldAfter
    );
    event CurveCompleted(address indexed token, uint256 realQuoteReserve, uint256 lpTokenAllocation);
    event CurveGraduated(address indexed adapter, uint256 quoteReleased, uint256 tokensReleased);
    event FeesRemitted(address indexed escrow, uint256 amount);

    uint16 private constant BPS_SCALE = 10_000;

    // forge-lint: disable-next-item(screaming-snake-case-immutable)
    IERC20 public immutable quoteToken;
    // forge-lint: disable-next-item(screaming-snake-case-immutable)
    address public immutable graduationAdapter;
    // forge-lint: disable-next-item(screaming-snake-case-immutable)
    address public immutable feeEscrow;

    /// @notice Whoever deployed this curve, and the only account that may bind its token.
    // forge-lint: disable-next-item(screaming-snake-case-immutable)
    address public immutable deployer;

    IERC20 public token;

    Phase public phase;

    /// @notice Quote held to back sales and to seed the pool. Net of fees, always.
    uint256 public realQuoteReserve;

    /// @notice Quote owed to the escrow. Never spendable as reserve.
    uint256 public accruedFees;

    /// @notice Tokens sold net of tokens sold back.
    uint256 public netSold;

    PicklerPreset.LaunchPreset private _preset;

    constructor(PicklerPreset.LaunchPreset memory preset_, address graduationAdapter_, address feeEscrow_) {
        PicklerPreset.validate(preset_);

        _preset = preset_;
        quoteToken = IERC20(preset_.quoteToken);
        graduationAdapter = graduationAdapter_;
        feeEscrow = feeEscrow_;
        deployer = msg.sender;
    }

    /// @notice Binds the curve to its token.
    /// @dev The token cannot be a constructor argument: it is minted to this address, so it
    ///      needs this address to exist first. The deployer performs both in one transaction,
    ///      and binding is permanent. Restricted to the deployer so that a curve deployed by
    ///      any other route cannot be bound to a token of someone else's choosing.
    function initialize(address token_) external {
        if (msg.sender != deployer) {
            revert NotDeployer();
        }
        if (address(token) != address(0)) {
            revert AlreadyInitialized();
        }

        token = IERC20(token_);
    }

    // --- views ------------------------------------------------------------------------

    function preset() external view returns (PicklerPreset.LaunchPreset memory) {
        return _preset;
    }

    function remainingTokens() public view returns (uint256) {
        return _config().remainingTokens(netSold);
    }

    /// @notice Tokens a buyer would receive for a gross quote amount, fees included.
    function quoteBuy(uint256 grossQuoteIn) public view returns (uint256 tokensOut) {
        (, uint256 netQuoteIn) = _splitBuyFee(grossQuoteIn);

        return _config().tokensOutForQuoteIn(netSold, netQuoteIn);
    }

    /// @notice Gross quote a buyer must supply to receive an exact number of tokens.
    function quoteBuyExactOutput(uint256 tokensOut) public view returns (uint256 grossQuoteIn) {
        uint256 netQuoteIn = _config().quoteInForTokensOut(netSold, tokensOut);

        return _grossFromNet(netQuoteIn);
    }

    /// @notice Quote a seller would receive, fees deducted.
    function quoteSell(uint256 tokensIn) public view returns (uint256 netQuoteOut) {
        uint256 gross = _config().quoteOutForTokensIn(netSold, tokensIn);

        (, netQuoteOut) = _splitSellFee(gross);
    }

    function getCurveState()
        external
        view
        returns (
            Phase phase_,
            uint256 netSold_,
            uint256 remaining,
            uint256 realQuoteReserve_,
            uint256 accruedFees_,
            uint256 virtualTokenReserve,
            uint256 virtualQuoteReserve
        )
    {
        return (
            phase,
            netSold,
            remainingTokens(),
            realQuoteReserve,
            accruedFees,
            _preset.virtualTokenReserve,
            _preset.virtualQuoteReserve
        );
    }

    // --- trading ----------------------------------------------------------------------

    /// @notice Spends an exact gross amount of quote on as many tokens as it buys.
    /// @dev Reverts rather than truncating when the amount would overshoot the remaining
    ///      inventory. Filling it partially would sell the last tokens at an average price
    ///      nobody quoted; `buyExactOutput` is the way to take exactly what is left.
    function buyExactInput(uint256 grossQuoteIn, uint256 minTokensOut, address recipient, uint256 deadline)
        external
        nonReentrant
        returns (uint256 tokensOut)
    {
        _requireActive(deadline);
        if (grossQuoteIn == 0) {
            revert ZeroAmount();
        }

        (uint256 fee, uint256 netQuoteIn) = _splitBuyFee(grossQuoteIn);

        tokensOut = _config().tokensOutForQuoteIn(netSold, netQuoteIn);
        if (tokensOut > remainingTokens()) {
            revert ExceedsRemainingSupply();
        }
        if (tokensOut < minTokensOut) {
            revert SlippageExceeded();
        }

        _collectQuote(msg.sender, grossQuoteIn);

        realQuoteReserve += netQuoteIn;
        accruedFees += fee;
        netSold += tokensOut;

        token.safeTransfer(recipient, tokensOut);

        emit CurveBought(msg.sender, recipient, grossQuoteIn, netQuoteIn, tokensOut, fee, realQuoteReserve, netSold);

        _completeIfExhausted();
    }

    /// @notice Buys an exact number of tokens, charging only what they cost.
    function buyExactOutput(uint256 tokensOut, uint256 maxQuoteIn, address recipient, uint256 deadline)
        external
        nonReentrant
        returns (uint256 grossQuoteIn)
    {
        _requireActive(deadline);
        if (tokensOut == 0) {
            revert ZeroAmount();
        }
        if (tokensOut > remainingTokens()) {
            revert ExceedsRemainingSupply();
        }

        uint256 netQuoteIn = _config().quoteInForTokensOut(netSold, tokensOut);
        grossQuoteIn = _grossFromNet(netQuoteIn);

        if (grossQuoteIn > maxQuoteIn) {
            revert SlippageExceeded();
        }

        _collectQuote(msg.sender, grossQuoteIn);

        realQuoteReserve += netQuoteIn;
        accruedFees += grossQuoteIn - netQuoteIn;
        netSold += tokensOut;

        token.safeTransfer(recipient, tokensOut);

        emit CurveBought(
            msg.sender,
            recipient,
            grossQuoteIn,
            netQuoteIn,
            tokensOut,
            grossQuoteIn - netQuoteIn,
            realQuoteReserve,
            netSold
        );

        _completeIfExhausted();
    }

    /// @notice Sells tokens back to the curve.
    function sellExactInput(uint256 tokensIn, uint256 minQuoteOut, address recipient, uint256 deadline)
        external
        nonReentrant
        returns (uint256 netQuoteOut)
    {
        _requireActive(deadline);
        if (tokensIn == 0) {
            revert ZeroAmount();
        }

        uint256 grossQuoteOut = _config().quoteOutForTokensIn(netSold, tokensIn);
        uint256 fee;
        (fee, netQuoteOut) = _splitSellFee(grossQuoteOut);

        if (netQuoteOut < minQuoteOut) {
            revert SlippageExceeded();
        }

        // The gross leaves the reserve; the fee stays behind as the escrow's, not as backing.
        realQuoteReserve -= grossQuoteOut;
        accruedFees += fee;
        netSold -= tokensIn;

        token.safeTransferFrom(msg.sender, address(this), tokensIn);
        quoteToken.safeTransfer(recipient, netQuoteOut);

        emit CurveSold(msg.sender, recipient, tokensIn, grossQuoteOut, netQuoteOut, fee, realQuoteReserve, netSold);
    }

    // --- graduation and fees ----------------------------------------------------------

    /// @notice Hands the reserve and the LP allocation to the graduation adapter.
    /// @dev Only the adapter, only once, and only after the inventory is exhausted. Fees stay
    ///      behind: they were never part of the reserve and are not the pool's to seed.
    function releaseForGraduation() external nonReentrant returns (uint256 quoteReleased, uint256 tokensReleased) {
        if (phase != Phase.READY_TO_GRADUATE) {
            revert NotReady();
        }
        if (msg.sender != graduationAdapter) {
            revert NotAdapter();
        }

        quoteReleased = realQuoteReserve;
        tokensReleased = _preset.lpAllocation;

        realQuoteReserve = 0;
        phase = Phase.POOL_ACTIVE;

        quoteToken.safeTransfer(graduationAdapter, quoteReleased);
        token.safeTransfer(graduationAdapter, tokensReleased);

        emit CurveGraduated(graduationAdapter, quoteReleased, tokensReleased);
    }

    /// @notice Sends accrued fees to the escrow. Permissionless: the destination is fixed at
    ///         construction, so there is nothing for a caller to redirect.
    function remitFees() external nonReentrant {
        uint256 amount = accruedFees;
        if (amount == 0) {
            return;
        }

        accruedFees = 0;
        quoteToken.safeTransfer(feeEscrow, amount);

        emit FeesRemitted(feeEscrow, amount);
    }

    // --- internals --------------------------------------------------------------------

    function _config() private view returns (PicklerCurveMath.CurveConfig memory) {
        return PicklerCurveMath.CurveConfig({
            virtualTokenReserve: _preset.virtualTokenReserve,
            virtualQuoteReserve: _preset.virtualQuoteReserve,
            saleAllocation: _preset.saleAllocation
        });
    }

    function _requireActive(uint256 deadline) private view {
        if (address(token) == address(0)) {
            revert NotInitialized();
        }
        if (phase != Phase.CURVE_ACTIVE) {
            revert CurveClosed();
        }
        if (block.timestamp > deadline) {
            revert DeadlinePassed();
        }
    }

    /// @dev Fees round up, matching the direction the curve maths rounds, so that no sequence
    ///      of trades can extract value from rounding.
    function _splitBuyFee(uint256 grossQuoteIn) private view returns (uint256 fee, uint256 netQuoteIn) {
        fee = _ceilMulDiv(grossQuoteIn, _preset.buyFeeBps, BPS_SCALE);

        return (fee, grossQuoteIn - fee);
    }

    function _splitSellFee(uint256 grossQuoteOut) private view returns (uint256 fee, uint256 netQuoteOut) {
        fee = _ceilMulDiv(grossQuoteOut, _preset.sellFeeBps, BPS_SCALE);

        return (fee, grossQuoteOut - fee);
    }

    /// @dev The gross amount whose net, after the buy fee, is at least `netQuoteIn`.
    function _grossFromNet(uint256 netQuoteIn) private view returns (uint256) {
        uint256 gross = _ceilMulDiv(netQuoteIn, BPS_SCALE, BPS_SCALE - _preset.buyFeeBps);

        // Rounding up the division can leave the implied net a unit above what was asked for,
        // which is fine; rounding down would leave the reserve short, which is not.
        return gross;
    }

    /// @dev Pulls quote and verifies the contract actually received it. A fee-on-transfer or
    ///      rebasing quote asset would otherwise credit a reserve that does not exist.
    function _collectQuote(address payer, uint256 amount) private {
        uint256 balanceBefore = quoteToken.balanceOf(address(this));

        quoteToken.safeTransferFrom(payer, address(this), amount);

        if (quoteToken.balanceOf(address(this)) - balanceBefore != amount) {
            revert UnexpectedQuoteAmount();
        }
    }

    function _completeIfExhausted() private {
        if (remainingTokens() != 0) {
            return;
        }

        phase = Phase.READY_TO_GRADUATE;

        emit CurveCompleted(address(token), realQuoteReserve, _preset.lpAllocation);
    }

    function _ceilMulDiv(uint256 value, uint256 numerator, uint256 denominator) private pure returns (uint256) {
        uint256 product = value * numerator;

        return product == 0 ? 0 : (product - 1) / denominator + 1;
    }
}
