// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Independently authored minimal signatures reviewed against Kuru's pinned public ABI.
/// @dev No SDK source is included. Units and deployments require separate remote acceptance.
interface IKuruAccountCore {
    function ensureRootAccount(address owner) external returns (uint40);
    function getAccountOwner(uint40 accountId) external view returns (address);
    function getBalance(uint40 accountId, address token) external view returns (uint256);
    function getSpotReservedBalance(uint40 accountId, address token) external view returns (uint256);
    function getSpotTokenDecimals(address token) external view returns (uint8);
    function spotTokenEnabled(address token) external view returns (bool);
    function deposit(address owner, address token, uint256 amount) external payable;
    function withdraw(uint40 accountId, address token, uint256 amount, address recipient) external;
}

interface IKuruSpotRouter {
    function spotBalanceAccountAddress() external view returns (address);
    function verifiedSpotMarket(address market) external view returns (bool);
    function deploySpotMarket(
        address baseToken,
        address quoteToken,
        uint96 sizePrecision,
        uint32 pricePrecision,
        uint32 tickSize,
        uint32 passiveSpreadTicks,
        uint96 minQuoteNotional,
        uint96 maxQuoteNotional,
        uint256 takerFeePps,
        uint256 makerFeePps
    ) external returns (address);
}

interface IKuruOrderBook {
    struct Position {
        uint40 ownerId;
        uint32 lowPrice;
        uint32 highPrice;
        uint128 shares;
        uint256 lastFeeGrowthBaseX128;
        uint256 lastFeeGrowthQuoteX128;
    }
    function accountCore() external view returns (address);
    function baseToken() external view returns (address);
    function quoteToken() external view returns (address);
    function pricePrecision() external view returns (uint32);
    function sizePrecision() external view returns (uint96);
    function tickSize() external view returns (uint32);
    function passiveSpreadTicks() external view returns (uint32);
    function minQuoteNotional() external view returns (uint96);
    function maxQuoteNotional() external view returns (uint96);
    function takerFeePps() external view returns (uint256);
    function makerFeePps() external view returns (uint256);
    function getPassivePosition(uint64 positionId) external view returns (Position memory);
    function mintPassiveLiquidity(
        uint40 accountId,
        uint32 lowPrice,
        uint128 baseAmount,
        uint128 quoteAmount,
        uint128 minSharesOut,
        uint64 deadline
    ) external returns (uint64, uint128);
    function claimPassiveFees(uint40 accountId, uint64 positionId) external returns (uint128, uint128);
}
