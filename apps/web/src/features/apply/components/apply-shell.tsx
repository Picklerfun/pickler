import Image from "next/image";
import Link from "next/link";
import { Icon } from "@pickler/ui";
import type { ReactNode } from "react";
import styles from "../apply.module.css";

export function ApplyShell({ children }: { children: ReactNode }) {
  return (
    // Pinned dark, as the public shell is: .space paints an opaque ground under everything here
    // and there is no light canvas for this page yet.
    <div className={styles.page} data-surface="dark">
      <div aria-hidden="true">
        <div className={styles.space} />
        <div className={styles.stars} />
        <div className={styles.floorGrid} />
      </div>
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <Link href="/" className={styles.brand}>
            <Image
              src="/brand/logo.png"
              alt=""
              width={128}
              height={135}
              className={styles.brandLogo}
              priority
              unoptimized
            />
            <span className={styles.brandName}>PICKLER</span>
          </Link>
          <span className={styles.headerTag}>CLOSED TESTNET</span>
          <Link href="/" className={styles.headerLink}>
            <Icon name="arrowLeft" size={14} /> THE BOARD
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
