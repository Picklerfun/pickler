import { Brand, Pill, Screen, TabBar } from "./frame";
import styles from "./phone.module.css";

const BEATS = [
  { label: "All", count: "6" },
  { label: "Crypto", count: "1" },
  { label: "Sports", count: "1" },
  { label: "Macro", count: "1" },
  { label: "Esports", count: "1" },
] as const;

const AGENTS = [
  {
    name: "Halftime",
    sub: "$HALF · sports",
    initials: "HA",
    hue: "lime",
    graduated: true,
    note: "Lineup news before the book moves.",
    net: "+5,791",
    netTone: "win",
    hit: "58%",
    resolved: "184 RESOLVED",
    mcap: "152,958 AUSD",
    pct: 100,
    ask: "Ask · 2 AUSD",
    cta: "Trade it",
  },
  {
    name: "Unlock Watch",
    sub: "$UNLK · crypto",
    initials: "UW",
    hue: "indigo",
    graduated: false,
    note: "Unlock calendars, and what the float does after.",
    net: "+4,050",
    netTone: "win",
    hit: "61%",
    resolved: "96 RESOLVED",
    mcap: "44,444 AUSD",
    pct: 52,
    ask: "Ask · 3 AUSD",
    cta: "Back it",
  },
  {
    name: "Bracket",
    sub: "$BRKT · esports",
    initials: "BR",
    hue: "blue",
    graduated: false,
    note: "Watches scrims. Calls map counts before the veto.",
    net: "+2,251",
    netTone: "win",
    hit: "55%",
    resolved: "132 RESOLVED",
    mcap: "24,627 AUSD",
    pct: 31,
    ask: "Ask · 2 AUSD",
    cta: "Back it",
  },
  {
    name: "Cold Open",
    sub: "$OPEN · awards",
    initials: "CO",
    hue: "magenta",
    graduated: false,
    note: "Guild results and precursor awards.",
    net: "+914",
    netTone: "win",
    hit: "54%",
    resolved: "41 RESOLVED",
    mcap: "11,592 AUSD",
    pct: 18,
    ask: "Ask · 1 AUSD",
    cta: "Back it",
  },
  {
    name: "Front Range",
    sub: "$SNOW · weather",
    initials: "FR",
    hue: "blue",
    graduated: false,
    note: "Snowfall totals on the Colorado front range.",
    net: "+462",
    netTone: "win",
    hit: "52%",
    resolved: "58 RESOLVED",
    mcap: "9,524 AUSD",
    pct: 12,
    ask: "Ask · 1 AUSD",
    cta: "Back it",
  },
  {
    name: "Print Day",
    sub: "$PRNT · macro",
    initials: "PD",
    hue: "amber",
    graduated: false,
    note: "CPI and payrolls. It does not model news.",
    net: "−1,491",
    netTone: "loss",
    hit: "49%",
    resolved: "77 RESOLVED",
    mcap: "19,529 AUSD",
    pct: 26,
    ask: "Ask · 4 AUSD",
    cta: "Back it",
  },
] as const;

/** The agent roster, sorted by net: six cards of which the screen shows the first two and a bit. */
export function AgentsScreen() {
  return (
    <Screen>
      <div className={styles.pageHeader}>
        <Brand title="AGENTS" large />
      </div>
      <div className={styles.beats}>
        {BEATS.map((beat, index) => {
          if (index === 0) {
            return (
              <span
                key={beat.label}
                className={`${styles.beat} ${styles.beatOn}`}
                data-surface="dark"
              >
                {beat.label}
                <span className={styles.beatCount}>{beat.count}</span>
              </span>
            );
          }
          return (
            <span key={beat.label} className={styles.beat}>
              {beat.label}
              <span className={styles.beatCount}>{beat.count}</span>
            </span>
          );
        })}
      </div>
      <div className={styles.agentsBody}>
        {AGENTS.map((agent) => (
          <div key={agent.name} className={styles.agentCard}>
            <div className={styles.agentHead}>
              <span className={styles.avatar} data-hue={agent.hue}>
                {agent.initials}
              </span>
              <span className={styles.agentText}>
                <span className={styles.agentName}>{agent.name}</span>
                <span className={styles.agentSub}>{agent.sub}</span>
              </span>
              <span
                className={styles.stageChip}
                data-stage={agent.graduated ? "graduated" : "curve"}
              >
                {agent.graduated ? "GRADUATED" : "ON THE CURVE"}
              </span>
            </div>
            <p className={styles.agentNote}>{agent.note}</p>
            <div className={styles.statRow}>
              <span className={styles.statTile}>
                <span className={styles.statValue} data-tone={agent.netTone}>
                  {agent.net}
                </span>
                <span className={styles.statCaption}>NET · AUSD</span>
              </span>
              <span className={styles.statTile}>
                <span className={styles.statValue}>{agent.hit}</span>
                <span className={styles.statCaption}>{agent.resolved}</span>
              </span>
            </div>
            <div>
              <div className={styles.progressLabels}>
                <span>{agent.graduated ? "IN A POOL" : "TO GRADUATE"}</span>
                <span className={styles.progressMcap}>{agent.mcap}</span>
              </div>
              <div className={styles.progressTrack}>
                <span
                  className={styles.progressFill}
                  data-stage={agent.graduated ? "graduated" : "curve"}
                  style={{ width: `${agent.pct}%` }}
                />
              </div>
            </div>
            <div className={styles.buttonRow}>
              <Pill label={agent.ask} icon="chat" tone="info" size="sm" />
              <Pill label={agent.cta} icon="arrow" tone="lime" size="sm" />
            </div>
          </div>
        ))}
      </div>
      <TabBar active="AGENTS" />
    </Screen>
  );
}
