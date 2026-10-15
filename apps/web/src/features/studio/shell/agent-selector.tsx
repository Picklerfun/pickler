"use client";

import Image from "next/image";
import { BrandMark, Icon, Skeleton } from "@pickler/ui";
import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@pickler/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@pickler/ui/dropdown-menu";
import type { Agent, StudioWallets } from "../api";
import { formatUnits, unitsOf } from "../new-agent/model";
import { menuAccess } from "../home/access";
import { AgentAvatar } from "./agent-avatar";
import type { StudioIdPrefix } from "./model";
import styles from "./shell.module.css";

/** The official team switcher composition, backed by the existing agent permissions. */
export function AgentSelector({
  idPrefix,
  agent,
  agents,
  canManage,
  newAgentLock,
  newAgentLabel = "+ New agent",
  wallet,
  onSwitch,
  onNew,
}: {
  idPrefix: StudioIdPrefix;
  agent: Agent;
  agents: Agent[];
  canManage: boolean;
  newAgentLock: string;
  newAgentLabel?: string | undefined;
  wallet: StudioWallets["agents"][number] | null;
  onSwitch(agentId: string): void;
  onNew(): void;
}) {
  const { isMobile, state, setOpenMobile } = useSidebar();
  const name = agent.name ?? "Your agent";
  const agentId = agent.productId ?? agent.id;
  const access = menuAccess({
    hasAgent: true,
    canManage,
    researchLock: "",
    fundLock: newAgentLock,
    draftLock: "",
  });
  return (
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                id={`${idPrefix}-agent-chip`}
                aria-label={`${name}, switch agent`}
                tooltip={{ children: `${name}, switch agent`, surface: "dark" }}
              >
                <AgentAvatar accent={agent.accent} pattern={agent.avatarPattern} size="chip" />
                <span className={styles.selectorIdentity} data-sidebar-label>
                  <b>{name}</b>
                  {agent.handle && <small>@{agent.handle}</small>}
                </span>
                <Icon name="chevronsUpDown" size={16} />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              id={`${idPrefix}-agent-menu`}
              data-surface="dark"
              side={isMobile ? "bottom" : "right"}
              align="start"
              sideOffset={8}
              className={styles.agentMenu}
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel>Your agents</DropdownMenuLabel>
                {agents.map((other) => {
                  const id = other.productId ?? other.id;
                  const current = id === agentId;
                  return (
                    <DropdownMenuItem
                      key={id}
                      aria-current={current ? "true" : undefined}
                      onSelect={() => {
                        if (!current) {
                          setOpenMobile(false);
                          onSwitch(id);
                        }
                      }}
                    >
                      <AgentAvatar
                        accent={other.accent}
                        pattern={other.avatarPattern}
                        size="chip"
                      />
                      <span>{other.name ?? id.slice(0, 8)}</span>
                      {other.draft && <span>DRAFT</span>}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  disabled={!access.create}
                  onSelect={() => {
                    setOpenMobile(false);
                    onNew();
                  }}
                >
                  <span>{newAgentLabel}</span>
                </DropdownMenuItem>
                {!access.create && <DropdownMenuLabel>{access.createNote}</DropdownMenuLabel>}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <div
        className={styles.selectorBalances}
        data-sidebar-label
        role="group"
        aria-label={`${name}'s wallet balances`}
        aria-hidden={!isMobile && state === "collapsed"}
      >
        {agent.wallet ? (
          <>
            <span className={styles.selectorAsset}>
              <BrandMark name="ausd" size={13} />
              {wallet?.ausdMicro == null ? (
                <Skeleton className={styles.selectorBalancePlaceholder} />
              ) : (
                <b title={formatUnits(unitsOf(wallet.ausdMicro), "AUSD")}>
                  {formatUnits(unitsOf(wallet.ausdMicro), "AUSD")}
                </b>
              )}
              <small>AUSD</small>
            </span>
            <span className={styles.selectorAsset}>
              <Image src="/brand/monad.png" alt="" width={13} height={13} />
              {wallet?.monWei == null ? (
                <Skeleton className={styles.selectorBalancePlaceholder} />
              ) : (
                <b title={formatUnits(unitsOf(wallet.monWei), "MON")}>
                  {formatUnits(unitsOf(wallet.monWei), "MON")}
                </b>
              )}
              <small>MON</small>
            </span>
          </>
        ) : (
          <small className={styles.selectorAsset}>No agent wallet</small>
        )}
      </div>
    </SidebarHeader>
  );
}
