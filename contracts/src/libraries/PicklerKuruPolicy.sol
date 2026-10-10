// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

library PicklerKuruPolicy {
    error InvalidKuruPolicy();

    struct Band {
        int32 offsetTicks;
        uint16 baseWeightBps;
        uint16 quoteWeightBps;
        uint128 minSharesOut;
    }

    struct Config {
        uint32 version;
        address quoteToken;
        uint96 sizePrecision;
        uint32 pricePrecision;
        uint32 tickSize;
        uint32 passiveSpreadTicks;
        uint96 minQuoteNotional;
        uint96 maxQuoteNotional;
        uint256 takerFeePps;
        uint256 makerFeePps;
        Band[] bands;
    }

    function validate(Config memory config) internal pure {
        if (
            config.version != 1 || config.quoteToken == address(0) || config.sizePrecision == 0
                || config.pricePrecision == 0 || config.tickSize == 0 || config.passiveSpreadTicks == 0
                || config.minQuoteNotional == 0 || config.maxQuoteNotional < config.minQuoteNotional
                || config.bands.length == 0 || config.bands.length > 32
        ) revert InvalidKuruPolicy();
        uint256 baseWeight;
        uint256 quoteWeight;
        for (uint256 i; i < config.bands.length; ++i) {
            Band memory band = config.bands[i];
            if (band.baseWeightBps + uint256(band.quoteWeightBps) == 0 || band.minSharesOut == 0) {
                revert InvalidKuruPolicy();
            }
            for (uint256 j; j < i; ++j) {
                if (config.bands[j].offsetTicks == band.offsetTicks) revert InvalidKuruPolicy();
            }
            baseWeight += band.baseWeightBps;
            quoteWeight += band.quoteWeightBps;
        }
        if (baseWeight != 10_000 || quoteWeight != 10_000) revert InvalidKuruPolicy();
    }
}
