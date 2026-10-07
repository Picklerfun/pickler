export interface AdvicePrice {
  amount: string;
  asset: "AUSD";
  decimals: 6;
}

export function formatMicroAusd(micro: bigint): string {
  const whole = micro / 1_000_000n;
  const fraction = (micro % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

export function advicePrice(micro: bigint | null): AdvicePrice | null {
  return micro === null ? null : { amount: formatMicroAusd(micro), asset: "AUSD", decimals: 6 };
}
