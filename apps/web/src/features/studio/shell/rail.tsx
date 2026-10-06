"use client";
import type { ReactNode } from "react";
import { Icon } from "@pickler/ui";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  useSidebar,
} from "@pickler/ui/sidebar";
import type { RailGroup, StudioIdPrefix } from "./model";

export const railItemId = (idPrefix: StudioIdPrefix, key: string): string =>
  `${idPrefix}-rail-${key}`;

export interface StudioRailProps<K extends string> {
  idPrefix: StudioIdPrefix;
  groups: RailGroup<K>[];
  onSection(key: K): void;
  footer?: ReactNode;
}

/** shadcn supplies collapse, focus and tooltips; Studio supplies permitted sections. */
export function StudioRail<K extends string>({
  idPrefix,
  groups,
  onSection,
  footer,
}: StudioRailProps<K>) {
  const { setOpenMobile } = useSidebar();
  return (
    <>
      <SidebarContent role="navigation" aria-label="Agent sections">
        {groups.map((group) => (
          <SidebarGroup key={group.title}>
            <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      id={railItemId(idPrefix, item.key)}
                      type="button"
                      isActive={item.on}
                      aria-current={item.on ? "page" : undefined}
                      aria-label={
                        item.locked ? `${item.label} · ${item.title ?? item.label}` : item.label
                      }
                      data-locked={item.locked || undefined}
                      tooltip={{ children: item.title ?? item.label, surface: "dark" }}
                      onClick={() => {
                        onSection(item.key);
                        setOpenMobile(false);
                      }}
                    >
                      <Icon name={item.icon} />
                      <span data-sidebar-label>{item.label}</span>
                      {item.locked && <Icon name="lock" />}
                    </SidebarMenuButton>
                    {item.badge !== undefined && item.badge > 0 && (
                      <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      {footer && <SidebarFooter>{footer}</SidebarFooter>}
    </>
  );
}
