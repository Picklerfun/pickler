"use client";

import Image from "next/image";
import Link from "next/link";
import { Button } from "@pickler/ui";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@pickler/ui/sidebar";
import { StudioSidebarProvider, StudioSidebarToggle } from "./sidebar";
import shell from "./shell.module.css";
import { AccountMenu } from "./account-menu";
import { useStudioHref } from "@/features/site/studio-href";
import { StudioSkeleton } from "../skeleton";
import { RAIL } from "../sections/rail";
import home from "../home/home.module.css";
import studio from "../studio.module.css";

/** Keep the same shadcn shell while session and agent selection are unresolved. */
export function StudioPending({
  error,
  onRetry,
  accountHandle,
}: {
  error: string;
  onRetry(): void;
  accountHandle: string | null;
}) {
  const href = useStudioHref();
  return (
    <StudioSidebarProvider>
      <main className={home.home} data-surface="dark" id="studio-pending">
        <header className={home.top}>
          <Link href={href} className={home.brand}>
            <Image src="/brand/logo.png" alt="" width={22} height={23} priority />
            <span>PICKLER</span>
          </Link>
          <StudioSidebarToggle controls="pending-sidebar" />
          <span className={home.spacer} />
          <span className={home.pill} data-tint="grey">
            TESTNET
          </span>
          <AccountMenu handle={accountHandle} preview={false} />
        </header>
        <div className={home.emptyBody}>
          <Sidebar
            collapsible="icon"
            surface="dark"
            className={shell.sidebar}
            id="pending-sidebar"
            aria-label="Studio sections"
          >
            <SidebarContent aria-busy={!error}>
              {RAIL.map((group) => (
                <SidebarGroup key={group.title}>
                  <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
                  <SidebarMenu>
                    {group.items.map((item) => (
                      <SidebarMenuItem key={item.key}>
                        <SidebarMenuSkeleton showIcon />
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroup>
              ))}
            </SidebarContent>
          </Sidebar>
          <div className={home.emptyMain}>
            {error ? (
              <section role="alert">
                <h1 className={studio.stubTitle}>Could not open Studio</h1>
                <p className={studio.stubBody}>{error}</p>
                <Button onClick={onRetry}>Try again</Button>
              </section>
            ) : (
              <StudioSkeleton />
            )}
          </div>
        </div>
      </main>
    </StudioSidebarProvider>
  );
}
