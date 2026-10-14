"use client";

import Image from "next/image";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button, Icon, Tag } from "@pickler/ui";
import { ACTIVE_PRODUCT_NETWORK, MAINNET_NOTE, PRODUCT_NETWORKS } from "./networks";
import styles from "./network-selector.module.css";

/** The product network; this menu never asks a wallet to switch or sign. */
export function NetworkSelector() {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState(0);

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) {
      root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }
  }

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    function position() {
      const anchor = root.current?.getBoundingClientRect();
      const width = menu.current?.parentElement?.getBoundingClientRect().width;
      if (anchor && width) {
        const x = Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12));
        setLeft(x - anchor.left);
      }
    }
    position();
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    function leave(event: FocusEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", leave);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", leave);
    };
  }, [open]);

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      const items = Array.from(
        menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
      );
      if (!items.length) {
        return;
      }
      const current = items.findIndex((item) => item === document.activeElement);
      let next = 0;
      if (event.key === "End" || (event.key === "ArrowUp" && current < 0)) {
        next = items.length - 1;
      } else if (event.key === "ArrowUp") {
        next = (current - 1 + items.length) % items.length;
      } else if (event.key === "ArrowDown") {
        next = (current + 1) % items.length;
      }
      items[next]?.focus();
    }
  }

  return (
    <div ref={root} className={styles.control} data-open={open || undefined} onKeyDown={keyboard}>
      <Button
        variant="secondary"
        size="sm"
        className={styles.trigger}
        aria-label={`Network: ${ACTIVE_PRODUCT_NETWORK.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-describedby={`${id}-note`}
        onClick={() => setOpen(!open)}
      >
        <Image src="/brand/monad.png" width={18} height={18} alt="" />
        <span>Monad</span>
        <Tag className={styles.testnet}>Testnet</Tag>
        <span className={styles.chevron} aria-hidden="true">
          <Icon name="chevronDown" size={13} />
        </span>
      </Button>
      <span id={`${id}-note`} className={styles.note}>
        {MAINNET_NOTE}
      </span>
      {open && (
        <div className={styles.panel} style={{ left }}>
          <div className={styles.heading}>
            <span>Network</span>
            <span className={styles.headingNote}>Monad ecosystem</span>
          </div>
          <div ref={menu} id={`${id}-menu`} role="menu" aria-label="Network">
            {PRODUCT_NETWORKS.map(({ network, available }) => {
              const active = network.chainId === ACTIVE_PRODUCT_NETWORK.chainId;
              return (
                <Button
                  key={network.chainId}
                  variant="tile"
                  className={styles.option}
                  role="menuitemradio"
                  aria-checked={active}
                  disabled={!available}
                  tabIndex={-1}
                  onClick={() => close(true)}
                >
                  <span className={styles.mark} data-muted={!available || undefined}>
                    <Image src="/brand/monad.png" width={28} height={28} alt="" />
                  </span>
                  <span className={styles.words}>
                    <span className={styles.optionName}>
                      {network.testnet ? "Monad Testnet" : "Monad Mainnet"}
                    </span>
                    <span className={styles.optionNote}>
                      {available ? "For building and testing" : "Coming soon"}
                    </span>
                  </span>
                  {active ? (
                    <span className={styles.check} aria-hidden="true">
                      <Icon name="check" size={15} />
                    </span>
                  ) : (
                    <Icon name="lock" size={14} />
                  )}
                </Button>
              );
            })}
          </div>
          <p className={styles.footer}>
            <Icon name="globe" size={12} /> You&apos;re building on Testnet.
          </p>
        </div>
      )}
    </div>
  );
}
