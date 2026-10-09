"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button, ButtonLink, Icon } from "@pickler/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pickler/ui/dropdown-menu";
import { useStudioHref } from "./studio-href";
import { AccountMenu } from "@/features/wallet/components/account-menu";
import { useEffect, useState } from "react";
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
      { title: "Markets", href: "/markets", sub: "Every perp, the board, your ticket" },
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

type Menu = (typeof MENUS)[number];

function MenuItems({
  menu,
  pathname,
  compact = false,
}: {
  menu: Menu;
  pathname: string;
  compact?: boolean;
}) {
  return (
    <DropdownMenuGroup
      aria-label={menu.label}
      className={compact ? styles.compactGroup : undefined}
      data-menu={menu.key}
    >
      <DropdownMenuLabel className={styles.groupLabel}>{menu.label}</DropdownMenuLabel>
      {menu.items.map((item) =>
        "href" in item ? (
          <DropdownMenuItem key={item.title} asChild className={styles.item}>
            <Link
              href={item.href}
              aria-current={pathname === item.href.split("#")[0] ? "page" : undefined}
            >
              <span className={styles.itemTitle}>{item.title}</span>
              {!compact && <span className={styles.itemSub}>{item.sub}</span>}
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem key={item.title} disabled className={styles.item}>
            <span className={styles.itemTitle}>
              {item.title}
              <span className={styles.soon}>Soon</span>
            </span>
            {!compact && <span className={styles.itemSub}>{item.sub}</span>}
          </DropdownMenuItem>
        ),
      )}
    </DropdownMenuGroup>
  );
}

export function SiteNav({
  connect = false,
  surface = "light",
}: {
  connect?: boolean;
  surface?: "light" | "dark";
}) {
  const pathname = usePathname();
  const studio = useStudioHref();
  const [open, setOpen] = useState<string | null>(null);

  // Layout stays in CSS. Only dismiss a disclosure whose trigger disappears at the breakpoint.
  useEffect(() => {
    const compact = window.matchMedia("(max-width: 1100px)");
    const dismiss = () =>
      setOpen((current) => {
        const hidden = current === "navigation" ? !compact.matches : compact.matches;
        return hidden ? null : current;
      });
    compact.addEventListener("change", dismiss);
    return () => compact.removeEventListener("change", dismiss);
  }, []);
  const owner = MENUS.find((menu) =>
    menu.items.some((item) => "href" in item && pathname.startsWith(item.href.split("#")[0]!)),
  )?.key;

  return (
    <nav className={styles.nav} aria-label="Main">
      <div className={styles.row}>
        <Link href="/" className={styles.brand} aria-label="Pickler home">
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
            <DropdownMenu
              key={menu.key}
              modal={false}
              open={open === menu.key}
              onOpenChange={(value) =>
                setOpen((current) => (value ? menu.key : current === menu.key ? null : current))
              }
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  mono
                  className={styles.menuButton}
                  data-active={owner === menu.key || undefined}
                >
                  {menu.label}
                  <Icon name="chevronDown" size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                sideOffset={10}
                collisionPadding={12}
                className={styles.dropdown}
                data-surface={surface}
                aria-label={menu.label}
              >
                <MenuItems menu={menu} pathname={pathname} />
              </DropdownMenuContent>
            </DropdownMenu>
          ))}
        </div>

        <div className={styles.actions}>
          {connect && <AccountMenu surface={surface} />}
          <ButtonLink
            as={Link}
            href={studio}
            variant="ghost"
            className={styles.cta}
            data-surface={surface === "dark" ? "light" : "dark"}
            arrow
          >
            Create agent
          </ButtonLink>

          <div className={styles.compactMenu}>
            <DropdownMenu
              modal={false}
              open={open === "navigation"}
              onOpenChange={(value) =>
                setOpen((current) =>
                  value ? "navigation" : current === "navigation" ? null : current,
                )
              }
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className={styles.compactTrigger}
                  aria-label="Navigation menu"
                >
                  <Icon name="menu" size={20} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={10}
                collisionPadding={12}
                className={styles.navigationDropdown}
                data-surface={surface}
                aria-label="Navigation"
              >
                <div className={styles.navigationGroups}>
                  {MENUS.map((menu) => (
                    <MenuItems key={menu.key} menu={menu} pathname={pathname} compact />
                  ))}
                </div>
                <DropdownMenuGroup className={styles.mobileLaunch}>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild className={styles.launchItem}>
                    <ButtonLink
                      as={Link}
                      href={studio}
                      variant="ghost"
                      data-surface={surface === "dark" ? "light" : "dark"}
                      arrow
                    >
                      Create agent
                    </ButtonLink>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </nav>
  );
}
