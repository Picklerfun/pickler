"use client";
import { Icon, Tag } from "@pickler/ui";
import {
  SECTIONS,
  STEPPERS,
  capsProblem,
  deriveHandle,
  handleTone,
  lines,
  readKind,
  riskTag,
  sectionTag,
  step,
  type BriefForm,
  type HandleState,
  type SectionKey,
} from "./model";
import styles from "../home/home.module.css";

/**
 * Name it, the five sections and RISK: the canvas's brief column, editable. Every change goes up
 * through `onChange`; the tags, the handle's colour and the caps' problem are the model's.
 */
export function BriefFields({
  form,
  handle,
  fieldErrors,
  disabled,
  onChange,
}: {
  form: BriefForm;
  handle: HandleState;
  /** 400 INVALID_BRIEF, in words, under the section it names. */
  fieldErrors: Partial<Record<SectionKey, string>>;
  disabled: boolean;
  onChange(next: BriefForm): void;
}) {
  const problem = capsProblem(form);
  return (
    <>
      <div>
        <h1 className={styles.srOnly} id="home-empty-title">
          Your first agent&apos;s brief
        </h1>
        <input
          id="brief-name"
          className={styles.briefNameInput}
          aria-label="Name it"
          placeholder="Name it"
          value={form.name}
          maxLength={40}
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
        />
        <p className={styles.briefHandle}>
          <span data-tone={handleTone(handle)}>
            {form.name.trim() ? `@${deriveHandle(form.name)}` : "@handle"}
          </span>
          <small>BLANK BRIEF</small>
        </p>
      </div>

      {SECTIONS.map((section) => {
        const value = form[section.key];
        const error = fieldErrors[section.key];
        const soon =
          section.key === "reads" ? lines(value).filter((line) => readKind(line) === "soon") : [];
        return (
          <div
            key={section.key}
            className={styles.briefCard}
            data-needed={section.key === "enters" && !value.trim()}
          >
            <div className={styles.briefCardHead}>
              <label className={styles.briefLabel} htmlFor={`brief-${section.key}`}>
                {section.label}
              </label>
              <span className={styles.briefSub}>{section.sub}</span>
              <span className={styles.briefTag} data-filled={Boolean(value.trim())}>
                {sectionTag(section.key, value)}
              </span>
            </div>
            <textarea
              id={`brief-${section.key}`}
              className={styles.briefInput}
              rows={section.rows}
              placeholder={section.placeholder}
              value={value}
              disabled={disabled}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `brief-${section.key}-error` : undefined}
              onChange={(event) => onChange({ ...form, [section.key]: event.target.value })}
            />
            {soon.length > 0 && (
              <p className={styles.briefNote}>
                <Tag className={styles.soon}>SOON</Tag>
                Passed as context only; nothing reads these yet: {soon.join(", ")}
              </p>
            )}
            {error && (
              <p className={styles.briefError} id={`brief-${section.key}-error`} role="alert">
                <Icon name="alert" size={12} />
                {error}
              </p>
            )}
          </div>
        );
      })}

      <div className={styles.briefCard} id="brief-risk">
        <div className={styles.briefCardHead}>
          <span className={styles.briefLabel}>RISK</span>
          <span className={styles.briefSub}>
            hard caps · its paper trades keep to them · small on purpose for a first agent
          </span>
          <span className={styles.briefTag} data-filled={riskTag(form) === "EDITED"}>
            {riskTag(form)}
          </span>
        </div>
        <div className={styles.caps}>
          {STEPPERS.map((stepper) => {
            const value = form[stepper.key];
            const label = stepper.title.toLowerCase();
            return (
              <div key={stepper.key} className={styles.cap}>
                <span className={styles.capText}>
                  <span className={styles.capTitle}>
                    {stepper.title}
                    {stepper.soon && <Tag className={styles.soon}>SOON</Tag>}
                  </span>
                  <span className={styles.capValue}>
                    {value}
                    {stepper.unit}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.capButton}
                  aria-label={`Lower ${label}`}
                  disabled={disabled || stepper.soon || value <= stepper.min}
                  onClick={() => onChange(step(form, stepper.key, -1))}
                >
                  −
                </button>
                <button
                  type="button"
                  className={styles.capButton}
                  aria-label={`Raise ${label}`}
                  disabled={disabled || stepper.soon || value >= stepper.max}
                  onClick={() => onChange(step(form, stepper.key, 1))}
                >
                  +
                </button>
              </div>
            );
          })}
        </div>
        {problem && (
          <p className={styles.briefError} role="alert">
            <Icon name="alert" size={12} />
            {problem}
          </p>
        )}
      </div>
    </>
  );
}
