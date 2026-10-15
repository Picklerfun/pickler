"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { SidebarProvider, SidebarTrigger, useSidebar } from "@pickler/ui/sidebar";
import { railOnServer, railSnapshot, setRail, subscribeRail } from "../lib/rail";
import styles from "./shell.module.css";

/** The official provider owns interaction; retain the existing desktop preference. */
export function StudioSidebarProvider({ children }: { children: ReactNode }) {
  const open = useSyncExternalStore(subscribeRail, railSnapshot, railOnServer);
  return (
    <SidebarProvider
      open={open}
      onOpenChange={setRail}
      className={styles.sidebarProvider}
      style={{ "--sidebar-width": "218px", "--sidebar-width-icon": "64px" } as React.CSSProperties}
    >
      {children}
    </SidebarProvider>
  );
}

export function StudioSidebarToggle({ controls }: { controls: string }) {
  const { open, isMobile, openMobile } = useSidebar();
  const expanded = isMobile ? openMobile : open;
  return (
    <SidebarTrigger
      className={styles.sidebarToggle}
      data-sidebar-toggle
      aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
      aria-expanded={expanded}
      aria-controls={controls}
      title={expanded ? "Collapse sidebar" : "Expand sidebar"}
    />
  );
}
