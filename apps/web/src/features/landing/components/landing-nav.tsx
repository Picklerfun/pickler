import Image from "next/image";
import Link from "next/link";
import { Icon } from "@pickler/ui";
import styles from "../landing.module.css";

/**
 * The landing's own bar, and a shorter one than the marketplace's: a brand, one link and the only
 * thing this page is asking for.
 *
 * The action is the one inverted control on it. An inverted block has to be told what it inverts
 * *from* — built as a fixed `data-surface="dark"` it would be a dark pill on a white bar and a dark
 * pill on a dark bar, which is to say invisible on the second. So the bar takes its own surface as
 * an input and the control renders the opposite, the way the marketplace shell does it.
 */
export function LandingNav({
  /** The surface the bar is sitting on, so the one inverted control in it knows what to invert. */
  surface = "light",
}: {
  surface?: "light" | "dark" | undefined;
}) {
  return (
    <nav className={styles.nav} aria-label="Main">
      <div className={styles.navRow}>
        <Link href="/" className={styles.brand}>
          <Image
            src="/brand/logo.png"
            alt=""
            width={128}
            height={135}
            className={styles.logo}
            priority
            unoptimized
          />
          <span className={styles.brandName}>PICKLER</span>
        </Link>

        <a href="#how" className={styles.navLink}>
          HOW IT WORKS
        </a>

        <a
          href="#waitlist"
          className={`${styles.invert} ${styles.navCta}`}
          data-surface={surface === "dark" ? "light" : "dark"}
        >
          Join waitlist
          <span className={styles.arrowBadge} aria-hidden="true">
            <Icon name="arrow" size={13} />
          </span>
        </a>
      </div>
    </nav>
  );
}
