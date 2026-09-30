"use client";
import { Icon } from "@pickler/ui";
import type { Agent } from "../api";
import type { SectionKey } from "./keys";
import styles from "../studio.module.css";

/**
 * What the agent carries into every run, on one page.
 *
 * The canvas draws this as a drawer behind a conversation. The conversation has no backend — there
 * is no thread, no memory and no natural-language rule store — so what is real is shown and what is
 * not is named. Everything below comes from the saved config the next run will be evaluated with.
 */
export function Context({ agent, go }: { agent: Agent; go(section: SectionKey): void }) {
  const config = agent.config;
  const policy = config.uncertaintyPolicy;
  const scope =
    config.marketScope?.subcategories === "all"
      ? "all sports"
      : (config.marketScope?.subcategories ?? []).join(", ") || "not set";

  const fields: { key: string; value: string; on?: boolean }[] = [
    ...(policy
      ? [
          {
            key: "blockHighUncertainty",
            value: String(policy.blockHighUncertainty),
            on: policy.blockHighUncertainty,
          },
          {
            key: "requireCompleteInformation",
            value: String(policy.requireCompleteInformation),
            on: policy.requireCompleteInformation,
          },
          { key: "minProbabilityMargin", value: policy.minProbabilityMargin.toFixed(2) },
          { key: "maxProbabilityRangeWidth", value: policy.maxProbabilityRangeWidth.toFixed(2) },
        ]
      : []),
    { key: "limits.searches", value: `${config.limits.searches} / 3` },
    { key: "limits.pageReads", value: `${config.limits.pageReads} / 5` },
    { key: "limits.steps", value: `${config.limits.steps} / 12` },
    { key: "limits.durationMs", value: `${Math.round(config.limits.durationMs / 1000)}s` },
    { key: "limits.outputTokens", value: config.limits.outputTokens.toLocaleString() },
    { key: "limits.dailyRuns", value: `${config.limits.dailyRuns} / 6` },
  ];

  return (
    <div className={styles.section} id="studio-section-context" data-narrow="true">
      <div className={styles.sectionHead}>
        <h1>Context</h1>
        <span className={styles.count}>CONFIG v{agent.version}</span>
        <p>what it carries into every run</p>
      </div>

      <section className={styles.card}>
        <div className={styles.split}>
          <div className={styles.grow}>
            <p className={styles.eyebrow}>THE BRIEF</p>
            <p className={styles.note}>
              {config.profile.slice(0, 280)}
              {config.profile.length > 280 ? "…" : ""}
            </p>
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.action} onClick={() => go("brief")}>
            <span className={styles.actionMark}>
              <Icon name="file" size={16} />
            </span>
            <span className={styles.grow}>
              <b>Edit the brief</b>
              <small>{config.profile.length} of 4,000 characters</small>
            </span>
            <Icon name="arrow" size={15} />
          </button>
          <button type="button" className={styles.action} onClick={() => go("skills")}>
            <span className={styles.actionMark}>
              <Icon name="sliders" size={16} />
            </span>
            <span className={styles.grow}>
              <b>{config.tools.length} tools reachable</b>
              <small>{(config.plugins?.enabled ?? []).join(", ") || "no plugins enabled"}</small>
            </span>
            <Icon name="arrow" size={15} />
          </button>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.split}>
          <div className={styles.grow}>
            <p className={styles.eyebrow}>POLICY &amp; LIMITS</p>
            <p className={styles.note}>
              What the backend actually enforces. A decision that is stopped names which of these
              fired, by code.
            </p>
          </div>
          <span className={styles.badge} data-tint="violet">
            {scope}
          </span>
        </div>
        <div className={styles.limits}>
          {fields.map((field) => (
            <div
              key={field.key}
              className={styles.limit}
              data-on={field.on ?? false}
              title={field.key}
            >
              <b>{field.value}</b>
              <span>{field.key}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.card} data-planned="true">
        <p className={styles.eyebrow}>
          RULES IN PLAIN LANGUAGE
          <span className={styles.stubState} data-tint="amber">
            NO BACKEND
          </span>
        </p>
        <p className={styles.note}>
          The design pins rules as sentences — &ldquo;pass if the range is wider than 20
          points&rdquo; — and maps each one onto a policy field. Nothing stores sentences today: the
          policy above is the whole of it, and a rule that does not map to one of those fields would
          have nowhere to go. Until it is modelled, put the intent in the brief.
        </p>
      </section>
    </div>
  );
}
