"use client";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Icon, type IconName } from "@pickler/ui";
import { ensureProfile } from "@/features/auth/lib/account";
import { getSupabase } from "@/features/auth/lib/supabase-browser";
import {
  consoleApi,
  errorCode,
  type Agent,
  type Catalog,
  type Config,
  type Options,
  type Run,
  type RunEvent,
} from "./api";
import { useNow } from "@/lib/now";
import { startPolling } from "./lib/polling";
import { AgentForm } from "./agent-form";
import { Overview } from "./sections/overview";
import { Picks } from "./sections/picks";
import { Activity } from "./sections/activity";
import { Skills } from "./sections/skills";
import { Brief } from "./sections/brief";
import { Limits } from "./sections/limits";
import { Context } from "./sections/context";
import { Stub } from "./sections/stub";
import type { SectionKey } from "./sections/stub";
import styles from "./studio.module.css";

type Access = { enabled: boolean; canManage: boolean; workspaceId: string };

const GROUPS: { title: string; items: { key: SectionKey; icon: IconName; label: string }[] }[] = [
  {
    title: "RUN",
    items: [
      { key: "overview", icon: "grid", label: "Overview" },
      { key: "console", icon: "chat", label: "Context" },
      { key: "picks", icon: "target", label: "Picks" },
      { key: "activity", icon: "activity", label: "Activity" },
    ],
  },
  {
    title: "BUILD",
    items: [
      { key: "brief", icon: "file", label: "Brief" },
      { key: "skills", icon: "sliders", label: "Skills" },
      { key: "sources", icon: "link", label: "Sources" },
      { key: "limits", icon: "wallet", label: "Limits & funding" },
      { key: "identity", icon: "user", label: "Identity & voice" },
    ],
  },
  {
    title: "GROW",
    items: [
      { key: "profile", icon: "globe", label: "Public profile" },
      { key: "audience", icon: "users", label: "Audience" },
      { key: "token", icon: "coin", label: "Token" },
    ],
  },
  { title: "PUBLIC", items: [{ key: "board", icon: "bars", label: "The board" }] },
];

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

const initials = (value: string) =>
  value
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .join("")
    .slice(0, 2) || "AG";

export function Console() {
  const router = useRouter();
  const [section, setSection] = useState<SectionKey>("overview");
  const [wide, setWide] = useState(true);
  const [access, setAccess] = useState<Access | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [trace, setTrace] = useState<{ runId: string; events: RunEvent[] } | null>(null);
  const [creating, setCreating] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [blocked, setBlocked] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<"agent" | "account" | null>(null);
  const requestKeys = useRef(new Map<string, string>());

  const agent = agents.find((candidate) => (candidate.productId ?? candidate.id) === agentId);
  const canManage = Boolean(access?.canManage);
  const events = trace && trace.runId === runId ? trace.events : [];
  const now = useNow();

  const loadAgents = useCallback(async () => {
    const [current, list] = await Promise.all([
      consoleApi<Access>("/me"),
      consoleApi<{ agents: Agent[] }>("/agents"),
    ]);
    setAccess(current);
    setAgents(list.agents);
    setBlocked(current.enabled ? "" : "RESEARCH_ACCESS_DENIED");
    return list.agents;
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const supabase = getSupabase();
        if (!supabase) {
          throw new Error("Authentication is not configured for this environment.");
        }
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          router.replace("/signin");
          return;
        }
        const account = await ensureProfile(supabase);
        if (account.kind !== "ready") {
          router.replace("/signup?complete=1");
          return;
        }
        await consoleApi("/onboard", { method: "POST" });
        const [list, cat, opts] = await Promise.all([
          loadAgents(),
          consoleApi<Catalog>("/market-categories"),
          consoleApi<Options>("/options"),
        ]);
        if (!active) {
          return;
        }
        setCatalog(cat);
        setOptions(opts);
        const first = list[0];
        setAgentId(first ? (first.productId ?? first.id) : null);
        setCreating(list.length === 0);
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
  }, [router, loadAgents]);

  /* One cancellable read loop owns both the run list and the selected trace. */
  useEffect(() => {
    if (!agentId) {
      return;
    }
    return startPolling(
      async (signal) => {
        const list = await consoleApi<{ runs: Run[] }>(`/agents/${agentId}/runs`, { signal });
        if (signal.aborted) {
          return null;
        }
        setRuns(list.runs);
        const selected = runId ?? list.runs[0]?.id ?? null;
        setRunId(selected);
        if (selected) {
          const body = await consoleApi<{ events: RunEvent[] }>(`/runs/${selected}/events`, {
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
  }, [agentId, runId, agent?.scheduleEnabled, refresh]);

  const act = useCallback(
    async (operation: () => Promise<void>) => {
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
    [loadAgents],
  );

  const runNow = useCallback(
    (marketId: string) =>
      act(async () => {
        if (!agentId) {
          return;
        }
        const key = requestKeys.current.get(agentId) ?? crypto.randomUUID();
        requestKeys.current.set(agentId, key);
        const result = await consoleApi<{ runId: string }>(`/agents/${agentId}/runs`, {
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
        await consoleApi(`/agents/${agent.productId ?? agent.id}/config`, {
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
    profile: { text: "SAMPLE", tint: "amber" },
    audience: { text: "PLANNED", tint: "grey" },
    token: { text: "PLANNED", tint: "grey" },
  };

  function go(next: SectionKey) {
    if (next === "picks" && !runs.find((run) => run.id === runId)?.decision) {
      setRunId(runs.find((run) => run.decision)?.id ?? null);
    }
    setSection(next);
    setCreating(false);
    setMenu(null);
  }

  return (
    <main className={styles.studio} data-surface="console" onClick={() => setMenu(null)}>
      <div className={styles.horizon} aria-hidden="true" />

      <header className={styles.topbar}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => setWide(!wide)}
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
              {initials(name)}
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
                disabled={!canManage}
                onClick={() => {
                  setCreating(true);
                  setMenu(null);
                }}
              >
                <Icon name="bolt" size={15} />
                New agent
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
          TESTNET
        </span>

        <div className={styles.menuWrap} onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={styles.switcher}
            data-quiet="true"
            aria-expanded={menu === "account"}
            onClick={() => setMenu(menu === "account" ? null : "account")}
          >
            <span className={styles.avatar} data-tint="grey">
              <Icon name="user" size={14} />
            </span>
            <Icon name="chevronDown" size={14} />
          </button>
          {menu === "account" && (
            <div className={styles.menu} data-align="right" role="menu">
              <Link href="/agents" className={styles.menuItem} role="menuitem">
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
            {GROUPS.map((group) => (
              <div key={group.title}>
                {wide && <p className={styles.railTitle}>{group.title}</p>}
                <div className={styles.railItems}>
                  {group.items.map((item) => {
                    const badge = badges[item.key];
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
                <Link href="/agents" className={styles.railLink}>
                  <Icon name="users" size={15} />
                  Every agent
                </Link>
                <Link href="/leaderboard" className={styles.railLink}>
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
                  await consoleApi(`/agents/${agentId}/pause`, {
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

        <div className={styles.main}>
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

          {creating && canManage && catalog && options ? (
            <div className={styles.section} data-narrow="true">
              <AgentForm
                catalog={catalog}
                options={options}
                onCancel={() => setCreating(false)}
                onSaved={(id) => {
                  setCreating(false);
                  void act(async () => {
                    await loadAgents();
                    setAgentId(id);
                    setRunId(null);
                    setRuns([]);
                    setTrace(null);
                  });
                }}
              />
            </div>
          ) : !agent ? (
            <div className={styles.section} data-narrow="true">
              <div className={styles.sectionHead}>
                <h2>No agent yet</h2>
              </div>
              <p className={styles.stubBody}>
                An agent is a standing brief plus the plugins it may reach. Create one and the
                studio fills in around it: its runs, its decisions and the trace behind each.
              </p>
              <div className={styles.row}>
                <Button disabled={!canManage} onClick={() => setCreating(true)}>
                  Create an agent
                </Button>
              </div>
            </div>
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
                  await consoleApi(`/agents/${agentId}/schedule`, {
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
            <Limits
              key={`limits-${agentId}-${agent.version}`}
              agent={agent}
              busy={busy}
              canManage={canManage}
              onSave={saveConfig}
            />
          ) : section === "console" ? (
            <Context agent={agent} go={go} />
          ) : (
            <Stub section={section} agent={agent} />
          )}

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
