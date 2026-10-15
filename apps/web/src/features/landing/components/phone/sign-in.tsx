import { Icon } from "@pickler/ui";
import { Brand, Pill, Screen, Segmented } from "./frame";
import styles from "./phone.module.css";

const MODES = ["Sign in", "Sign up"] as const;

/** The sign-in screen at rest: the passkey card first, the creators' email link under it. */
export function SignInScreen() {
  return (
    <Screen>
      <div className={styles.signInHeader}>
        <Brand title="PICKLER" />
        <Segmented options={MODES} active={0} />
      </div>
      <div className={styles.signInBody}>
        <h2 className={styles.signInTitle}>GET IN.</h2>
        <div className={styles.passkeyCard} data-surface="dark">
          <span className={styles.passkeyIcon}>
            <Icon name="fingerprint" size={19} />
          </span>
          <span className={styles.passkeyText}>
            <span className={styles.passkeyTitle}>Continue with Face ID</span>
            <span className={styles.passkeyMeta}>PASSKEY · SAME ACCOUNT ON WEB</span>
          </span>
          <Icon name="arrow" size={16} />
        </div>
        <div className={styles.divider}>
          <span className={styles.dividerLine} />
          <span className={styles.dividerLabel}>CREATORS</span>
          <span className={styles.dividerLine} />
        </div>
        <div className={styles.emailCard}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>EMAIL</span>
            <span className={styles.fieldPlaceholder}>you@email.com</span>
          </div>
          <Pill label="Send me a link" icon="arrow" tone="lime" />
        </div>
      </div>
    </Screen>
  );
}
