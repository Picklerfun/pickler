import Image from "next/image";
import Link from "next/link";
import styles from "../auth.module.css";

/**
 * The brand, the network it is on, and nothing else.
 *
 * It used to carry a "Sign in" link beside a form whose first control is a sign-up / sign-in
 * toggle. Two ways to say the same thing is one way too many, and the link was the worse of them:
 * it navigated, which threw away an email already typed into the field below it.
 */
export function AuthHeader() {
  return (
    <header className={styles.header}>
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
      <span className={styles.pill}>TESTNET</span>
      <span className={styles.spacer} />
    </header>
  );
}
