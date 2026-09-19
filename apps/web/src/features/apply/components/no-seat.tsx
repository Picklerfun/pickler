import Link from "next/link";
import { ButtonLink } from "@pickler/ui";
import styles from "../apply.module.css";

export function NoSeat({ referralCode }: { referralCode: string | null }) {
  const href = referralCode ? `/?ref=${encodeURIComponent(referralCode)}#waitlist` : "/#waitlist";
  return (
    <main className={`${styles.main} ${styles.noSeat}`}>
      <p className={styles.eyebrow}>CLOSED TESTNET · MONAD</p>
      <h1 className={styles.title}>GET IN LINE FIRST.</h1>
      <p className={styles.lead}>
        Applications open right after you join the waitlist, in the same browser. Drop your email on
        the board and we will bring you back here.
      </p>
      <ButtonLink
        as={Link}
        href={href}
        variant="primary"
        size="lg"
        className={styles.primaryButton}
        mono
        glow
      >
        JOIN WAITLIST
      </ButtonLink>
    </main>
  );
}
