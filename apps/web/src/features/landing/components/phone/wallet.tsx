import { Icon } from "@pickler/ui";
import { Brand, Pill, Screen, Segmented, TabBar } from "./frame";
import styles from "./phone.module.css";

const TABS = ["Activity", "Pending"] as const;

const ACTIVITY = [
  {
    title: "Deposit",
    meta: "FROM 0x7f3a…c21e",
    amount: "+500.00",
    hue: "lime",
    tone: "win",
    time: "09:12",
  },
  {
    title: "Margin locked · BTC-PERP",
    meta: "LONG TO 64,000 · 4H",
    amount: "−120.00",
    hue: "indigo",
    tone: "ink",
    time: "09:42",
  },
  {
    title: "Take profit hit · SOL-PERP",
    meta: "SHORT TO 176.00",
    amount: "+18.40",
    hue: "lime",
    tone: "win",
    time: "11:20",
  },
  {
    title: "Read · Halftime",
    meta: "LAKERS −4.5 · 24H WINDOW",
    amount: "−2.00",
    hue: "indigo",
    tone: "ink",
    time: "13:04",
  },
  {
    title: "Backed $UNLK",
    meta: "ON THE CURVE · 900 TOKENS",
    amount: "−640.20",
    hue: "indigo",
    tone: "ink",
    time: "15:31",
  },
  {
    title: "Funding · BTC-PERP",
    meta: "HOURLY, BOTH WAYS",
    amount: "−0.42",
    hue: "indigo",
    tone: "ink",
    time: "16:00",
  },
] as const;

/** The wallet: the balance card, the network row, and the day's activity under a segmented control. */
export function WalletScreen() {
  return (
    <Screen>
      <div className={styles.pageHeader}>
        <Brand title="WALLET" large />
      </div>
      <div className={styles.walletBody}>
        <div className={styles.balanceCard} data-surface="dark">
          <span className={styles.balanceLabel}>AVAILABLE</span>
          <div className={styles.balanceRow}>
            <span className={styles.balanceFigure}>1,240.00</span>
            <span className={styles.balanceUnit}>AUSD</span>
          </div>
          <div className={styles.buttonRow}>
            <Pill label="Deposit" icon="arrowDown" tone="lime" />
            <Pill label="Withdraw" icon="arrowUp" tone="panel" />
          </div>
        </div>
        <div className={styles.networkRow}>
          <span className={styles.networkIcon}>
            <Icon name="globe" size={17} />
          </span>
          <span className={styles.networkText}>
            <span className={styles.networkName}>Monad testnet</span>
            <span className={styles.networkAddress}>0x7f3a…c21e</span>
          </span>
          <span className={styles.connectedChip}>
            <span className={styles.connectedDot} />
            CONNECTED
          </span>
        </div>
        <Segmented options={TABS} active={0} />
        {ACTIVITY.map((row) => (
          <div key={row.title} className={styles.activityRow}>
            <span className={styles.activityDot} data-hue={row.hue} />
            <span className={styles.activityText}>
              <span className={styles.activityTitle}>{row.title}</span>
              <span className={styles.activityMeta}>{row.meta}</span>
            </span>
            <span className={styles.activityRight}>
              <span className={styles.activityAmount} data-tone={row.tone}>
                {row.amount}
              </span>
              <span className={styles.activityTime}>{row.time}</span>
            </span>
          </div>
        ))}
        <p className={styles.footnote}>
          Withdrawals always ask for Face ID. Trades run on your signing session.
        </p>
      </div>
      <TabBar active="WALLET" />
    </Screen>
  );
}
