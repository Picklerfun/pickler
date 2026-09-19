"use client";
import Link from "next/link";
import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button, ButtonLink, Field, Input } from "@pickler/ui";
import { ensureProfile } from "@/features/auth/lib/account";
import { getSupabase } from "@/features/auth/lib/supabase-browser";
import { consoleApi, type Agent, type Run, type RunEvent, type Catalog, type Options } from "./api";
import { AgentForm } from "./agent-form";
import { RunDetail } from "./run-detail";
import styles from "./console.module.css";

type Access = { enabled: boolean; canManage: boolean; workspaceId: string };
export function Console() {
  const router = useRouter();
  const [access, setAccess] = useState<Access | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<"create" | "edit" | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [marketId, setMarketId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestKeys = useRef(new Map<string, string>());
  const agent = agents.find((a) => (a.productId ?? a.id) === selected);
  const refresh = useCallback(async () => {
    const [current, list] = await Promise.all([
      consoleApi<Access>("/me"),
      consoleApi<{ agents: Agent[] }>("/agents"),
    ]);
    setAccess(current);
    setAgents(list.agents);
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
        const [current, list, cat, opts] = await Promise.all([
          consoleApi<Access>("/me"),
          consoleApi<{ agents: Agent[] }>("/agents"),
          consoleApi<Catalog>("/market-categories"),
          consoleApi<Options>("/options"),
        ]);
        if (active) {
          setAccess(current);
          setAgents(list.agents);
          setCatalog(cat);
          setOptions(opts);
        }
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Could not load console.");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);
  const runId = run?.id;
  const pending =
    run?.status === "queued" ||
    run?.status === "running" ||
    runs.some((r) => r.status === "queued" || r.status === "running");
  useEffect(() => {
    if (!selected) {
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    async function poll() {
      if (!active || document.hidden || controller) {
        return;
      }
      controller = new AbortController();
      try {
        const list = await consoleApi<{ runs: Run[] }>(`/agents/${selected}/runs`, {
          signal: controller.signal,
        });
        if (!active) {
          return;
        }
        setRuns(list.runs);
        if (runId) {
          const [current, evidence] = await Promise.all([
            consoleApi<Run>(`/runs/${runId}`, { signal: controller.signal }),
            consoleApi<{ events: RunEvent[] }>(`/runs/${runId}/events`, {
              signal: controller.signal,
            }),
          ]);
          if (active) {
            setRun(current);
            setEvents(evidence.events);
          }
        }
      } catch (caught) {
        if (active && !controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "Could not refresh results.");
        }
      } finally {
        controller = undefined;
        if (active && pending && !document.hidden) {
          timer = setTimeout(poll, 3000);
        }
      }
    }
    function visibility() {
      clearTimeout(timer);
      if (document.hidden) {
        controller?.abort();
      } else {
        void poll();
      }
    }
    void poll();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [selected, runId, pending]);
  async function action(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  async function launch() {
    if (!selected) {
      return;
    }
    const key = requestKeys.current.get(selected) ?? crypto.randomUUID();
    requestKeys.current.set(selected, key);
    const result = await consoleApi<{ runId: string }>(`/agents/${selected}/runs`, {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(marketId.trim() ? { marketId: marketId.trim() } : {}),
    });
    setRun(await consoleApi<Run>(`/runs/${result.runId}`));
    requestKeys.current.delete(selected);
    setEvents([]);
  }
  return (
    <main className={styles.page} data-surface="console">
      <header className={styles.header}>
        <div>
          <Link href="/">Pickler</Link>
          <h1>Your research console</h1>
          <p>Private agents, evidence and decisions.</p>
        </div>
        <div className={styles.row}>
          <ButtonLink href="/agents" variant="secondary">
            Explore demos
          </ButtonLink>
          <Button
            variant="secondary"
            onClick={() =>
              void action(async () => {
                await getSupabase()?.auth.signOut();
                router.replace("/signin");
              })
            }
          >
            Sign out
          </Button>
        </div>
      </header>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!access && !error && <p role="status">Loading your workspace…</p>}
      {access && !access.enabled && (
        <section className={styles.panel}>
          <h2>Research access pending</h2>
          <p>
            Your account is ready. An operator must enable research before you can use provider
            credits. Existing results remain available.
          </p>
        </section>
      )}
      <div className={styles.layout}>
        <aside className={styles.stack}>
          <Button disabled={!access?.canManage} onClick={() => setEditing("create")}>
            Create agent
          </Button>
          {agents.map((a) => (
            <Button
              key={a.productId ?? a.id}
              variant="tile"
              onClick={() => {
                setSelected(a.productId ?? a.id);
                setRun(null);
                setEvents([]);
                setRuns([]);
                setEditing(null);
              }}
            >
              {a.name ?? a.id} · {a.paused ? "Paused" : "Ready"}
            </Button>
          ))}
        </aside>
        <div className={styles.stack}>
          {editing && catalog && options && (
            <AgentForm
              key={editing + selected}
              {...(editing === "edit" && agent ? { agent } : {})}
              catalog={catalog}
              options={options}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                void action(refresh);
              }}
            />
          )}
          {!editing && agent && (
            <section className={styles.panel}>
              <h2>{agent.name ?? agent.id}</h2>
              <p>{agent.config.profile}</p>
              <p>
                Version {agent.version} ·{" "}
                {agent.scheduleEnabled
                  ? `Scheduled every ${agent.config.intervalHours} hours`
                  : "Schedule disabled"}
              </p>
              <Field
                label="Market ID (optional)"
                note="Leave empty to discover a market in this agent's selected sports."
              >
                <Input
                  value={marketId}
                  onChange={(e) => setMarketId(e.target.value)}
                  inputMode="numeric"
                  pattern="[0-9]*"
                />
              </Field>
              <div className={styles.row}>
                <Button
                  disabled={busy || !access?.canManage || agent.paused}
                  onClick={() => void action(launch)}
                >
                  Start research
                </Button>
                <Button
                  variant="secondary"
                  disabled={!access?.canManage || busy}
                  onClick={() => setEditing("edit")}
                >
                  Edit settings
                </Button>
              </div>
              <div className={styles.row}>
                <Button
                  variant="secondary"
                  disabled={!access?.canManage || busy}
                  onClick={() =>
                    void action(async () => {
                      await consoleApi(`/agents/${selected}/pause`, {
                        method: "PUT",
                        body: JSON.stringify({ paused: !agent.paused }),
                      });
                    })
                  }
                >
                  {agent.paused ? "Resume" : "Pause"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={!access?.canManage || busy}
                  onClick={() =>
                    void action(async () => {
                      await consoleApi(`/agents/${selected}/schedule`, {
                        method: "PUT",
                        body: JSON.stringify({ enabled: !agent.scheduleEnabled }),
                      });
                    })
                  }
                >
                  {agent.scheduleEnabled ? "Disable schedule" : "Enable schedule"}
                </Button>
              </div>
              <p className={styles.muted}>
                Scheduling requires an operator connection check and one successful manual research
                with these settings.
              </p>
            </section>
          )}
          {agent && (
            <section className={styles.panel}>
              <h2>Recent research</h2>
              {!runs.length && <p>No research yet.</p>}
              {runs.map((r) => (
                <Button
                  key={r.id}
                  variant="secondary"
                  onClick={() => {
                    setRun(r);
                    setEvents([]);
                  }}
                >
                  {new Date(r.createdAt).toLocaleString()} · {r.status}
                  {r.decision ? ` · ${r.decision.action}` : ""}
                </Button>
              ))}
            </section>
          )}
          {run && <RunDetail run={run} events={events} />}
          {!agent && !editing && access && (
            <section className={styles.panel}>
              <h2>Choose an agent</h2>
              <p>Create an agent or select one to configure research and review its evidence.</p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
