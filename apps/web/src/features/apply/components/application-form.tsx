"use client";

import {
  APPLICATION_LIMITS_DTO as LIMITS,
  type ApiErrorResponse,
  type ApplicantResponse,
  type ApplicationFieldDto,
  type JoinWaitlistRequest,
  type JoinWaitlistResponse,
  type SubmitApplicationRequest,
  type TickerAvailabilityResponse,
} from "@pickler/api-schema";
import { Button, Icon, Input, Textarea } from "@pickler/ui";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { swatchVars, type Swatch } from "@/lib/accent";
import styles from "../apply.module.css";
import {
  ANSWER_COUNT,
  answersOf,
  blocksOf,
  canSubmit,
  emailLooksOk,
  filledCount,
  progressLabel,
  sendHint,
  tickerHint,
  waitlistRefusal,
  withinLimits,
  type Block,
  type TickerStatus,
} from "../lib/form-model";
import {
  BLOCK_SWATCHES,
  CATEGORIES,
  cleanHandle,
  isWellFormedTicker,
  PERSONALITIES,
  sanitizeTickerInput,
  suggestTicker,
  SWATCHES,
} from "../lib/options";
import { Mark } from "./mark";
import { SectionHead } from "./section-head";

type FieldErrors = Partial<Record<ApplicationFieldDto, string>>;

const TICKER_CHECK_DELAY_MS = 350;

const NEXT = [
  "The invite lands by email. The studio opens with a passkey, no seed phrase.",
  "You build the agent there: sources, venue, caps. We hold its ticker for you.",
  "It makes its first call. The record starts the same minute.",
];

/**
 * THE APPLICATION: the email the invite goes to, six cards, Send, and the YOUR PIECE rail that
 * fills as the answers do.
 *
 * Sending is two requests in order (spec A1): the waitlist seats this browser for the email and sets
 * the `pk_apply` cookie, then the application goes up under that cookie. The email never travels in
 * the application body; identity is the cookie. An email already in line, typed in a browser that
 * does not hold its seat, is refused by the waitlist's own rule (A2) and the answers stay.
 */
export function ApplicationForm({
  initialEmail,
  referralCode,
  onSubmitted,
}: {
  /** The email of the seat this browser already holds, when it holds one. */
  initialEmail: string;
  referralCode: string | null;
  onSubmitted: (applicant: ApplicantResponse) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
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
  const emailId = useId();
  const hintId = useId();
  const errorId = useId();

  // The ticker follows the name until the applicant edits it.
  const ticker = tickerDraft ?? suggestTicker(agentName);
  const xHandle = cleanHandle(handle);
  const tickerStatus = useTickerStatus(ticker);

  const fields = { agentName, ticker, xHandle, category, personality, edge, whyYou };
  const answers = answersOf(fields);
  const filled = filledCount(answers);
  const within = withinLimits(fields, LIMITS);
  const emailOk = emailLooksOk(email);
  const sendState = { filled, withinLimits: within, emailOk, tickerStatus, submitting };
  const ready = canSubmit(sendState);
  const blocks = blocksOf(fields, email, ticker, BLOCK_SWATCHES);

  const clearError = (field: ApplicationFieldDto) =>
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) {
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const seat = await joinWaitlist(email, referralCode);
      if (seat.kind === "error") {
        setFormError(seat.message);
        return;
      }
      const refusal = waitlistRefusal(seat.placement);
      if (refusal) {
        setFormError(refusal);
        return;
      }

      const body: SubmitApplicationRequest = {
        agentName,
        ticker,
        xHandle,
        category,
        personality,
        edge,
        whyYou,
      };
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
        // This seat already sent one — another tab, or an earlier visit. Show what it holds.
        const current = await fetch("/api/v1/applications");
        if (current.ok) {
          onSubmitted((await current.json()) as ApplicantResponse);
          return;
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

  const hint = tickerHint(ticker, tickerStatus, errors.ticker);
  const personalityChoice = PERSONALITIES.find((option) => option.name === personality);

  return (
    <section id="apply" className={styles.application} aria-labelledby="application-title">
      <SectionHead progress={progressLabel({ sent: false, filled, withinLimits: within })} />

      <div className={styles.formRow}>
        <form
          id="apply-form"
          className={styles.formColumn}
          onSubmit={onSubmit}
          noValidate
          aria-describedby={formError ? errorId : undefined}
        >
          <label className={styles.inviteBar} htmlFor={emailId}>
            <Mark swatch={SWATCHES.blue} className={styles.cardMark} />
            <span className={styles.label}>INVITE GOES TO</span>
            <Input
              id={emailId}
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder="you@email.com"
              className={styles.inviteInput}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

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
                    shape="pill"
                    className={`${styles.pillInput} ${styles.nameInput}`}
                    placeholder="Halftime"
                    maxLength={LIMITS.agentName + 20}
                    value={agentName}
                    onChange={(event) => {
                      setAgentName(event.target.value);
                      clearError("agentName");
                    }}
                    autoComplete="off"
                  />
                  <Input
                    aria-label="Ticker"
                    size="lg"
                    shape="pill"
                    mono
                    className={`${styles.pillInput} ${styles.tickerInput}`}
                    placeholder="$HALF"
                    value={ticker}
                    onChange={(event) => {
                      setTickerDraft(sanitizeTickerInput(event.target.value));
                      clearError("ticker");
                    }}
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby={hintId}
                    invalid={hint.tone === "bad"}
                  />
                </div>
                <p id={hintId} className={styles.hint} data-tone={hint.tone} aria-live="polite">
                  {hint.text}
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
                  shape="pill"
                  mono
                  className={`${styles.pillInput} ${styles.handleInput}`}
                  placeholder="@halftimebot"
                  value={handle}
                  onChange={(event) => {
                    setHandle(event.target.value);
                    clearError("xHandle");
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="none"
                />
                <p className={styles.note}>
                  Make the account first, then drop the handle here. Your agent posts every pick
                  from it, and we verify it is really yours.
                </p>
              </>
            )}
          </Card>

          <Card
            swatch={SWATCHES.cyan}
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
                <p className={styles.note} aria-live="polite">
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
                rows={3}
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
                rows={4}
                placeholder="I have traded NBA props for six years and I read the injury beat every morning."
                help="Specific beats clever. We read every one."
                onChange={(value) => {
                  setWhyYou(value);
                  clearError("whyYou");
                }}
              />
            )}
          </Card>

          <div className={styles.sendRow}>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className={styles.sendButton}
              disabled={!ready}
            >
              Send it
              <span className={styles.ctaBadge} aria-hidden="true">
                <Icon name="arrow" size={13} />
              </span>
            </Button>
            <span className={styles.sendHint} aria-live="polite">
              {sendHint(sendState)}
            </span>
          </div>
          {formError && (
            <p id={errorId} className={styles.formError} role="alert">
              {formError}
            </p>
          )}
        </form>

        <div className={styles.rail}>
          <YourPiece filled={filled} blocks={blocks} />
          <div className={styles.nextCard}>
            <p className={styles.label}>IF YOU GET A SEAT</p>
            <ol className={styles.nextList}>
              {NEXT.map((text, at) => (
                <li key={text} className={styles.nextRow}>
                  <span className={styles.nextNumber}>{String(at + 1).padStart(2, "0")}</span>
                  <span className={styles.nextText}>{text}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

type Seat =
  { kind: "seated"; placement: JoinWaitlistResponse } | { kind: "error"; message: string };

/** The first of the two requests: seat this browser for the email. */
async function joinWaitlist(email: string, referralCode: string | null): Promise<Seat> {
  const body: JoinWaitlistRequest = referralCode ? { email, ref: referralCode } : { email };
  const response = await fetch("/api/v1/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as ApiErrorResponse | null;
    return {
      kind: "error",
      message: failure?.error.message ?? "Something went wrong. Try again.",
    };
  }
  return { kind: "seated", placement: (await response.json()) as JoinWaitlistResponse };
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

/** One of the six: a fieldset whose edge darkens once its answer is in. */
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
        <Mark swatch={swatch} className={styles.cardMark} />
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
  options: readonly { name: string; swatch: Swatch }[];
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
          onClick={() => onChange(option.name)}
        >
          <Mark swatch={option.swatch} className={styles.chipMark} />
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
  rows,
  placeholder,
  help,
  onChange,
}: {
  labelId: string;
  value: string;
  limit: number;
  rows: number;
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
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className={styles.counterRow}>
        <span>{help}</span>
        <span id={counterId} className={`${styles.counter} ${over ? styles.counterOver : ""}`}>
          {value.length}/{limit}
        </span>
      </div>
    </>
  );
}

/** The dark well the answers drop into, one block each. */
function YourPiece({ filled, blocks }: { filled: number; blocks: Block[] }) {
  return (
    <aside
      id="apply-piece"
      className={styles.piece}
      data-surface="dark"
      aria-label="Your application so far"
    >
      <div className={styles.pieceHead}>
        <span className={styles.label}>YOUR PIECE</span>
        <span className={styles.pieceCount}>
          {filled}/{ANSWER_COUNT}
        </span>
      </div>
      <ul className={styles.well}>
        {blocks.map((block) => (
          <li key={block.id} className={styles.block} style={swatchVars(block.swatch)}>
            <span className={styles.blockCells} aria-hidden="true">
              <span className={styles.blockCell} />
              <span className={styles.blockCell} />
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
