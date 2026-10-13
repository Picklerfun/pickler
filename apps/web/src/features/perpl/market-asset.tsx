import Image from "next/image";
import styles from "./dashboard.module.css";

const ASSETS: Readonly<Record<string, { name: string; image: string }>> = {
  BTC: { name: "Bitcoin", image: "/brand/markets/btc.svg" },
  ETH: { name: "Ethereum", image: "/brand/markets/eth.svg" },
  SOL: { name: "Solana", image: "/brand/markets/sol.svg" },
  MON: { name: "Monad", image: "/brand/markets/mon.svg" },
  ZEC: { name: "Zcash", image: "/brand/markets/zec.svg" },
  LIT: { name: "Lighter", image: "/brand/markets/lit.svg" },
  PUMP: { name: "Pump.fun", image: "/brand/markets/pump.svg" },
  NEAR: { name: "NEAR Protocol", image: "/brand/markets/near.svg" },
};

export function marketIdentity(symbol: string) {
  const ticker = symbol.replace(/-PERP$/, "").toUpperCase();
  return { ticker, asset: ASSETS[ticker] };
}

/** Only reviewed local marks. The surrounding ticker supplies the accessible name. */
export function MarketAsset({ symbol }: { symbol: string }) {
  const { ticker, asset } = marketIdentity(symbol);
  return (
    <span className={styles.assetMark} aria-hidden="true">
      {asset ? (
        <Image
          src={asset.image}
          alt=""
          width={40}
          height={40}
          sizes="40px"
          loading="eager"
          unoptimized
        />
      ) : (
        <span>{ticker.slice(0, 3)}</span>
      )}
    </span>
  );
}
