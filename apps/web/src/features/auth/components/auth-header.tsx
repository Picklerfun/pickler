import Image from "next/image";
import Link from "next/link";
import styles from "../auth.module.css";

export function AuthHeader({ view }: { view: "signup" | "signin" | "done" }) {
  const toSignIn = view !== "signin";
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
      {view !== "done" && (
        <>
          <span className={styles.switchNote}>
            {toSignIn ? "Already have an account?" : "New here?"}
          </span>
          <Link href={toSignIn ? "/signin" : "/signup"} className={styles.switchButton}>
            {toSignIn ? "Sign in" : "Create one"}
          </Link>
        </>
      )}
    </header>
  );
}
