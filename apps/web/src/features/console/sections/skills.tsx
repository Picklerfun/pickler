"use client";
import { useState } from "react";
import { Button, Icon } from "@pickler/ui";
import type { Agent, Config, Options } from "../api";
import styles from "../studio.module.css";

/** What each plugin is for, in the operator's terms rather than the integration's. */
const NOTES: Record<string, string> = {
  polymarket: "Market rules and order book. The one plugin it cannot run without.",
  exa: "Web search and page reads, inside the search and page-read limits.",
  balldontlie: "Team context, injuries and schedule for the sports it covers.",
  "the-odds-api": "Sportsbook lines to compare against the market price.",
  "paper-trading":
    "Writes one paper order per run when the policy lets a trade through. No tools of its own.",
};

export function Skills({
  agent,
  options,
  busy,
  canManage,
  broken,
  onSave,
}: {
  agent: Agent;
  options: Options | null;
  busy: boolean;
  canManage: boolean;
  broken: boolean;
  onSave(config: Config): void;
}) {
  /* The parent remounts this on a new config version, so the draft starts from what was saved. */
  const [draft, setDraft] = useState<Config>(agent.config);

  const plugins = options?.plugins ?? [];
  const enabled = draft.plugins?.enabled ?? [];
  const tools = draft.tools;
  const dirty = JSON.stringify(draft) !== JSON.stringify(agent.config);
  const locked = !canManage || busy;

  function togglePlugin(id: (typeof enabled)[number], pluginTools: Config["tools"]) {
    const on = enabled.includes(id);
    setDraft({
      ...draft,
      plugins: {
        version: 1,
        enabled: on ? enabled.filter((value) => value !== id) : [...enabled, id],
      },
      /* A tool without its plugin would never be reachable, so turning a plugin off takes its
         tools with it. Turning it back on leaves the tools to be chosen deliberately. */
      tools: on ? tools.filter((tool) => !pluginTools.includes(tool)) : tools,
    });
  }

  function toggleTool(tool: Config["tools"][number]) {
    const on = tools.includes(tool);
    if (!on && tools.length >= 6) {
      return;
    }
    setDraft({
      ...draft,
      tools: on ? tools.filter((value) => value !== tool) : [...tools, tool],
    });
  }

  return (
    <div className={styles.section} data-narrow="true">
      <div className={styles.sectionHead}>
        <h2>Skills</h2>
        <span className={styles.count}>
          {tools.length} OF 6 TOOLS · {enabled.length} OF {plugins.length || 5} PLUGINS
        </span>
      </div>
      <p className={styles.stubBody}>
        Plugins are what it can reach; tools are what each plugin lets it call. Turn a plugin off
        and its tools leave the run. Sources live here too — there is no separate catalog.
      </p>
      <div className={styles.block}>
        {plugins.map((plugin) => {
          const on = enabled.includes(plugin.id);
          const isBroken = on && broken;
          return (
            <div
              key={plugin.id}
              className={styles.plugin}
              data-on={on}
              data-broken={isBroken}
              data-tint={isBroken ? "magenta" : undefined}
            >
              <button
                type="button"
                className={styles.pluginToggle}
                role="switch"
                aria-checked={on}
                aria-label={plugin.id}
                disabled={locked}
                onClick={() => togglePlugin(plugin.id, plugin.tools)}
              >
                <span className={styles.track} data-on={on} data-size="lg">
                  <span className={styles.knob} />
                </span>
              </button>
              <div>
                <span className={styles.pluginHead}>
                  <span className={styles.pluginName}>{plugin.id}</span>
                  <span className={styles.pluginVersion}>{plugin.version}</span>
                  {isBroken && (
                    <span className={styles.badge} data-tint="magenta">
                      <Icon name="alert" size={10} /> PLUGIN_NOT_CONFIGURED
                    </span>
                  )}
                </span>
                <span className={styles.pluginNote}>
                  {NOTES[plugin.id] ?? "A capability the operator has made available."}
                </span>
                <ul className={styles.tools}>
                  {plugin.tools.length ? (
                    plugin.tools.map((tool) => (
                      <li key={tool}>
                        <button
                          type="button"
                          className={styles.tool}
                          data-on={on && tools.includes(tool)}
                          aria-pressed={tools.includes(tool)}
                          disabled={locked || !on || (!tools.includes(tool) && tools.length >= 6)}
                          title={
                            !on
                              ? "Turn the plugin on first"
                              : tools.length >= 6 && !tools.includes(tool)
                                ? "Six tools is the ceiling for one run"
                                : "Add or remove this tool"
                          }
                          onClick={() => toggleTool(tool)}
                        >
                          {tool}
                        </button>
                      </li>
                    ))
                  ) : (
                    <li>
                      <span className={styles.tool} data-on={on}>
                        one paper order per run
                      </span>
                    </li>
                  )}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
      <p className={styles.note}>
        Plugins use operator-managed credentials. Enabling one does not make a paid request. Saving
        this turns the schedule off: it takes one successful manual run with the new set to earn it
        back.
      </p>
      <div className={styles.row}>
        <Button disabled={locked || !dirty} onClick={() => onSave(draft)}>
          {busy ? "Saving…" : "Save skills"}
        </Button>
        <Button variant="secondary" disabled={!dirty} onClick={() => setDraft(agent.config)}>
          Discard
        </Button>
      </div>
    </div>
  );
}
