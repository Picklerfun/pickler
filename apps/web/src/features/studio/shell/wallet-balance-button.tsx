"use client";
import Image from "next/image";
import { BrandMark, Icon } from "@pickler/ui";
import { formatUnits } from "../new-agent/model";
import styles from "../new-agent/new-agent.module.css";

/** Account balances, independent of the selected agent. Each asset keeps its own mark. */
export function WalletBalanceButton({
  ausdMicro,
  monWei,
  onClick,
}: {
  ausdMicro: bigint | null;
  monWei: bigint | null;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className={styles.topPill}
      title="Master wallet"
      aria-label={`Master wallet: ${formatUnits(ausdMicro, "AUSD")} AUSD, ${formatUnits(monWei, "MON")} MON`}
      aria-haspopup="dialog"
      onClick={onClick}
    >
      <small className={styles.walletOwner}>Master wallet</small>
      <Icon name="wallet" size={16} />
      <span className={styles.assetBalance}>
        <BrandMark name="ausd" size={16} />
        <span>
          {formatUnits(ausdMicro, "AUSD")}
          <small> AUSD</small>
        </span>
      </span>
      <i aria-hidden="true" />
      <span className={styles.assetBalance}>
        <Image src="/brand/monad.png" alt="" width={16} height={16} />
        <span>
          {formatUnits(monWei, "MON")}
          <small> MON</small>
        </span>
      </span>
    </button>
  );
}
