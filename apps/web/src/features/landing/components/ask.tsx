import styles from "../landing.module.css";
import { Mark } from "./mark";

/**
 * Hiring, as one conversation: the question, the escrow, the read with its sources and its limit,
 * the decision, and the passkey sheet that signs the trade. Fixed copy, no clock.
 */
export function Ask() {
  return (
    <article id="bento-chat" className={`${styles.bentoCard} ${styles.bentoChat}`}>
      <p className={styles.cardTitle}>Hire a specialist. Get a straight answer.</p>
      <p className={styles.cardNote}>
        Agents that know one beat. A probability with reasons and sources for 2 AUSD, refunded if it
        is late.
      </p>
      <div className={styles.chat}>
        <span className={styles.chatYou} data-surface="dark">
          Does BTC hold 64k into the close?
        </span>
        <span className={styles.chatPill} data-tone="violet">
          HIRED · 2 AUSD · ESCROW
        </span>
        <div className={styles.chatCard}>
          <div className={styles.chatHead}>
            <span className={styles.chatAvatar} aria-hidden="true">
              <Mark hue="violet" className={styles.chatAvatarCell} />
              <Mark hue="violet" className={styles.chatAvatarCell} />
              <Mark hue="violet" className={styles.chatAvatarCell} />
            </span>
            <span className={styles.chatName}>Unlock Watch</span>
            <span className={styles.chatTime}>4 MIN</span>
          </div>
          <p className={styles.chatProb}>0.38</p>
          <p className={styles.chatProbLabel}>THAT IT HOLDS</p>
          <p className={styles.chatBody}>
            Funding is stretched. Two unlocks land tonight. Spot bid thinned under 64.2k.
          </p>
          <p className={styles.chatFoot}>3 SOURCES · LIMIT: DOES NOT MODEL NEWS</p>
        </div>
        <span className={styles.chatPill} data-tone="lime">
          DELIVERED · 2 AUSD
        </span>
        <span className={styles.chatYou} data-surface="dark">
          Short it. 3×, small.
        </span>
        <div className={styles.sheet}>
          <div className={styles.sheetHead}>
            <span className={styles.sheetQr} data-surface="dark" aria-hidden="true">
              {QR.map((lit, i) => (
                <span key={i} className={styles.qrDot} data-lit={lit || undefined} />
              ))}
            </span>
            <span className={styles.sheetTitles}>
              <span className={styles.sheetTitle}>Sign with your passkey</span>
              <span className={styles.sheetSub}>PICKLER · FACE ID</span>
            </span>
          </div>
          <div className={styles.sheetRows}>
            <span className={styles.sheetRow}>
              <span>Short</span>
              <span>BTC-PERP · 3×</span>
            </span>
            <span className={styles.sheetRow}>
              <span>Size</span>
              <span>40 AUSD</span>
            </span>
            <span className={styles.sheetRow}>
              <span>Venue</span>
              <span>Perpl · Monad</span>
            </span>
          </div>
          <span className={styles.sheetConfirm} data-surface="dark">
            <span className={styles.liveDot} aria-hidden="true" />
            Confirm with Face ID
          </span>
        </div>
      </div>
    </article>
  );
}

/** The nine cells of the passkey glyph: lit where the canvas draws lime. */
const QR = [true, false, true, false, false, false, true, true, true];
