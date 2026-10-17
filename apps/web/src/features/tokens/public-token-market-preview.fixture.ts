import type { PricePoint } from "@pickler/ui";

export type PreviewRange = "1H" | "24H" | "7D";

// Illustrative display samples from the approved mockup, not a financial model or market feed.
const END = Date.UTC(2026, 9, 11, 12);
const samples: Record<PreviewRange, number[]> = {
  "1H": [
    0.00193307, 0.001946, 0.001941, 0.001958, 0.00195, 0.001946, 0.001964, 0.001972, 0.001956,
    0.001977, 0.001965, 0.00198333,
  ],
  "24H": [
    0.00176453, 0.001788, 0.001776, 0.001801, 0.001797, 0.001782, 0.001794, 0.001809, 0.00182,
    0.001837, 0.001827, 0.001814, 0.001828, 0.001813, 0.001846, 0.001866, 0.001855, 0.001873,
    0.001862, 0.001859, 0.001882, 0.001914, 0.0019, 0.001886, 0.001894, 0.001918, 0.001909,
    0.001932, 0.001951, 0.001942, 0.001934, 0.001951, 0.001942, 0.001967, 0.001961, 0.00198333,
  ],
  "7D": [
    0.00085305, 0.000889, 0.000913, 0.00088, 0.000937, 0.000967, 0.000958, 0.001013, 0.001036,
    0.001089, 0.001054, 0.001111, 0.001143, 0.001131, 0.001182, 0.001237, 0.001209, 0.001267,
    0.001294, 0.001271, 0.00134, 0.001381, 0.001369, 0.001432, 0.001459, 0.001424, 0.001486,
    0.001517, 0.001499, 0.001581, 0.001615, 0.001596, 0.001657, 0.001719, 0.001688, 0.001748,
    0.001805, 0.001792, 0.001876, 0.001901, 0.00188, 0.00198333,
  ],
};
const duration: Record<PreviewRange, number> = {
  "1H": 3_600_000,
  "24H": 86_400_000,
  "7D": 604_800_000,
};
function history(range: PreviewRange): readonly PricePoint[] {
  const values = samples[range];
  return values.map((value, index) => ({
    at: END - duration[range] + Math.round((index / (values.length - 1)) * duration[range]),
    value,
  }));
}
export const PREVIEW_HISTORY: Record<PreviewRange, readonly PricePoint[]> = {
  "1H": history("1H"),
  "24H": history("24H"),
  "7D": history("7D"),
};

export const PREVIEW_CHANGE: Record<PreviewRange, string> = {
  "1H": "+2.6%",
  "24H": "+12.4%",
  "7D": "+132.5%",
};

// Receipt examples from docs/market/uniswap-v4-testnet-acceptance.json.
// Their real testnet hashes are navigable; quantities, times and wallet addresses are illustrative.
export const PREVIEW_TRADES = [
  {
    time: "12:00",
    trader: "0x3333333333333333333333333333333333333333",
    side: "Buy",
    price: "0.001983",
    amount: "2,500",
    value: "4.96",
    txHash: "0xd01ebf22f3c01df34442e6ca83697193a7bd1ac59f892a7a91de9f6170b54096",
  },
  {
    time: "11:42",
    trader: "0x4444444444444444444444444444444444444444",
    side: "Sell",
    price: "0.001961",
    amount: "10,000",
    value: "19.61",
    txHash: "0xe96c5db04b491357fb1bc45d84c07ebf28376a5612dd7add67834c24b97f590c",
  },
  {
    time: "11:18",
    trader: "0x5555555555555555555555555555555555555555",
    side: "Buy",
    price: "0.001967",
    amount: "25,000",
    value: "49.18",
    txHash: "0x80be22f3b46518d05cb49ff825730b823ded9eca564e20c0301e5cf91b8221f5",
  },
  {
    time: "10:56",
    trader: "0x6666666666666666666666666666666666666666",
    side: "Buy",
    price: "0.001942",
    amount: "5,000",
    value: "9.71",
    txHash: "0xec83f4b756aed34d505140593c816da27705dcd6361cfb9c397b05084c9cc4ad",
  },
] as const;
