"use client";
import type { StudioAgentDto } from "@pickler/api-schema";
import type { UseAgentStudio } from "./use-agent-studio";
import { SaveOutcome, saveLabel, useSavedForm, useSetupSave } from "./setup-save";
import styles from "./strategy-setup.module.css";

const options = [
  ["rules", "Rules · SMA20/50"],
  ["deepseek", "DeepSeek · direct proposal"],
  ["jev", "Jev · evidence questions"],
  ["combined", "DeepSeek + Jev · reviewed proposal"],
] as const;
type StrategyId = (typeof options)[number][0];
/** A versioned setup save; switching to rules explicitly clears unverifiable authored conditions. */
export function StrategySetup({
  agent,
  studio,
  canManage,
}: {
  agent: StudioAgentDto;
  studio: Pick<UseAgentStudio, "saveSetup" | "refreshAgent">;
  canManage: boolean;
}) {
  const saved = agent.config.perpsStrategy?.id ?? "combined";
  const [selected, setSelected] = useSavedForm<StrategyId>(agent.version, saved);
  const { state, save, touch, saving } = useSetupSave(studio);
  const brief = agent.config.brief;
  const freeConditions = Boolean(
    brief && (brief.entersWhen.length || brief.exitsWhen.length || brief.never.length),
  );
  const clearsConditions = selected === "rules" && freeConditions;
  const dirty = selected !== saved || clearsConditions;
  const canSave = canManage && dirty && !saving;
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel}>
        Strategy
        <select
          aria-label="Strategy"
          className={styles.input}
          value={selected}
          disabled={!canManage || saving}
          onChange={(event) => {
            setSelected(event.target.value as StrategyId);
            touch();
          }}
        >
          {options.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className={styles.hint}>
        Version {agent.config.perpl?.version === 2 ? "2.1.0" : "2.0.0"}. A change requires a new
        preparation check. Models propose actions; your caps and exits still apply.
      </p>
      {clearsConditions && (
        <p className={styles.notice}>
          SMA rules cannot verify your written entry, exit or prohibition conditions. Saving rules
          clears those conditions and keeps your thesis. Fixed stops and risk limits remain.
        </p>
      )}
      <button
        type="button"
        className={styles.saveButton}
        disabled={!canSave}
        onClick={() => {
          if (!canSave) {
            return;
          }
          void save({
            perpsStrategy: {
              id: selected,
              version: agent.config.perpl?.version === 2 ? "2.1.0" : "2.0.0",
            },
            ...(clearsConditions && brief
              ? { brief: { thesis: brief.thesis, entersWhen: [], exitsWhen: [], never: [] } }
              : {}),
          });
        }}
      >
        {saveLabel(
          state,
          dirty,
          clearsConditions ? "Clear conditions and save rules" : "Save strategy",
        )}
      </button>
      <SaveOutcome state={state} />
    </div>
  );
}
