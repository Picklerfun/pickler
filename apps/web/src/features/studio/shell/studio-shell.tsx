"use client";
import { useCallback, useState, type ReactNode } from "react";
import type { Agent } from "../api";
import { CreditsModal } from "../new-agent/credits-modal";
import { WalletsModal } from "../new-agent/wallets-modal";
import { ErrorBanner, PreviewBanner } from "./banners";
import { StudioHeader, StudioTiles } from "./header";
import type { HeaderTile, RailGroup, StudioIdPrefix } from "./model";
import { StudioRail } from "./rail";
import { AgentSelector } from "./agent-selector";
import { useStudioSidebar } from "./sidebar";
import { StudioTopBar } from "./top-bar";
import type { UseAgentStudio } from "./use-agent-studio";
import styles from "./shell.module.css";

/** Which of the shell's two modals is up: "Your wallets" (on this agent's move form or not), or AI credits. */
export type ShellModal = null | { kind: "wallets"; toAgent: boolean | null } | { kind: "credits" };

export interface ShellModals {
  modal: ShellModal;
  /**
   * Open "Your wallets", reading them again. `true` opens this agent's move form toward it ("Fund
   * from master"), `false` back to master, `null` the plain list.
   */
  openWallets(toAgent: boolean | null): void;
  /** Open the AI credits modal. */
  openCredits(): void;
  close(): void;
}

/**
 * The shell's modals as state the studio holds, because its sections open them too (`onWallets`,
 * `onCredits`). `readWallets` is the studio's (`UseAgentStudio`).
 */
export function useShellModals(readWallets: () => Promise<unknown>): ShellModals {
  const [modal, setModal] = useState<ShellModal>(null);
  const openWallets = useCallback(
    (toAgent: boolean | null) => {
      setModal({ kind: "wallets", toAgent });
      void readWallets();
    },
    [readWallets],
  );
  const openCredits = useCallback(() => setModal({ kind: "credits" }), []);
  const close = useCallback(() => setModal(null), []);
  return { modal, openWallets, openCredits, close };
}

export interface StudioShellProps<K extends string> {
  /**
   * `draft` or `live`: the root is `#<idPrefix>-studio`, and the chip, its menu and the rail's
   * items carry the prefix too (`top-bar.tsx`, `rail.tsx`).
   */
  idPrefix: StudioIdPrefix;
  agent: Agent;
  agents: Agent[];
  canManage: boolean;
  /** Why "+ New agent" is shut (`home/gate.ts`'s `newAgentLock`), or "". */
  newAgentLock: string;
  /** The switcher's new-agent item: "+ New agent" unless given (the live studio's "Create another agent"). */
  newAgentLabel?: string | undefined;
  /** The studio's data (`useAgentStudio`, or a hook built on it). */
  studio: Pick<UseAgentStudio, "wallets" | "preview" | "error" | "refresh">;
  /** `useShellModals(studio.readWallets)`. */
  modals: ShellModals;
  /** The selected workspace's status chip (`StatusChip`), below its switcher. */
  status: ReactNode;
  /** The rail's groups, with the current section on. */
  rail: RailGroup<K>[];
  /** Under the rail's groups: the live studio's "PUBLIC PAGE" link. */
  railFooter?: ReactNode;
  onSection(key: K): void;
  /** The line under the name: spans, with `HeaderDot` between them. */
  headerSub: ReactNode;
  /** Right of the name: the draft's status chip, the live studio's controls. */
  headerSide?: ReactNode;
  tiles: HeaderTile[];
  /** The tiles' accessible name ("Your money"). */
  tilesLabel: string;
  /** Between the tiles and the section: the live studio's warnings. */
  banner?: ReactNode;
  onRefreshAgent(): Promise<void>;
  onSwitch(agentId: string): void;
  /** "+ New agent": open the create screen. */
  onNew(): void;
  accountHandle: string | null;
  /** Between the top bar and the body, full width: the live studio's strip. */
  strip?: ReactNode;
  /** The section. */
  children: ReactNode;
}

/**
 * The chrome an agent's studio is drawn in, one implementation for the draft and the published
 * agent (studio-live-v1 L2): the top bar, the rail, the preview note, the header with its tiles,
 * the last failed read, the section, and the Wallets and credits modals. Each studio hands it its
 * own configuration: the status, the rail, the header's line and side, the tiles.
 */
export function StudioShell<K extends string>({
  idPrefix,
  agent,
  agents,
  canManage,
  newAgentLock,
  newAgentLabel,
  studio,
  modals,
  status,
  rail,
  railFooter,
  onSection,
  headerSub,
  headerSide,
  tiles,
  tilesLabel,
  banner,
  onRefreshAgent,
  onSwitch,
  onNew,
  accountHandle,
  strip,
  children,
}: StudioShellProps<K>) {
  const { modal } = modals;
  const sidebar = useStudioSidebar();
  const sidebarId = `${idPrefix}-sidebar`;
  return (
    <main className={styles.studio} id={`${idPrefix}-studio`} data-surface="dark">
      <StudioTopBar
        sidebarOpen={sidebar.open}
        onToggleSidebar={sidebar.toggle}
        sidebarId={sidebarId}
        master={studio.wallets?.master ?? null}
        onWallets={() => modals.openWallets(null)}
        onCredits={modals.openCredits}
        accountHandle={accountHandle}
        preview={studio.preview}
        returnContext={{
          agent: agent.productId ?? agent.id,
          section: rail.flatMap((group) => group.items).find((item) => item.on)?.key,
        }}
      />
      {strip}

      <div className={styles.body}>
        <aside
          className={styles.sidebar}
          aria-label="Agent workspace"
          id={sidebarId}
          data-wide={sidebar.open}
          data-studio-sidebar
          inert={sidebar.mobile && !sidebar.open}
          aria-hidden={(sidebar.mobile && !sidebar.open) || undefined}
        >
          <AgentSelector
            idPrefix={idPrefix}
            agent={agent}
            agents={agents}
            canManage={canManage}
            newAgentLock={newAgentLock}
            newAgentLabel={newAgentLabel}
            status={status}
            onSwitch={onSwitch}
            onNew={onNew}
          />
          <StudioRail
            idPrefix={idPrefix}
            groups={rail}
            onSection={onSection}
            footer={railFooter}
            expanded={sidebar.open}
          />
        </aside>

        <div className={styles.main}>
          <div className={styles.column}>
            {studio.preview && <PreviewBanner />}
            <StudioHeader
              accent={agent.accent}
              pattern={agent.avatarPattern}
              name={agent.name ?? "Your agent"}
              sub={headerSub}
              side={headerSide}
            />
            <StudioTiles tiles={tiles} label={tilesLabel} />
            {studio.error && <ErrorBanner>{studio.error}</ErrorBanner>}
            {banner}
            {children}
          </div>
        </div>
      </div>

      <WalletsModal
        open={modal?.kind === "wallets"}
        wallets={studio.wallets}
        openOn={
          modal?.kind === "wallets" && modal.toAgent !== null
            ? (agent.wallet?.walletId ?? null)
            : null
        }
        openToAgent={modal?.kind === "wallets" ? (modal.toAgent ?? true) : true}
        draft={null}
        preview={studio.preview}
        onClose={modals.close}
        onCredits={modals.openCredits}
        onMoved={() => {
          /* The wallets say what moved; the agent's own balance follows on its next read, so a
             failed reload here is not worth a second alert over the modal. */
          void studio.refresh();
          void onRefreshAgent().catch(() => undefined);
        }}
      />
      <CreditsModal
        open={modal?.kind === "credits"}
        onClose={modals.close}
        onWallets={() => modals.openWallets(null)}
      />
    </main>
  );
}
