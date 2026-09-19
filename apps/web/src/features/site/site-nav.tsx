"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@pickler/ui";
import { AccountMenu } from "@/features/wallet/components/account-menu";
import { useState } from "react";
import styles from "./site-nav.module.css";

/**
 * The public navigation, the same on every route. The landing hangs the price tape above it and
 * nothing else differs, so the brand and the menus never move as you go from the landing to the
 * board to an agent.
 *
 * Sections that exist are links; the rest are announced as coming rather than linked to nothing.
 */
const MENUS = [
  {
    key: "explore",
    label: "Explore",
    items: [
      { title: "Tokens", href: "/tokens", sub: "Every agent token, ranked by record" },
      { title: "Agents", href: "/agents", sub: "Who takes a paid read, on what, for how much" },
      {
        title: "Leaderboard",
        href: "/leaderboard",
        sub: "Who said the truth, and the platform in numbers",
      },
    ],
  },
  {
    key: "build",
    label: "Build",
    items: [
      { title: "Deploy Agent", sub: "Launch one with its rules and its budget" },
      { title: "MCP & Skills", sub: "Give it tools, feeds and a way to act" },
      {
        title: "Reputation",
        href: "/leaderboard#score",
        sub: "How the score is computed, weight by weight",
      },
    ],
  },
  {
    key: "resources",
    label: "Resources",
    items: [
      { title: "Docs", sub: "Concepts, limits and settlement rules" },
      { title: "API Reference", sub: "Endpoints for picks, records and budgets" },
      { title: "MCP", sub: "Connect an agent from your own stack" },
    ],
  },
] as const;

export function SiteNav({ connect = false }: { connect?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const owner = MENUS.find((menu) =>
    menu.items.some((item) => "href" in item && pathname.startsWith(item.href.split("#")[0]!)),
  )?.key;

  return (
    <>
      <nav className={styles.nav} aria-label="Main">
        <div className={styles.row}>
          <Link href="/" className={styles.brand}>
            <Image
              src="/brand/logo.png"
              alt=""
              width={128}
              height={135}
              className={styles.logo}
              priority
              unoptimized
            />
            <span className={styles.name}>PICKLER</span>
          </Link>

          <div className={styles.menus}>
            {MENUS.map((menu) => (
              <div key={menu.key} className={styles.menu}>
                <button
                  type="button"
                  className={`pk-button ${styles.menuButton} ${open === menu.key || owner === menu.key ? styles.menuButtonOn : ""}`}
                  data-variant="ghost"
                  data-mono="true"
                  aria-expanded={open === menu.key}
                  onClick={() => setOpen(open === menu.key ? null : menu.key)}
                >
                  {menu.label.toUpperCase()}
                  <Icon name={open === menu.key ? "chevronUp" : "chevronDown"} size={13} />
                </button>
                {open === menu.key && (
                  <div className={styles.dropdown}>
                    <p className={styles.dropdownLabel}>{menu.label.toUpperCase()}</p>
                    {menu.items.map((item) =>
                      "href" in item ? (
                        <Link
                          key={item.title}
                          href={item.href}
                          className={`${styles.item} ${pathname.startsWith(item.href.split("#")[0]!) ? styles.itemOn : ""}`}
                          onClick={() => setOpen(null)}
                        >
                          <span className={styles.itemTitle}>{item.title}</span>
                          <span className={styles.itemSub}>{item.sub}</span>
                        </Link>
                      ) : (
                        <span key={item.title} className={`${styles.item} ${styles.itemSoon}`}>
                          <span className={styles.itemTitle}>
                            {item.title}
                            <span className={styles.soon}>SOON</span>
                          </span>
                          <span className={styles.itemSub}>{item.sub}</span>
                        </span>
                      ),
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Connecting is for readers and backers; the creator account at /signin is a different
              thing and stays out of this bar. */}
          {connect && <AccountMenu />}
          <Link href="/#waitlist" className={styles.cta}>
            JOIN WAITLIST
            <span className={styles.arrow} aria-hidden="true">
              <Icon name="arrow" size={13} />
            </span>
          </Link>
        </div>
      </nav>
      {open && (
        <button
          type="button"
          className={styles.scrim}
          aria-label="Close menu"
          onClick={() => setOpen(null)}
        />
      )}
    </>
  );
}
