/** Immutable reviewed T1 namespace. Narrative and integration envelopes are excluded. */
export const BREAKOUT_PARAMETER_CONTRACT_SHA256 =
  "8d7aff6751aee7e2dc55bc4c3ded9e66766015c8ed9408fb60784d19be8fbb68";
export const BREAKOUT_RESEARCH_PROTOCOL_SHA256 =
  "36a06bef5267e7dc4407e78e508000e557da8df53e7df3f3f282cbe37e739816";
const namespaceDefinition = {
  contractId: "T1-hourly-close-breakout-20-10-selective-research-r2",
  domain: "PICKLER_DISABLED_RESEARCH_PARAMETER_CONTRACT_V1",
  signal: {
    resolutionMs: 3600000,
    entryLookbackBars: 20,
    exitLookbackBars: 10,
    minimumBars: 22,
    strictComparisons: true,
    currentExtremeExcluded: true,
    episode:
      "maximal consecutive same-side non-NONE raw-flag run; fresh requires known predecessor",
  },
  holdingCapMs: 14400000,
  admissionSlotMs: 300000,
  risk: {
    policy: "conservative-1x-v1",
    riskManagement: "buffered-selective-1x-v1",
    initialAUSD: "1000",
    intentAUSD: "100",
    feeReserveAUSD: "1",
    leverage: 1,
    entryExposurePercent: 40,
    hardExposurePercent: 50,
    maximumPositions: 5,
    stopPercent: 2,
    dailyLossPercent: 3,
    peakDrawdownPercent: 5,
  },
  candidateRank:
    "strictly ascending unique numeric marketId; duplicate identity invalid; no lexical fallback",
  discovery:
    "one master initial acquisition snapshot per claimed first-hourly five-minute slot; raw signal detection independent of account or book readiness",
  consumption:
    "known fresh event consumed once at discovery; missing initial financial frame is terminal blocked allocation; no later within-slot initial-view rescue; one assigned original attempt only",
  windowDigest:
    "all 22 ordered complete original candle objects plus full market identity, close times, immutable first-receipt/original provenance and revision/source-record IDs",
  duplicates:
    "complete original candle object canonical equality including OHLC text, volumeCollateral, trades, closed and all other retained fields; ancillary changes conflict; receipt-only transport observations append provenance without replacing original bar record",
  selector:
    "stream-universe-component-paper-20s-v1; single copied generation/reference per set; native financial and receipt validation; no historical matching or fallback",
  scheduler:
    "UTC T0 hourly aligned; unchanged SMA 300000ms slots with native claim in first30000ms; minute maintenance and nextPriceCycleDelay; candidate only first5m slot of each UTC hour",
  clockFence:
    "D and every final fence in [H,H+300000); require newest bar closeTime=H=floor(D/3600000)*3600000; fresh locked DB clock before irreversible COMMIT; late/unknown commit preserved as technical failure,never retried",
  financialMath:
    "normative frozen simulatePerpsFill/applyPaperFill/paperRisk/assertProfileOpening/applyPaperObservation; S=10^18, sequential integer truncation, signed cash floor to micros; no arithmetic from rounded average prices",
  cohort: [
    {
      symbol: "BTC",
      marketId: 1,
    },
    {
      symbol: "MON",
      marketId: 10,
    },
    {
      symbol: "ETH",
      marketId: 20,
    },
    {
      symbol: "SOL",
      marketId: 31,
    },
    {
      symbol: "HYPE",
      marketId: 40,
    },
    {
      symbol: "ZEC",
      marketId: 50,
    },
    {
      symbol: "LIT",
      marketId: 60,
    },
    {
      symbol: "VVV",
      marketId: 70,
    },
    {
      symbol: "PUMP",
      marketId: 90,
    },
    {
      symbol: "NEAR",
      marketId: 100,
    },
    {
      symbol: "UNI",
      marketId: 110,
    },
  ],
  sourceCommit: "4cd119dd2568c763faa69af946556016c095b045",
  normativeCodeHashes: {
    "packages/trading/src/features/perps-strategies/policy.ts":
      "c19eb39acb4a12e72ef1d9560f38459a2675d14e09f1b5609eb3d8f7b36befc0",
    "packages/trading/src/features/perps-study/profiles.ts":
      "53fef6387a28c28b61d8d42453e25b3e19b15247d52bb435d54b09125193879e",
    "packages/trading/src/features/perps-study/policy.ts":
      "1d61704eea35b50bcec7546ca1bf4ac53c68861f0c3ea0e42f46a03428ce6711",
    "packages/trading/src/features/perps-study/reentry.ts":
      "9d82eb5ad1ff0cb8aad2726483779f7d367fec8f823247437b0f308de0db9575",
    "packages/trading/src/features/evaluation/profile-runner.ts":
      "1d2ece24b4faa2fbd4ec41815edd9521e9a0af3809f7d1c3b69e9f5186ae85ed",
    "packages/trading/src/features/evaluation/sma-timing.ts":
      "cd79b8d142c547ad0be953a2df21f96ef21f5e1c3af19f5661c6deea2562cab9",
    "packages/trading/src/features/perps-paper/decimal.ts":
      "e72c50f6b4d7173da5e2648a0f1fb45f40c51e192111667f6af06760989689e8",
    "packages/trading/src/features/perps-paper/policy.ts":
      "01913c14add0b2f07c8edaecd4deb5fc9993f4bd4db0c3e6a437015bb607ebee",
    "packages/trading/src/features/perps-paper/selective.ts":
      "b9fee2248645205228676ad2fe916ab5eff44b685ed50f80ec7710e735645b91",
    "packages/trading/src/features/perps-paper/simulation.ts":
      "ece05d050a5b0321a74872a6bc0ba825071dfed889be3371689dfd40bcfa7d6a",
    "packages/infrastructure/src/persistence/perps-study-store.ts":
      "d433a86342916fcc998e886c098ce9c635e500ba63d3d12d583e42a31fa551db",
  },
  baseA3SpecSha256: "76d0caccd44a54ca758b4b0afdf1f0ec57369a8900937828871ad1f042785b7c",
} as const;

function freezeNamespace<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      freezeNamespace(child);
    }
    Object.freeze(value);
  }
  return value;
}
export const BREAKOUT_NAMESPACE = freezeNamespace(namespaceDefinition);
