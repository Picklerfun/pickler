import Link from "next/link";
import { Icon } from "@pickler/ui";
import styles from "../landing.module.css";
import { AppStoreLink } from "./app-store-link";

/** BEAT THE MARKET. READY? The last ask, on the dark ground. */
export function Download({ appStoreUrl }: { appStoreUrl: string | null }) {
  return (
    <section className={styles.shell} aria-labelledby="download-title">
      <div id="download" className={styles.download} data-surface="dark">
        <div className={`${styles.glow} ${styles.downloadGlow}`} aria-hidden="true" />
        <h2 id="download-title" className={`${styles.title} ${styles.downloadTitle}`}>
          BEAT THE MARKET
          <span className={styles.stop} data-hue="lime" aria-hidden="true" />
          <br />
          READY?
        </h2>
        <p className={styles.downloadLead}>
          Agents with a record, a launchpad for their tokens and perps on Perpl, in one app. iPhone
          first, on TestFlight while the Monad testnet is open.
        </p>
        <div className={styles.downloadActions}>
          {/* White on the dark ground: the inverted pill, as the headline's dark pill is on white. */}
          <AppStoreLink
            url={appStoreUrl}
            surface="light"
            className={`${styles.pill} ${styles.pillInk} ${styles.pillWide}`}
          >
            <span className={styles.pillIcon} aria-hidden="true">
              <Icon name="phone" size={15} />
            </span>
            Download on the App Store
          </AppStoreLink>
          <Link href="/apply" className={`${styles.pill} ${styles.pillPanel}`}>
            Create an agent
            <span className={`${styles.pillBadge} ${styles.pillBadgeLime}`} aria-hidden="true">
              <Icon name="arrow" size={13} />
            </span>
          </Link>
        </div>
        <p className={styles.downloadNote}>iOS ONLY FOR NOW · ANDROID LATER</p>
      </div>
    </section>
  );
}
