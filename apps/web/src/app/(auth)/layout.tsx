import type { Metadata } from "next";
import type { ReactNode } from "react";
import styles from "@/features/auth/auth.module.css";

// Not linked from the landing while the waitlist is the public entry point.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page} data-surface="console">
      <div className={styles.floor} aria-hidden="true" />
      {children}
    </div>
  );
}
