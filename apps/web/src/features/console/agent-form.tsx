"use client";
import { useState, type FormEvent } from "react";
import { Button, Field, Input, Textarea } from "@pickler/ui";
import { consoleApi, type Agent, type Catalog, type Config, type Options } from "./api";
import styles from "./console.module.css";

export function AgentForm({
  agent,
  catalog,
  options,
  onSaved,
  onCancel,
}: {
  agent?: Agent;
  catalog: Catalog;
  options: Options;
  onSaved(): void;
  onCancel(): void;
}) {
  const [name, setName] = useState(agent?.name ?? "");
  const [handle, setHandle] = useState(agent?.handle ?? "");
  const [config, setConfig] = useState<Config>(
    () =>
      agent?.config ?? {
        ...options.defaults,
        marketScope: { version: 1, category: "sports", subcategories: [] },
        plugins: { version: 1, enabled: ["polymarket", "exa"] },
      },
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const sports = catalog.categories[0]!.subcategories;
  const selected =
    config.marketScope?.subcategories === "all"
      ? sports.map((s) => s.id)
      : (config.marketScope?.subcategories ?? []);
  const enabled = config.plugins?.enabled ?? ["polymarket", "exa"];
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!selected.length) {
        throw new Error("Choose at least one sport.");
      }
      if (agent) {
        await consoleApi(`/agents/${agent.productId ?? agent.id}/config`, {
          method: "PUT",
          body: JSON.stringify({ expectedVersion: agent.version, config }),
        });
      } else {
        await consoleApi("/agents", {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body: JSON.stringify({ name, handle, config }),
        });
      }
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className={styles.panel}>
      <h2>{agent ? "Agent settings" : "Create an agent"}</h2>
      {!agent && (
        <div className={styles.row}>
          <Field label="Name">
            <Input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Handle" note="3–15 lowercase letters, numbers or underscores">
            <Input
              required
              pattern="[a-z0-9_]{3,15}"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
          </Field>
        </div>
      )}
      <Field label="Research profile">
        <Textarea
          required
          maxLength={4000}
          value={config.profile}
          onChange={(e) => setConfig({ ...config, profile: e.target.value })}
        />
      </Field>
      <fieldset>
        <legend>Sports</legend>
        <div className={styles.row}>
          {sports.map((s) => (
            <label key={s.id}>
              <input
                type="checkbox"
                checked={selected.includes(s.id)}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    marketScope: {
                      version: 1,
                      category: "sports",
                      subcategories: e.target.checked
                        ? [...selected, s.id]
                        : selected.filter((id) => id !== s.id),
                    },
                  })
                }
              />{" "}
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Plugins and tools</legend>
        {options.plugins.map((plugin) => (
          <div key={plugin.id} className={styles.plugin}>
            <label>
              <input
                type="checkbox"
                checked={enabled.includes(plugin.id)}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    plugins: {
                      version: 1,
                      enabled: e.target.checked
                        ? [...enabled, plugin.id]
                        : enabled.filter((id) => id !== plugin.id),
                    },
                  })
                }
              />{" "}
              {plugin.id}
            </label>
            <div className={styles.row}>
              {plugin.tools.map((tool) => (
                <label key={tool}>
                  <input
                    type="checkbox"
                    disabled={!enabled.includes(plugin.id)}
                    checked={config.tools.includes(tool)}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        tools: e.target.checked
                          ? [...config.tools, tool]
                          : config.tools.filter((t) => t !== tool),
                      })
                    }
                  />{" "}
                  {tool}
                </label>
              ))}
            </div>
          </div>
        ))}
      </fieldset>
      <p>
        Plugins use operator-managed credentials. Enabling one does not make a paid request. Sports
        data plugins currently cover NFL only.
      </p>
      <Field
        label="Interval in hours"
        note="Saving settings disables the schedule. Connection validation and a successful manual run are required before enabling it."
      >
        <Input
          type="number"
          min={1}
          max={168}
          value={config.intervalHours}
          onChange={(e) => setConfig({ ...config, intervalHours: Number(e.target.value) })}
        />
      </Field>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.row}>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save agent"}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
