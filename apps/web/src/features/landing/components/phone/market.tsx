import { Icon } from "@pickler/ui";
import { Pill, Screen, Segmented } from "./frame";
import styles from "./phone.module.css";

const TABS = ["Trade it", "Ask an agent"] as const;

const HORIZONS = ["1H", "4H", "24H"] as const;

type Cell = "off" | "call" | "on";

type Level = {
  price: string;
  pct: string;
  tone: "up" | "down";
  cells: readonly [Cell, Cell, Cell];
};

const LEVELS: readonly Level[] = [
  { price: "64,500", pct: "1.4%", tone: "up", cells: ["off", "off", "off"] },
  { price: "64,000", pct: "0.7%", tone: "up", cells: ["call", "on", "off"] },
  { price: "63,750", pct: "0.3%", tone: "up", cells: ["off", "off", "off"] },
  { price: "63,250", pct: "-0.5%", tone: "down", cells: ["off", "off", "off"] },
  { price: "63,000", pct: "-0.9%", tone: "down", cells: ["off", "off", "call"] },
  { price: "62,500", pct: "-1.7%", tone: "down", cells: ["off", "off", "off"] },
];

const LEVERAGE = ["2×", "3×", "5×", "10×"] as const;

const SUMMARY = [
  { label: "SIZE", value: "0.0094 BTC", tone: "ink" },
  { label: "IF IT HITS", value: "+3.92 AUSD", tone: "win" },
  { label: "LIQUIDATION ≈", value: "54,047", tone: "loss" },
] as const;

/* The grid is six price rows of 48px around a 26px mark bar; the sparkline spans all of it, and
 * the dot sits at the mark bar's vertical centre, which is three rows and half the bar down. */
const SPARK_WIDTH = 261;
const SPARK_HEIGHT = 314;
const SPARK_LINE =
  "M0 214 C 30 200, 44 170, 70 176 S 118 236, 146 206 S 196 130, 222 148 S 250 170, 261 157";

function GridCell({ cell }: { cell: Cell }) {
  if (cell === "on") {
    return (
      <span className={`${styles.gridCell} ${styles.gridCellOn}`}>
        <span className={styles.sidePill}>LONG</span>
      </span>
    );
  }
  return (
    <span className={styles.gridCell}>
      <span className={styles.gridDot} data-call={cell === "call" ? "true" : undefined} />
    </span>
  );
}

function LevelRow({ level }: { level: Level }) {
  return (
    <div className={styles.gridRow}>
      <span className={styles.gridPrice}>
        <span className={styles.gridPriceFigure} data-tone={level.tone}>
          {level.price}
        </span>
        <span className={styles.gridPct}>{level.pct}</span>
      </span>
      {level.cells.map((cell, index) => (
        <GridCell key={HORIZONS[index]} cell={cell} />
      ))}
    </div>
  );
}

/** One market with its ticket: the level × time grid, the long side taken, 120 AUSD at 5×. */
export function MarketScreen() {
  return (
    <Screen>
      <div className={styles.marketHeader}>
        <div className={styles.marketTitleRow}>
          <span className={styles.backButton}>
            <Icon name="arrowLeft" size={16} />
          </span>
          <span className={styles.marketTitle}>
            <span className={styles.marketName}>BTC-PERP</span>
            <span className={styles.marketMeta}>7 AGENTS · MAX 10×</span>
          </span>
          <span className={styles.marketPrice}>
            <span className={styles.marketMark}>63,584.2</span>
            <span className={styles.marketChange}>+1.0%</span>
          </span>
        </div>
        <Segmented options={TABS} active={0} />
      </div>
      <div className={styles.marketBody}>
        <div className={styles.gridCard}>
          <div className={styles.gridHead}>
            <span className={styles.gridHeadLabel}>LEVEL × TIME</span>
            <span className={styles.gridHeadPick}>LONG TO 64,000 WITHIN 4H</span>
          </div>
          <div className={styles.gridPanel}>
            <div className={styles.gridRows}>
              <svg
                className={styles.spark}
                width={SPARK_WIDTH}
                height={SPARK_HEIGHT}
                viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
                aria-hidden="true"
              >
                <path className={styles.sparkArea} d={`${SPARK_LINE} V ${SPARK_HEIGHT} H 0 Z`} />
                <path className={styles.sparkLine} d={SPARK_LINE} />
              </svg>
              <span className={styles.sparkDot} />
              {LEVELS.slice(0, 3).map((level) => (
                <LevelRow key={level.price} level={level} />
              ))}
              <div className={styles.markRow} data-surface="dark">
                <span className={styles.markFigure}>63,584.2</span>
                <span className={styles.markLabel}>MARK</span>
              </div>
              {LEVELS.slice(3).map((level) => (
                <LevelRow key={level.price} level={level} />
              ))}
            </div>
            <div className={styles.gridFoot}>
              <span className={styles.gridFootLabel}>TIME</span>
              {HORIZONS.map((horizon) => (
                <span
                  key={horizon}
                  className={styles.gridFootHorizon}
                  data-on={horizon === "4H" ? "true" : undefined}
                >
                  {horizon}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className={styles.legend}>
          <span className={styles.legendDot} />
          AN AGENT HAS A CALL HERE
        </div>
        <div className={styles.ticket}>
          <div className={styles.sideToggle}>
            <span className={`${styles.side} ${styles.sideOn}`}>Long · up</span>
            <span className={styles.side}>Short · down</span>
          </div>
          <div className={styles.marginField}>
            <span className={styles.marginLabel}>MARGIN</span>
            <span className={styles.marginValue}>120</span>
            <span className={styles.marginUnit}>AUSD</span>
          </div>
          <div className={styles.leverageRow}>
            {LEVERAGE.map((option) => {
              if (option === "5×") {
                return (
                  <span
                    key={option}
                    className={`${styles.leverage} ${styles.leverageOn}`}
                    data-surface="dark"
                  >
                    {option}
                  </span>
                );
              }
              return (
                <span key={option} className={styles.leverage}>
                  {option}
                </span>
              );
            })}
          </div>
          <div className={styles.summary}>
            {SUMMARY.map((line) => (
              <span key={line.label} className={styles.summaryLine}>
                <span>{line.label}</span>
                <span className={styles.summaryValue} data-tone={line.tone}>
                  {line.value}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className={styles.actionBar}>
        <span className={styles.actionPhrase}>Long to 64,000 within 4H</span>
        <Pill label="Review · 120 AUSD" icon="arrow" tone="lime" size="lg" />
      </div>
    </Screen>
  );
}
