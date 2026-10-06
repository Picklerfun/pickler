"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Button, Icon } from "@pickler/ui";
import { railOnServer, railSnapshot, setRail, subscribeRail } from "../lib/rail";
import styles from "./shell.module.css";

/** Reuse the existing browser preference; sidebar state is not agent configuration. */
export function useStudioSidebar() {
  const open = useSyncExternalStore(subscribeRail, railSnapshot, railOnServer);
  const toggle = useCallback(() => {
    const next = !railSnapshot();
    if (!next && window.matchMedia("(max-width: 860px)").matches) {
      const active = document.activeElement;
      const sidebar = active instanceof Element ? active.closest("[data-studio-sidebar]") : null;
      if (sidebar) {
        document
          .querySelector<HTMLButtonElement>(`[data-sidebar-toggle][aria-controls="${sidebar.id}"]`)
          ?.focus();
      }
    }
    setRail(next);
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "b" ||
        (target instanceof HTMLElement &&
          (target.isContentEditable || target.closest("input, textarea, select")))
      ) {
        return;
      }
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [toggle]);

  return { open, toggle };
}

/** One stable disclosure beside the brand, including the pending Studio frame. */
export function StudioSidebarToggle({
  open,
  onToggle,
  controls,
}: {
  open: boolean;
  onToggle(): void;
  controls: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={styles.sidebarToggle}
      data-sidebar-toggle
      aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
      aria-expanded={open}
      aria-controls={controls}
      title={open ? "Collapse sidebar" : "Expand sidebar"}
      onClick={onToggle}
    >
      <Icon name="sidebar" size={18} />
    </Button>
  );
}
