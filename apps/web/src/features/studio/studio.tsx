"use client";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button, Icon, type IconName } from "@pickler/ui";
import { ensureProfile } from "@/features/auth/lib/account";
import { readSubOrganization, redirectFor } from "@/features/auth/lib/custody";
import { passkeys as readPasskeys, wallet as readWallet } from "@/features/auth/lib/custody-api";
import type { PasskeysKnown } from "@/features/auth/lib/second-passkey";
import { getSupabase } from "@/features/auth/lib/supabase-browser";
import {
  studioApi,
  studioAgent,
  errorCode,
  type Agent,
  type Catalog,
  type Config,
  type Options,
  type Run,
  type RunEvent,
} from "./api";
import { useMarketplaceHref } from "@/features/site/studio-href";
import { useNow } from "@/lib/now";
import { agentInitials } from "./lib/initials";
import { startPolling } from "./lib/polling";
import { selectAgent } from "./lib/select";
import { draftLimitLock, newAgentLock as lockFor } from "./home/gate";
import { studioPreview } from "./preview";
import { railOnServer, railSnapshot, setRail, subscribeRail } from "./lib/rail";
import { Overview } from "./sections/overview";
import { Picks } from "./sections/picks";
import { Activity } from "./sections/activity";
import { Skills } from "./sections/skills";
import { Brief } from "./sections/brief";
import { Trading } from "./sections/trading";
import { Limits } from "./sections/limits";
import { Context } from "./sections/context";
import type { SectionKey } from "./sections/keys";
import { RAIL, isPanel, isSoon } from "./sections/rail";
import { Soon } from "./sections/soon";
import { Home } from "./home/home";
import { homeFixture } from "./home/fixture";
import {
  isCreateStage,
  isDraftStage,
  isHomeStage,
  isLiveStage,
  type StudioStage,
} from "./home/stage";
import { DraftStudio } from "./draft/draft-studio";
import { draftStudioFixture } from "./draft/fixture";
import { DRAFT_SECTIONS, type DraftSectionKey } from "./draft/model";
import { LiveStudio } from "./live/live-studio";
import { liveStudioFixture } from "./live/fixture";
import { isLiveSection, studioKind, type LiveSectionKey } from "./live/model";
import { newAgentFixture } from "./new-agent/fixture";
import { NewAgent } from "./new-agent/new-agent";
import { studioLanding } from "./lib/landing";
import styles from "./studio.module.css";

type Access = { enabled: boolean; canManage: boolean; workspaceId: string };

/**
 * The states a person actually lands in. Each one is a code the API returns, so the banner says the
 * same thing the transport did and the copy explains what unblocks it.
 */
const BLOCKED: Record<
  string,
  { tint: string; icon: IconName; title: string; note: string; cta: string; to: SectionKey | null }
> = {
  RESEARCH_ACCESS_DENIED: {
    tint: "magenta",
    icon: "lock",
    title: "Research is not enabled on this workspace yet",
    note: "An operator switches it on by hand. Creating agents, editing settings and starting runs stay locked until then.",
    cta: "Refresh access",
    to: null,
  },
  NOT_READY: {
    tint: "amber",
    icon: "clock",
    title: "The schedule is locked",
    note: "It unlocks after a connection check and one successful manual run with this exact config. Run it once by hand first.",
    cta: "Run it by hand",
    to: "overview",
  },
  QUOTA: {
    tint: "amber",
    icon: "alert",
    title: "Research quota used up",
    note: "This agent has spent its runs for the rolling window. Everything already produced stays readable; the next slot frees as the window rolls.",
    cta: "See activity",
    to: "activity",
  },
  ADMISSIONS_PAUSED: {
    tint: "violet",
    icon: "pause",
    title: "New runs are paused by the operator",
    note: "Nothing is lost: past runs, decisions and traces stay available. Scheduled runs resume when admissions reopen.",
    cta: "See activity",
    to: "activity",
  },
  PLUGIN_NOT_CONFIGURED: {
    tint: "magenta",
    icon: "key",
    title: "A plugin you turned on needs credentials",
    note: "The operator holds the key. Once it is set, reload and the next run picks it up.",
    cta: "Open skills",
    to: "skills",
  },
  CONFLICT: {
    tint: "amber",
    icon: "alert",
    title: "Someone else changed this agent",
    note: "The configuration moved while you were editing, or the handle was taken. Reload before saving again.",
    cta: "Reload",
    to: null,
  },
};

/** The home, one of the sections the rail and the home's Menu reach, or the create screen. */
type View = SectionKey | "home" | "new";

export function Studio({
  openSection,
  stage,
  openAgent,
}: {
  openSection?: SectionKey | undefined;
  /** `?agent=<id>`: the agent to open on; the first one when absent or not the person's. */
  openAgent?: string | undefined;
  /** `?stage=`, outside production only: the home at one moment of the canvas's first run, the
      create screen at one moment (`create-*`), the draft studio (`draft*`), or `empty`, the
      create screen with nothing staged. */
  stage?: StudioStage | undefined;
}) {
  const router = useRouter();
  const directory = useMarketplaceHref("/agents");
  const leaderboard = useMarketplaceHref("/leaderboard");
  /* Built once, during the first render, so the server's HTML already carries the staged home. */
  const [staged] = useState(() => (isHomeStage(stage) ? homeFixture(stage) : null));
  const [stagedDraft] = useState(() => (isDraftStage(stage) ? draftStudioFixture(stage) : null));
  const [stagedLive] = useState(() => (isLiveStage(stage) ? liveStudioFixture(stage) : null));
  const [stagedCreate] = useState(() => (isCreateStage(stage) ? newAgentFixture(stage) : null));
  const [stagedEmpty] = useState(stage === "empty" || isCreateStage(stage));
  /* Every staged screen stands alone: no session is read and nothing is fetched. */
  const staging = staged !== null || stagedDraft !== null || stagedLive !== null || stagedEmpty;
  const stagedAgent = staged?.agent ?? stagedDraft?.agent ?? stagedLive?.agent ?? null;
  const [section, setSection] = useState<View>(openSection ?? "home");
  const wide = useSyncExternalStore(subscribeRail, railSnapshot, railOnServer);
  const [access, setAccess] = useState<Access | null>(
    staging ? { enabled: true, canManage: true, workspaceId: "preview" } : null,
  );
  /* Whether the agents have been read, so an empty list means "none yet" rather than "not read". */
  const [loaded, setLoaded] = useState(staging);
  const [agents, setAgents] = useState<Agent[]>(stagedAgent ? [stagedAgent] : []);
  const [agentId, setAgentId] = useState<string | null>(stagedAgent?.id ?? null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [runs, setRuns] = useState<Run[]>(staged?.runs ?? []);
  const [runId, setRunId] = useState<string | null>(staged?.runs[0]?.id ?? null);
  const [trace, setTrace] = useState<{ runId: string; events: RunEvent[] } | null>(
    staged?.runs[0] ? { runId: staged.runs[0].id, events: staged.events } : null,
  );
  const [refresh, setRefresh] = useState(0);
  const [blocked, setBlocked] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<"agent" | "account" | null>(null);
  /* The signed-in account's handle, for the draft studio's YOU sections. */
  const [accountHandle, setAccountHandle] = useState<string | null>(null);
  /* Go Public landed: the live studio that replaces the draft opens on its Overview (live L1). */
  const [published, setPublished] = useState(false);
  const [preview, setPreview] = useState(staging);
  /* The account's passkeys, read once per visit for the home's second-passkey suggestion. A failed
     read is `failed`, which suggests nothing and never fails the studio. */
  const [passkeys, setPasskeys] = useState<PasskeysKnown>(
    /* The staged home is the canvas's account: one passkey, so the design harness measures the
       suggestion on a route it can reach. Nothing is read. */
    staging ? { kind: "ready", passkeys: [{ id: "staged" }] } : { kind: "loading" },
  );
  const requestKeys = useRef(new Map<string, string>());

  const agent = agents.find((candidate) => (candidate.productId ?? candidate.id) === agentId);
  const canManage = Boolean(access?.canManage);
  /* The same lock the home's "+ New agent" honours, so neither entry reaches a passkey prompt the
     API would refuse after it. */
  const newAgentLock = useMemo(() => lockFor(agents), [agents]);
  const events = trace && trace.runId === runId ? trace.events : [];
  const now = useNow();

  const loadAgents = useCallback(async () => {
    const [current, list] = await Promise.all([
      studioApi<Access>("/me"),
      studioApi<{ agents: Agent[] }>("/agents"),
    ]);
    setAccess(current);
    setAgents(list.agents);
    setBlocked(current.enabled ? "" : "RESEARCH_ACCESS_DENIED");
    return list.agents;
  }, []);

  useEffect(() => {
    if (staging) {
      return;
    }
    let active = true;
    void (async () => {
      try {
        const supabase = getSupabase();
        if (!supabase) {
          /* No authentication anywhere in this environment, so there is no studio to stand in
             front of. Outside production the screen renders from a fixture instead of a dead end,
             because a design check that walks a sign-in stub reports the same green as one that
             walked the studio. */
          const fixture = studioPreview(Date.now(), window.location.search);
          if (!fixture) {
            throw new Error("Authentication is not configured for this environment.");
          }
          if (!active) {
            return;
          }
          setPreview(true);
          setAccess({ enabled: true, canManage: true, workspaceId: "preview" });
          setAgents(fixture.agents);
          setLoaded(true);
          setCatalog(fixture.catalog);
          setOptions(fixture.options);
          /* The empty studio's fixture has neither, and indexing into it threw where the catch
             turned a crash into a blank screen with the catalog never set. */
          const run = fixture.runs[0];
          setAgentId(selectAgent(fixture.agents, openAgent));
          if (run) {
            setRuns(fixture.runs);
            setRunId(run.id);
            setTrace({ runId: run.id, events: fixture.events });
          }
          return;
        }
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          router.replace("/signin");
          return;
        }
        /* The master wallet exists before any agent (spec §4.1): the profile, top right, shows it
           from the first visit. A person without a sub-organization — a sign-up closed at the
           passkey step, an account from before it was mandatory — creates it before anything else
           renders, and the profile is not even read until there is one: signup saves the handle
           only after the wallet, and `ensureProfile` could otherwise write one ahead of it. Then a
           wallet without a profile finishes signup at the handle step. A read that fails for
           another reason propagates like every other load error. */
        const token = data.session.access_token;
        const wallet = await readSubOrganization(() => readWallet(token));
        const account = wallet === null ? null : await ensureProfile(supabase);
        if (active && account?.kind === "ready") {
          setAccountHandle(account.profile.handle);
        }
        const away = redirectFor({
          wallet,
          profile: account?.kind === "ready" ? account.profile : null,
        });
        if (away) {
          if (active) {
            router.replace(away);
          }
          return;
        }
        await studioApi("/onboard", { method: "POST" });
        const [list, cat, opts, keys] = await Promise.all([
          loadAgents(),
          studioApi<Catalog>("/market-categories"),
          studioApi<Options>("/options"),
          readPasskeys(token).then(
            (value): PasskeysKnown => ({ kind: "ready", passkeys: value }),
            (): PasskeysKnown => ({ kind: "failed" }),
          ),
        ]);
        if (!active) {
          return;
        }
        setPasskeys(keys);
        /* No agents lands on the create screen, inside the studio's frame. */
        setLoaded(true);
        setCatalog(cat);
        setOptions(opts);
        setAgentId(selectAgent(list, openAgent));
      } catch (caught) {
        if (active) {
          setBlocked(errorCode(caught) in BLOCKED ? errorCode(caught) : "");
          setError(caught instanceof Error ? caught.message : "Could not load the studio.");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [router, loadAgents, staging, openAgent]);

  /* One cancellable read loop owns both the run list and the selected trace. The home reads its
     own latest run, so the loop only runs while a section is showing. */
  /* Which studio the agent opens (live L1): a draft's and a published Perpl agent's each read
     their own data (`draft/use-draft.ts`, `live/use-live.ts`) and have no runs to follow. */
  const kind = agent ? studioKind(agent) : null;
  const ownStudio = kind === "draft" || kind === "live";
  useEffect(() => {
    if (!agentId || preview || ownStudio || section === "home" || section === "new") {
      return;
    }
    return startPolling(
      async (signal) => {
        const list = await studioApi<{ runs: Run[] }>(`/agents/${agentId}/runs`, { signal });
        if (signal.aborted) {
          return null;
        }
        setRuns(list.runs);
        const selected = runId ?? list.runs[0]?.id ?? null;
        setRunId(selected);
        if (selected) {
          const body = await studioApi<{ events: RunEvent[] }>(`/runs/${selected}/events`, {
            signal,
          });
          if (signal.aborted) {
            return null;
          }
          setTrace({ runId: selected, events: body.events });
        }
        const active = list.runs.some((run) => run.status === "queued" || run.status === "running");
        return active ? 3000 : agent?.scheduleEnabled ? 20000 : null;
      },
      (caught) => {
        setError(caught instanceof Error ? caught.message : "Could not refresh research.");
      },
    );
  }, [agentId, runId, agent?.scheduleEnabled, refresh, preview, section, ownStudio]);

  /* The home's reads of one agent: its wallet balance and both locks, fresh from the API. */
  const refreshAgent = useCallback(async () => {
    if (!agentId || preview) {
      return;
    }
    const fresh = await studioAgent(agentId);
    setAgents((list) =>
      list.map((candidate) =>
        (candidate.productId ?? candidate.id) === agentId ? fresh : candidate,
      ),
    );
  }, [agentId, preview]);

  const act = useCallback(
    async (operation: () => Promise<void>) => {
      /* A preview has no workspace behind it: every write stops here, as the home's do. */
      if (preview) {
        setError("Preview · fixture data, nothing is saved.");
        return;
      }
      setBusy(true);
      setError("");
      try {
        await operation();
        await loadAgents();
        setRefresh((value) => value + 1);
      } catch (caught) {
        const code = errorCode(caught);
        if (code in BLOCKED) {
          setBlocked(code);
        }
        setError(caught instanceof Error ? caught.message : "Request failed.");
      } finally {
        setBusy(false);
      }
    },
    [loadAgents, preview],
  );

  const runNow = useCallback(
    (marketId: string) =>
      act(async () => {
        if (!agentId) {
          return;
        }
        const key = requestKeys.current.get(agentId) ?? crypto.randomUUID();
        requestKeys.current.set(agentId, key);
        const result = await studioApi<{ runId: string }>(`/agents/${agentId}/runs`, {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body: JSON.stringify(marketId ? { marketId } : {}),
        });
        requestKeys.current.delete(agentId);
        setRunId(result.runId);
        setSection("activity");
      }),
    [act, agentId],
  );

  const saveConfig = useCallback(
    (config: Config) =>
      act(async () => {
        if (!agent) {
          return;
        }
        await studioApi(`/agents/${agent.productId ?? agent.id}/config`, {
          method: "PUT",
          body: JSON.stringify({ expectedVersion: agent.version, config }),
        });
      }),
    [act, agent],
  );

  const counts = useMemo(() => {
    const day = now - 24 * 60 * 60 * 1000;
    return {
      picks: runs.filter((run) => run.decision).length,
      running: runs.filter((run) => run.status === "queued" || run.status === "running").length,
      today: runs.filter((run) => run.createdAt >= day).length,
    };
  }, [runs, now]);

  const blockedState = blocked ? BLOCKED[blocked] : undefined;
  const runsLocked = Boolean(blocked) && blocked !== "NOT_READY" && blocked !== "CONFLICT";
  const scheduleLocked = blocked === "NOT_READY" || blocked === "RESEARCH_ACCESS_DENIED";
  const statusTint = agent?.paused ? "magenta" : blocked ? "amber" : "lime";
  const statusLabel = agent?.paused
    ? "PAUSED"
    : blocked
      ? "BLOCKED"
      : counts.running
        ? "RUNNING"
        : "LIVE";
  const quotaMax = agent?.config.limits.dailyRuns ?? 0;
  const name = agent?.name ?? "No agent";
  const badges: Partial<Record<SectionKey, { text: string; tint: string }>> = {
    picks: counts.picks ? { text: String(counts.picks), tint: "grey" } : { text: "", tint: "grey" },
    activity: counts.running
      ? { text: `${counts.running} RUNNING`, tint: "lime" }
      : { text: "", tint: "grey" },
  };
  const badgeFor = (key: SectionKey) =>
    isSoon(key) ? { text: "SOON", tint: "grey" } : badges[key];

  function go(next: View) {
    if (next === "picks" && !runs.find((run) => run.id === runId)?.decision) {
      setRunId(runs.find((run) => run.decision)?.id ?? null);
    }
    setSection(next);
    setMenu(null);
  }

  /* With no agent every section would be empty, so any section asked for lands on the create
     screen; its Menu lists them disabled. With agents, "+ New agent" opens the same screen. */
  const landing = studioLanding(loaded, agents, section);
  if (landing === "new") {
    return (
      <NewAgent
        passkeys={passkeys}
        canManage={canManage}
        preview={preview}
        locked={blockedState ? { title: `${blockedState.title}.`, note: blockedState.note } : null}
        error={error}
        staged={stagedCreate}
        hasAgents={agents.length > 0}
        draftLock={draftLimitLock(agents)}
        onBack={agent ? () => setSection("home") : undefined}
        backTo={agent?.name ?? undefined}
        onCreated={async (productId) => {
          await loadAgents();
          setAgentId(productId);
          setRunId(null);
          setRuns([]);
          setTrace(null);
          setSection("home");
        }}
      />
    );
  }

  /* A private draft has its own studio (studio-draft-dashboard-v1 D1), whichever section was
     asked for; publishing reloads the agent, which then opens below as a live one. */
  if (landing !== "loading" && agent && kind === "draft") {
    return (
      <DraftStudio
        key={agentId}
        agent={agent}
        agents={agents}
        canManage={canManage}
        newAgentLock={newAgentLock}
        staged={stagedDraft}
        preview={preview}
        initialSection={draftSection(openSection)}
        accountHandle={stagedDraft?.accountHandle ?? accountHandle}
        onRefreshAgent={refreshAgent}
        onPublished={() => {
          setPublished(true);
          setSection("home");
        }}
        onSwitch={(id) => {
          setAgentId(id);
          setRunId(null);
          setRuns([]);
          setTrace(null);
          setError("");
          setSection("home");
        }}
        onNew={() => {
          setError("");
          setSection("new");
        }}
      />
    );
  }

  /* A published Perpl agent has its own studio too (live L1), whichever section was asked for; a
     `?section=` it also has carries over, and Go Public lands on its Overview. */
  if (landing !== "loading" && agent && kind === "live") {
    return (
      <LiveStudio
        key={agentId}
        agent={agent}
        agents={agents}
        canManage={canManage}
        newAgentLock={newAgentLock}
        staged={stagedLive}
        preview={preview}
        initialSection={published ? "overview" : liveSection(openSection)}
        accountHandle={stagedLive?.accountHandle ?? accountHandle}
        onRefreshAgent={refreshAgent}
        onSwitch={(id) => {
          setAgentId(id);
          setRunId(null);
          setRuns([]);
          setTrace(null);
          setError("");
          setPublished(false);
          setSection("home");
        }}
        onNew={() => {
          setError("");
          setSection("new");
        }}
      />
    );
  }

  if (landing === "home" && agent) {
    return (
      <Home
        key={agentId}
        agent={agent}
        passkeys={passkeys}
        agents={agents}
        canManage={canManage}
        preview={
          preview
            ? {
                now: staged?.now ?? now,
                runs,
                events: trace?.events ?? [],
                order: staged?.order ?? null,
              }
            : null
        }
        onRefreshAgent={refreshAgent}
        onSection={go}
        onPick={(id) => {
          setRunId(id);
          setSection("picks");
        }}
        onSwitch={(id) => {
          setAgentId(id);
          setRunId(null);
          setRuns([]);
          setTrace(null);
          setError("");
        }}
        onNew={() => {
          setError("");
          setSection("new");
        }}
      />
    );
  }

  return (
    <main className={styles.studio} data-surface="dark" onClick={() => setMenu(null)}>
      <header className={styles.topbar}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => setRail(!wide)}
          aria-label={wide ? "Collapse the rail" : "Expand the rail"}
        >
          <Icon name={wide ? "chevronLeft" : "chevronRight"} size={16} />
        </button>
        <Link href="/" className={styles.brand}>
          <Image src="/brand/logo.png" alt="" width={22} height={22} priority />
          <span>PICKLER</span>
        </Link>

        <div className={styles.menuWrap} onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={styles.switcher}
            aria-expanded={menu === "agent"}
            onClick={() => setMenu(menu === "agent" ? null : "agent")}
          >
            <span className={styles.avatar} data-tint="lime">
              {agentInitials(name)}
            </span>
            <span>
              <b>{name}</b>
              <small>
                {agent?.handle ? `@${agent.handle}` : "no handle"} ·{" "}
                {agent?.config.marketScope?.subcategories === "all"
                  ? "all sports"
                  : (agent?.config.marketScope?.subcategories ?? []).join(", ") || "sports"}
              </small>
            </span>
            <Icon name="chevronDown" size={14} />
          </button>
          {menu === "agent" && (
            <div className={styles.menu} role="menu">
              {agents.map((candidate) => {
                const id = candidate.productId ?? candidate.id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    aria-current={id === agentId}
                    onClick={() => {
                      setAgentId(id);
                      setRunId(null);
                      setRuns([]);
                      setTrace(null);
                      setBlocked(access?.enabled ? "" : "RESEARCH_ACCESS_DENIED");
                      setError("");
                      setMenu(null);
                    }}
                  >
                    <Icon name="target" size={15} />
                    {candidate.name ?? id.slice(0, 8)}
                  </button>
                );
              })}
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                disabled={!canManage || newAgentLock !== ""}
                title={newAgentLock || undefined}
                onClick={() => {
                  setMenu(null);
                  setError("");
                  setSection("new");
                }}
              >
                <Icon name="bolt" size={15} />
                <span className={styles.menuLabel}>
                  New agent
                  {newAgentLock && <small className={styles.menuNote}>{newAgentLock}</small>}
                </span>
              </button>
            </div>
          )}
        </div>

        <span className={styles.status} data-tint={statusTint}>
          <span className={styles.dot} data-live={statusLabel === "RUNNING"} />
          {statusLabel}
        </span>
        <span className={styles.spacer} />
        {quotaMax > 0 && (
          <span className={styles.pill} title="Runs started in the last rolling day">
            {counts.today}
            <em>/{quotaMax} RUNS</em>
          </span>
        )}
        <span className={styles.pill} data-quiet="true">
          STAGING
        </span>

        <div className={styles.menuWrap} onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={styles.switcher}
            data-quiet="true"
            aria-expanded={menu === "account"}
            aria-label="Account"
            onClick={() => setMenu(menu === "account" ? null : "account")}
          >
            <span className={styles.swatch} aria-hidden="true">
              <i data-swatch="lime" />
              <i data-swatch="violet" />
              <i data-swatch="amber" />
              <i data-swatch="blue" />
            </span>
            <Icon name="chevronDown" size={14} />
          </button>
          {menu === "account" && (
            <div className={styles.menu} data-align="right" role="menu">
              <Link href={directory} className={styles.menuItem} role="menuitem">
                <Icon name="globe" size={15} />
                Explore the board
              </Link>
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() =>
                  void (async () => {
                    await getSupabase()?.auth.signOut();
                    router.replace("/signin");
                  })()
                }
              >
                <Icon name="lock" size={15} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <div className={styles.body}>
        <nav className={styles.rail} data-wide={wide} aria-label="Studio sections">
          <div className={styles.railGroups}>
            <div className={styles.railItems}>
              <button
                type="button"
                className={styles.railItem}
                title="Home"
                onClick={() => go("home")}
              >
                <Icon name="arrowLeft" size={17} />
                {wide && <span className={styles.railLabel}>Home</span>}
              </button>
            </div>
            {RAIL.map((group) => (
              <div key={group.title}>
                {wide && <p className={styles.railTitle}>{group.title}</p>}
                <div className={styles.railItems}>
                  {group.items.map((item) => {
                    const badge = badgeFor(item.key);
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={styles.railItem}
                        aria-current={section === item.key}
                        title={item.label}
                        onClick={() => go(item.key)}
                      >
                        <Icon name={item.icon} size={17} />
                        {wide && (
                          <>
                            <span className={styles.railLabel}>{item.label}</span>
                            {badge?.text && (
                              <span className={styles.badge} data-tint={badge.tint}>
                                {badge.text}
                              </span>
                            )}
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className={styles.railFoot}>
            {wide && (
              <>
                <Link href={directory} className={styles.railLink}>
                  <Icon name="users" size={15} />
                  Every agent
                </Link>
                <Link href={leaderboard} className={styles.railLink}>
                  <Icon name="bars" size={15} />
                  Leaderboard
                </Link>
              </>
            )}
            <button
              type="button"
              className={styles.railPause}
              data-paused={agent?.paused ?? false}
              disabled={!agent || !canManage || busy}
              title={agent?.paused ? "Resume agent" : "Pause agent"}
              onClick={() =>
                void act(async () => {
                  await studioApi(`/agents/${agentId}/pause`, {
                    method: "PUT",
                    body: JSON.stringify({ paused: !agent?.paused }),
                  });
                })
              }
            >
              <Icon name={agent?.paused ? "play" : "pause"} size={14} />
              {wide && <span>{agent?.paused ? "Resume agent" : "Pause agent"}</span>}
            </button>
          </div>
        </nav>

        <div className={styles.main} id={`studio-panel-${section}`}>
          {preview && (
            <p className={styles.preview} role="status">
              <Icon name="alert" size={13} />
              {staged
                ? "Preview · fixture data, nothing is saved."
                : "Design preview. This build has no authentication configured, so the studio is drawn from a fixture — every number below is from the canvas, not from a workspace."}
            </p>
          )}
          {blockedState && (
            <section className={styles.blocked} data-tint={blockedState.tint} role="status">
              <span className={styles.blockedMark}>
                <Icon name={blockedState.icon} size={18} />
              </span>
              <span className={styles.blockedBody}>
                <span className={styles.blockedHead}>
                  <b>{blockedState.title}</b>
                  <span className={styles.code}>{blocked}</span>
                </span>
                <span className={styles.blockedNote}>{blockedState.note}</span>
              </span>
              <Button
                className={styles.blockedCta}
                onClick={() => (blockedState.to ? go(blockedState.to) : window.location.reload())}
              >
                {blockedState.cta}
              </Button>
            </section>
          )}

          {!agent ? (
            /* Only while the agents are read, or when that read failed: none at all is the empty
               home, above. */
            !error && <p className={styles.stubBody}>Reading your agents…</p>
          ) : section === "overview" ? (
            <Overview
              agent={agent}
              runs={runs}
              runsToday={counts.today}
              now={now}
              busy={busy}
              canManage={canManage}
              runsLocked={runsLocked}
              scheduleLocked={scheduleLocked}
              blocked={blocked}
              onRun={runNow}
              onSchedule={() =>
                void act(async () => {
                  await studioApi(`/agents/${agentId}/schedule`, {
                    method: "PUT",
                    body: JSON.stringify({ enabled: !agent.scheduleEnabled }),
                  });
                })
              }
              onOpen={(run) => {
                setRunId(run.id);
                setSection(run.decision ? "picks" : "activity");
              }}
              go={go}
            />
          ) : section === "picks" ? (
            <Picks
              runs={runs}
              runId={runId}
              events={events}
              onSelect={setRunId}
              onTrace={(id) => {
                setRunId(id);
                setSection("activity");
              }}
            />
          ) : section === "activity" ? (
            <Activity
              runs={runs}
              runId={runId}
              events={events}
              onSelect={setRunId}
              onDecision={(id) => {
                setRunId(id);
                setSection("picks");
              }}
            />
          ) : section === "skills" ? (
            <Skills
              key={`skills-${agentId}-${agent.version}`}
              agent={agent}
              options={options}
              busy={busy}
              canManage={canManage}
              broken={blocked === "PLUGIN_NOT_CONFIGURED"}
              onSave={saveConfig}
            />
          ) : section === "brief" ? (
            <Brief
              key={`brief-${agentId}-${agent.version}`}
              agent={agent}
              catalog={catalog}
              busy={busy}
              canManage={canManage}
              onSave={saveConfig}
            />
          ) : section === "limits" ? (
            <>
              <Trading
                key={`trading-${agentId}-${agent.version}`}
                agent={agent}
                canManage={canManage}
                onSave={saveConfig}
              />
              <Limits
                key={`limits-${agentId}-${agent.version}`}
                agent={agent}
                busy={busy}
                canManage={canManage}
                onSave={saveConfig}
              />
            </>
          ) : section === "context" ? (
            <Context agent={agent} go={go} />
          ) : section !== "home" && section !== "new" && isPanel(section) ? (
            <Soon section={section} agent={agent} />
          ) : null}

          {error && (
            <p role="alert" className={styles.mainAlert}>
              <Icon name="alert" size={13} />
              {error}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

/** A `?section=` deep link the draft studio also has (`brief`, `limits`, `skills` …), or none. */
function draftSection(section: SectionKey | undefined): DraftSectionKey | undefined {
  return DRAFT_SECTIONS.flatMap((group) => group.items).find((item) => item.key === section)?.key;
}

/** A `?section=` deep link the live studio also has (`overview`, `brief`, `skills` …), or none. */
function liveSection(section: SectionKey | undefined): LiveSectionKey | undefined {
  return isLiveSection(section) ? section : undefined;
}
