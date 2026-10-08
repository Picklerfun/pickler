import Image from "next/image";
import { Icon, type IconName } from "@pickler/ui";
import type { ReactNode } from "react";
import styles from "./phone.module.css";

/**
 * The parts the four phone screens share: the device body, the brand row, the segmented control,
 * the pill button and the tab bar. Everything here is decoration — the parent hides the whole phone
 * from assistive technology — so a "button" is a span styled like one and nothing takes focus.
 */

export function Screen({ children }: { children: ReactNode }) {
  return (
    <div className={styles.screen} data-surface="light">
      {children}
    </div>
  );
}

export function Brand({ title, large = false }: { title: string; large?: boolean }) {
  const titleClass = large ? styles.brandTitle : styles.brandWordmark;
  return (
    <div className={styles.brand}>
      <Image src="/brand/logo.png" alt="" width={24} height={25} unoptimized />
      <span className={titleClass}>{title}</span>
    </div>
  );
}

export function Segmented({ options, active }: { options: readonly string[]; active: number }) {
  return (
    <div className={styles.segmented}>
      {options.map((option, index) => {
        if (index === active) {
          return (
            <span
              key={option}
              className={`${styles.segment} ${styles.segmentOn}`}
              data-surface="dark"
            >
              {option}
            </span>
          );
        }
        return (
          <span key={option} className={styles.segment}>
            {option}
          </span>
        );
      })}
    </div>
  );
}

export type PillTone = "lime" | "panel" | "info";

export function Pill({
  label,
  icon,
  tone,
  size = "md",
}: {
  label: string;
  icon: IconName;
  tone: PillTone;
  size?: "md" | "lg" | "sm";
}) {
  return (
    <span className={styles.pill} data-tone={tone} data-size={size}>
      {label}
      <Icon name={icon} size={size === "lg" ? 17 : size === "sm" ? 15 : 16} />
    </span>
  );
}

const TABS = [
  { label: "MARKETS", icon: "grid", hue: "lime" },
  { label: "AGENTS", icon: "users", hue: "indigo" },
  { label: "PORTFOLIO", icon: "chart", hue: "amber" },
  { label: "WALLET", icon: "wallet", hue: "magenta" },
] as const;

export type TabLabel = (typeof TABS)[number]["label"];

export function TabBar({ active }: { active: TabLabel }) {
  return (
    <div className={styles.tabBar}>
      {TABS.map((tab) => {
        const on = tab.label === active;
        const tabClass = on ? `${styles.tab} ${styles.tabOn}` : styles.tab;
        return (
          <span key={tab.label} className={tabClass}>
            <span className={styles.tabIcon} data-hue={tab.hue}>
              <Icon name={tab.icon} size={19} />
            </span>
            <span className={styles.tabLabel}>{tab.label}</span>
          </span>
        );
      })}
    </div>
  );
}
