"use client";
import { useState, type FormEvent } from "react";
import { Button, Chip, Field, Icon, Input, Textarea } from "@pickler/ui";
import { consoleApi, type Agent, type Catalog, type Config, type Options } from "./api";
import styles from "./studio.module.css";

/**
 * Creating an agent: the four things that must exist before it can run — who it is, what it hunts,
 * where it may look, and what it may reach. Everything else has a page of its own afterwards, so
 * this form stays short on purpose.
 */
export function AgentForm({
  catalog,
  options,
  onSaved,
  onCancel,
}: {
  catalog: Catalog;
  options: Options;
  onSaved(id: string): void;
  onCancel(): void;
}) {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [config, setConfig] = useState<Config>(() => ({
    ...options.defaults,
    marketScope: { version: 1, category: "sports", subcategories: [] },
    plugins: { version: 1, enabled: ["polymarket", "exa"] },
  }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());

  const sports = catalog.categories[0]!.subcategories;
  const selected =
    config.marketScope?.subcategories === "all"
      ? sports.map((sport) => sport.id)
      : (config.marketScope?.subcategories ?? []);
  const enabled = config.plugins?.enabled ?? [];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!selected.length) {
        throw new Error("Choose at least one sport — the agent needs somewhere to look.");
      }
      const created = await consoleApi<Agent>("/agents", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({ name, handle, config }),
      });
      onSaved(created.productId ?? created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the agent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={styles.block}>
      <div className={styles.sectionHead}>
        <h2>Create an agent</h2>
      </div>
      <p className={styles.stubBody}>
        The schedule starts disabled. Enabling it requires a connection check and a successful
        manual run with the saved configuration.
      </p>

      <div className={styles.form}>
        <Field label="Name" note="Up to 40 characters. This is what the board shows.">
          <Input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Handle" note="3–15 lowercase letters, numbers or underscores. Permanent.">
          <Input
            required
            prefix="@"
            pattern="[a-z0-9_]{3,15}"
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase())}
          />
        </Field>
        <Field
          label="Research profile"
          note="The standing brief: the edge it hunts, what it will not touch, how sure it must be."
        >
          <Textarea
            required
            rows={8}
            maxLength={4000}
            value={config.profile}
            onChange={(e) => setConfig({ ...config, profile: e.target.value })}
          />
        </Field>

        <div className={styles.block}>
          <p className={styles.eyebrow}>WHERE IT LOOKS</p>
          <div className={styles.row}>
            {sports.map((sport) => (
              <Chip
                key={sport.id}
                selected={selected.includes(sport.id)}
                onClick={() =>
                  setConfig({
                    ...config,
                    marketScope: {
                      version: 1,
                      category: "sports",
                      subcategories: selected.includes(sport.id)
                        ? selected.filter((id) => id !== sport.id)
                        : [...selected, sport.id],
                    },
                  })
                }
              >
                {sport.label}
              </Chip>
            ))}
          </div>
        </div>

        <div className={styles.block}>
          <p className={styles.eyebrow}>WHAT IT MAY REACH</p>
          {options.plugins.map((plugin) => {
            const on = enabled.includes(plugin.id);
            return (
              <div key={plugin.id} className={styles.plugin} data-on={on}>
                <button
                  type="button"
                  className={styles.pluginToggle}
                  role="switch"
                  aria-checked={on}
                  aria-label={plugin.id}
                  onClick={() =>
                    setConfig({
                      ...config,
                      plugins: {
                        version: 1,
                        enabled: on
                          ? enabled.filter((id) => id !== plugin.id)
                          : [...enabled, plugin.id],
                      },
                      tools: on
                        ? config.tools.filter((tool) => !plugin.tools.includes(tool))
                        : config.tools,
                    })
                  }
                >
                  <span className={styles.track} data-on={on} data-size="lg">
                    <span className={styles.knob} />
                  </span>
                </button>
                <div>
                  <span className={styles.pluginHead}>
                    <span className={styles.pluginName}>{plugin.id}</span>
                    <span className={styles.pluginVersion}>{plugin.version}</span>
                  </span>
                  <ul className={styles.tools}>
                    {plugin.tools.map((tool) => (
                      <li key={tool}>
                        <button
                          type="button"
                          className={styles.tool}
                          data-on={on && config.tools.includes(tool)}
                          aria-pressed={config.tools.includes(tool)}
                          disabled={
                            !on || (!config.tools.includes(tool) && config.tools.length >= 6)
                          }
                          onClick={() =>
                            setConfig({
                              ...config,
                              tools: config.tools.includes(tool)
                                ? config.tools.filter((value) => value !== tool)
                                : [...config.tools, tool],
                            })
                          }
                        >
                          {tool}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
          <p className={styles.note}>
            Plugins use operator-managed credentials. Enabling one does not make a paid request. Six
            tools is the ceiling for a single run.
          </p>
        </div>

        <Field label="Interval in hours" note="How often it would run on its own · 1–168">
          <Input
            type="number"
            min={1}
            max={168}
            mono
            value={config.intervalHours}
            onChange={(e) => setConfig({ ...config, intervalHours: Number(e.target.value) })}
          />
        </Field>

        {error && (
          <p role="alert" className={styles.alert}>
            <Icon name="alert" size={13} />
            {error}
          </p>
        )}
        <div className={styles.row}>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create agent"}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}
