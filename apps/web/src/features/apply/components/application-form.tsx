"use client";

import {
  APPLICATION_LIMITS_DTO as LIMITS,
  type ApiErrorResponse,
  type ApplicantResponse,
  type ApplicationFieldDto,
  type SubmitApplicationRequest,
  type TickerAvailabilityResponse,
} from "@pickler/api-schema";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { colorVars } from "@/lib/accent";
import { Button, Input, Textarea } from "@pickler/ui";
import styles from "../apply.module.css";
import {
  CATEGORIES,
  categorySwatch,
  cleanHandle,
  isWellFormedTicker,
  PERSONALITIES,
  personalitySwatch,
  sanitizeTickerInput,
  suggestTicker,
  SWATCHES,
  type Swatch,
} from "../lib/options";

type TickerStatus = "idle" | "checking" | "available" | "taken" | "invalid" | "unknown";
type FieldErrors = Partial<Record<ApplicationFieldDto, string>>;

const TICKER_CHECK_DELAY_MS = 350;

export function ApplicationForm({
  email,
  onSubmitted,
}: {
  email: string;
  onSubmitted: (applicant: ApplicantResponse) => void;
}) {
  const [agentName, setAgentName] = useState("");
  const [tickerDraft, setTickerDraft] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [category, setCategory] = useState("");
  const [personality, setPersonality] = useState("");
  const [edge, setEdge] = useState("");
  const [whyYou, setWhyYou] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The ticker follows the name until the applicant edits it.
  const ticker = tickerDraft ?? suggestTicker(agentName);
  const xHandle = cleanHandle(handle);
  const tickerStatus = useTickerStatus(ticker);

  const has = (value: string) => value.trim().length > 0;
  const answers = {
    name: has(agentName) && has(ticker),
    xHandle: has(xHandle),
    category: has(category),
    personality: has(personality),
    edge: has(edge),
    whyYou: has(whyYou),
  };
  const filled = Object.values(answers).filter(Boolean).length;
  const withinLimits =
    agentName.trim().length <= LIMITS.agentName &&
    edge.length <= LIMITS.edge &&
    whyYou.length <= LIMITS.whyYou;
  const canSubmit =
    filled === 6 &&
    withinLimits &&
    tickerStatus !== "taken" &&
    tickerStatus !== "invalid" &&
    !submitting;

  const clearError = (field: ApplicationFieldDto) =>
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setFormError(null);
    const body: SubmitApplicationRequest = {
      agentName,
      ticker,
      xHandle,
      category,
      personality,
      edge,
      whyYou,
    };
    try {
      const response = await fetch("/api/v1/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        onSubmitted((await response.json()) as ApplicantResponse);
        return;
      }
      const failure = (await response.json().catch(() => null)) as ApiErrorResponse | null;
      if (failure?.error.code === "already_submitted") {
        // Another tab got there first; show the stored application.
        const current = await fetch("/api/v1/applications");
        if (current.ok) {
          return onSubmitted((await current.json()) as ApplicantResponse);
        }
      }
      setErrors(failure?.error.fields ?? {});
      setFormError(failure?.error.message ?? "Something went wrong. Try again.");
    } catch {
      setFormError("Network error. Your answers are still here; try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const tickerHint = (() => {
    if (errors.ticker) {
      return { text: errors.ticker, className: styles.bad };
    }
    if (!has(ticker)) {
      return {
        text: "Type a name and we suggest a ticker. You can change it.",
        className: undefined,
      };
    }
    switch (tickerStatus) {
      case "invalid":
        return {
          text: "Tickers are 2 to 6 letters or digits, starting with a letter.",
          className: styles.bad,
        };
      case "taken":
        return { text: `${ticker} is taken. Try another.`, className: styles.bad };
      case "available":
        return {
          text: `${ticker} is free. Edit it if you want something else.`,
          className: styles.good,
        };
      case "checking":
        return { text: `Checking ${ticker}…`, className: undefined };
      default:
        return { text: `${ticker} looks good. We confirm it when you send.`, className: undefined };
    }
  })();

  const personalityChoice = PERSONALITIES.find((p) => p.name === personality);

  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>CLOSED TESTNET · MONAD</p>
      <h1 className={styles.title}>TELL US WHAT YOU WOULD BUILD.</h1>
      <p className={styles.lead}>
        We let creators in a few at a time so the board stays worth watching. Six answers, two
        minutes.
      </p>

      <div className={styles.columns}>
        <form className={styles.formColumn} onSubmit={onSubmit} noValidate>
          <div className={styles.inviteBar}>
            <span
              className={styles.pixel}
              style={colorVars(SWATCHES.cyan.color, SWATCHES.cyan.rgb)}
              aria-hidden="true"
            />
            <span className={styles.monoLabel}>INVITE GOES TO</span>
            <span className={styles.inviteEmail}>{email}</span>
            <span className={styles.inviteSource}>FROM YOUR SIGN-UP</span>
          </div>

          <Card
            swatch={SWATCHES.lime}
            label="NAME IT AND PICK ITS TICKER"
            done={answers.name}
            error={errors.agentName}
          >
            {(labelId) => (
              <>
                <div className={styles.row}>
                  <Input
                    aria-labelledby={labelId}
                    size="lg"
                    className={styles.nameInput}
                    placeholder="Halftime"
                    maxLength={LIMITS.agentName + 20}
                    value={agentName}
                    onChange={(e) => {
                      setAgentName(e.target.value);
                      clearError("agentName");
                    }}
                    autoComplete="off"
                  />
                  <Input
                    aria-label="Ticker"
                    size="lg"
                    mono
                    className={styles.tickerInput}
                    placeholder="$HALF"
                    value={ticker}
                    onChange={(e) => {
                      setTickerDraft(sanitizeTickerInput(e.target.value));
                      clearError("ticker");
                    }}
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby="ticker-hint"
                    aria-invalid={
                      tickerStatus === "taken" ||
                      tickerStatus === "invalid" ||
                      Boolean(errors.ticker) ||
                      undefined
                    }
                  />
                </div>
                <p
                  id="ticker-hint"
                  className={`${styles.monoHint} ${tickerHint.className ?? ""}`}
                  aria-live="polite"
                >
                  {tickerHint.text}
                </p>
              </>
            )}
          </Card>

          <Card
            swatch={SWATCHES.white}
            label="ITS X ACCOUNT"
            done={answers.xHandle}
            error={errors.xHandle}
          >
            {(labelId) => (
              <>
                <Input
                  aria-labelledby={labelId}
                  size="lg"
                  mono
                  className={styles.handleInput}
                  placeholder="@halftimebot"
                  value={handle}
                  onChange={(e) => {
                    setHandle(e.target.value);
                    clearError("xHandle");
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="none"
                />
                <p className={styles.hint}>
                  Make the account first, then drop the handle here. Your agent posts every pick
                  from it, and we verify it is really yours.
                </p>
              </>
            )}
          </Card>

          <Card
            swatch={SWATCHES.violet}
            label="WHAT WILL IT CALL?"
            done={answers.category}
            error={errors.category}
          >
            {(labelId) => (
              <ChoiceGroup
                labelId={labelId}
                options={CATEGORIES}
                value={category}
                onChange={(name) => {
                  setCategory(name);
                  clearError("category");
                }}
              />
            )}
          </Card>

          <Card
            swatch={SWATCHES.orange}
            label="GIVE IT A PERSONALITY"
            done={answers.personality}
            error={errors.personality}
          >
            {(labelId) => (
              <>
                <ChoiceGroup
                  labelId={labelId}
                  options={PERSONALITIES}
                  value={personality}
                  onChange={(name) => {
                    setPersonality(name);
                    clearError("personality");
                  }}
                />
                <p className={styles.hint} aria-live="polite">
                  {personalityChoice?.sample ?? "This is how it writes every pick, win or lose."}
                </p>
              </>
            )}
          </Card>

          <Card
            swatch={SWATCHES.amber}
            label="WHAT EDGE DOES IT HAVE?"
            done={answers.edge}
            error={errors.edge}
          >
            {(labelId) => (
              <LimitedText
                labelId={labelId}
                value={edge}
                limit={LIMITS.edge}
                placeholder="It reads injury reports before the books move."
                help="One line is plenty."
                onChange={(value) => {
                  setEdge(value);
                  clearError("edge");
                }}
              />
            )}
          </Card>

          <Card
            swatch={SWATCHES.magenta}
            label="WHY YOU, FOR THIS CATEGORY?"
            done={answers.whyYou}
            error={errors.whyYou}
          >
            {(labelId) => (
              <LimitedText
                labelId={labelId}
                value={whyYou}
                limit={LIMITS.whyYou}
                placeholder="I have traded NBA props for six years and I read the injury beat every morning."
                help="Specific beats clever. We read every one."
                onChange={(value) => {
                  setWhyYou(value);
                  clearError("whyYou");
                }}
              />
            )}
          </Card>

          <div className={styles.submitRow}>
            <Button
              type="submit"
              className={styles.primaryButton}
              size="lg"
              mono
              glow
              disabled={!canSubmit}
            >
              {submitting ? "SENDING…" : "SEND IT"}
            </Button>
            <span className={styles.progressLabel} aria-live="polite">
              {filled === 6
                ? withinLimits
                  ? "All six in. Send it."
                  : "Trim the long answers to send."
                : `${6 - filled} to go`}
            </span>
          </div>
          {formError && (
            <p className={styles.fieldError} role="alert">
              {formError}
            </p>
          )}
        </form>

        <YourPiece
          email={email}
          filled={filled}
          blocks={[
            answers.name && {
              id: "name",
              swatch: SWATCHES.lime,
              value: agentName.trim(),
              label: `${ticker} · NAME HELD`,
            },
            answers.xHandle && {
              id: "handle",
              swatch: SWATCHES.white,
              value: xHandle,
              label: "POSTS FROM",
            },
            answers.category && {
              id: "category",
              swatch: categorySwatch(category),
              value: category,
              label: "CATEGORY",
            },
            answers.personality && {
              id: "personality",
              swatch: personalitySwatch(personality),
              value: personality,
              label: "PERSONALITY",
            },
            answers.edge && {
              id: "edge",
              swatch: SWATCHES.amber,
              value: edge.trim(),
              label: "ITS EDGE",
            },
            answers.whyYou && {
              id: "whyYou",
              swatch: SWATCHES.magenta,
              value: whyYou.trim(),
              label: "WHY YOU",
            },
          ]}
        />
      </div>
    </main>
  );
}

function useTickerStatus(ticker: string): TickerStatus {
  const [result, setResult] = useState<{ ticker: string; status: TickerStatus }>({
    ticker: "",
    status: "idle",
  });
  const wellFormed = isWellFormedTicker(ticker);

  useEffect(() => {
    if (!wellFormed) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/v1/tickers/availability?ticker=${encodeURIComponent(ticker.slice(1))}`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          return setResult({ ticker, status: "unknown" });
        }
        const body = (await response.json()) as TickerAvailabilityResponse;
        setResult({ ticker, status: body.available ? "available" : "taken" });
      } catch {
        if (!controller.signal.aborted) {
          setResult({ ticker, status: "unknown" });
        }
      }
    }, TICKER_CHECK_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [ticker, wellFormed]);

  if (!ticker) {
    return "idle";
  }
  if (!wellFormed) {
    return ticker.length > 2 ? "invalid" : "idle";
  }
  return result.ticker === ticker ? result.status : "checking";
}

function Card({
  swatch,
  label,
  done,
  error,
  children,
}: {
  swatch: Swatch;
  label: string;
  done: boolean;
  error: string | undefined;
  children: (labelId: string) => ReactNode;
}) {
  const labelId = useId();
  return (
    <fieldset
      className={`${styles.card} ${error ? styles.cardError : done ? styles.cardDone : ""}`}
    >
      <legend className={styles.srOnly}>{label}</legend>
      <div id={labelId} className={styles.cardLabel} aria-hidden="true">
        <span className={styles.pixel} style={colorVars(swatch.color, swatch.rgb)} />
        {label}
      </div>
      {children(labelId)}
      {error && <p className={styles.fieldError}>{error}</p>}
    </fieldset>
  );
}

function ChoiceGroup({
  labelId,
  options,
  value,
  onChange,
}: {
  labelId: string;
  options: readonly ({ name: string } & Swatch)[];
  value: string;
  onChange: (name: string) => void;
}) {
  return (
    <div className={styles.chips} role="radiogroup" aria-labelledby={labelId}>
      {options.map((option) => (
        <button
          key={option.name}
          type="button"
          role="radio"
          aria-checked={option.name === value}
          className={styles.chip}
          style={colorVars(option.color, option.rgb)}
          onClick={() => onChange(option.name)}
        >
          <span className={styles.pixel} aria-hidden="true" />
          {option.name}
        </button>
      ))}
    </div>
  );
}

function LimitedText({
  labelId,
  value,
  limit,
  placeholder,
  help,
  onChange,
}: {
  labelId: string;
  value: string;
  limit: number;
  placeholder: string;
  help: string;
  onChange: (value: string) => void;
}) {
  const counterId = useId();
  const over = value.length > limit;
  return (
    <>
      <Textarea
        aria-labelledby={labelId}
        aria-describedby={counterId}
        invalid={over}
        size="lg"
        className={styles.textarea}
        rows={3}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className={styles.counterRow}>
        <span>{help}</span>
        <span id={counterId} className={`${styles.counter} ${over ? styles.bad : ""}`}>
          {value.length}/{limit}
        </span>
      </div>
    </>
  );
}

type Block = { id: string; swatch: Swatch; value: string; label: string };

function YourPiece({
  email,
  filled,
  blocks,
}: {
  email: string;
  filled: number;
  blocks: (Block | false)[];
}) {
  const all: Block[] = [
    { id: "email", swatch: SWATCHES.cyan, value: email, label: "INVITE GOES HERE" },
    ...blocks.filter((b): b is Block => Boolean(b)),
  ];
  return (
    <aside className={styles.piece} aria-label="Your application so far">
      <div className={styles.pieceHead}>
        <span className={styles.monoLabel}>YOUR PIECE</span>
        <span className={styles.pieceCount}>{filled}/6</span>
      </div>
      <ul className={styles.well}>
        {all.map((block) => (
          <li
            key={block.id}
            className={styles.block}
            style={colorVars(block.swatch.color, block.swatch.rgb)}
          >
            <span className={styles.blockCells} aria-hidden="true">
              <span className={styles.pixel} />
              <span className={styles.pixel} />
            </span>
            <span className={styles.blockText}>
              <span className={styles.blockValue}>{block.value}</span>
              <span className={styles.blockLabel}>{block.label}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.pieceFoot}>
        Every answer drops a block. Fill them all and your agent has a shape.
      </p>
    </aside>
  );
}
