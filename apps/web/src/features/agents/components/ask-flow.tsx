"use client";

import type { AgentPersonaDto } from "@pickler/api-schema";
import Link from "next/link";
import { Button, Chip, Field, Icon, Tag, Textarea } from "@pickler/ui";
import { useState } from "react";
import { accentVars } from "@/lib/accent";
import { useWallet } from "@/features/wallet/lib/wallet-context";
import styles from "../agents.module.css";
import { AgentAvatar } from "./agent-parts";

const STEPS = ["COMPOSE", "REVIEW", "DELIVERY"] as const;

const venueLabel = (venue: AgentPersonaDto["venue"]) =>
  venue === "perps" ? "PERPL" : venue === "both" ? "PREDICTIONS + PERPL" : "PREDICTIONS";

/**
 * Asking an agent for a read: pick the market, see the question it will answer, then pay.
 *
 * The question is not written by the person asking. Every read on Pickler asks the same thing about
 * the market it names, which is what makes two answers comparable and what makes an agent's record
 * mean something. The context box is for what the agent should know, not for changing the question.
 */
export function AskFlow({ persona }: { persona: AgentPersonaDto }) {
  const wallet = useWallet();
  const service = persona.service;
  const [market, setMarket] = useState(service.markets[0]?.name ?? "");
  const [context, setContext] = useState("");
  const [step, setStep] = useState<0 | 1>(0);
  const [isPublic, setPublic] = useState(true);

  const question = service.markets.find((option) => option.name === market)?.question ?? "";

  return (
    <main
      className={`${styles.main} ${styles.mainNarrow} ${styles.askMain}`}
      style={accentVars(persona.accent)}
    >
      {step === 0 ? (
        <Link href={`/agents/${persona.handle}`} className={styles.backLink}>
          <Icon name="arrowLeft" size={14} /> {persona.name.toUpperCase()}
        </Link>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          mono
          className={styles.backButton}
          onClick={() => setStep(0)}
        >
          <Icon name="arrowLeft" size={14} /> EDIT
        </Button>
      )}

      <ol className={styles.askSteps}>
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={styles.askStep}
            data-state={i === step ? "on" : i < step ? "done" : "ahead"}
          >
            <span className={styles.askStepNumber}>{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <header className={styles.askAgent}>
        <AgentAvatar name={persona.name} accent={persona.accent} />
        <span className={styles.askAgentName}>
          <strong>{persona.name}</strong>
          <span className={styles.quiet}>
            {persona.beat.toUpperCase()} · {venueLabel(persona.venue)}
          </span>
        </span>
        <span className={styles.askAgentPrice}>
          <strong>${service.price}</strong>
          <span className={styles.quiet}>answers in {service.typical}</span>
        </span>
      </header>

      {step === 0 ? (
        <div className={styles.askStack}>
          <section className={styles.panel}>
            <p className={styles.label}>MARKET</p>
            <div className={styles.askChoices} role="group" aria-label="Market">
              {service.markets.map((option) => (
                <Chip
                  key={option.name}
                  className={styles.askChip}
                  selected={option.name === market}
                  onClick={() => setMarket(option.name)}
                >
                  {option.name}
                </Chip>
              ))}
            </div>

            <p className={`${styles.label} ${styles.askLabelSpaced}`}>HORIZON</p>
            <div className={styles.askChoices}>
              <Tag className={`${styles.askChip} ${styles.askChipOn}`}>24h</Tag>
              <Tag className={styles.askChipSoon}>4h · SOON</Tag>
              <Tag className={styles.askChipSoon}>7d · SOON</Tag>
            </div>
          </section>

          <section className={styles.askQuestion}>
            <p className={styles.label}>QUESTION</p>
            <p className={styles.askQuestionText}>{question}</p>
            <p className={styles.quiet}>clock starts at delivery · equal counts as no</p>
          </section>

          <section className={styles.panel}>
            <Field label="CONTEXT · OPTIONAL">
              <Textarea
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Anything it should know. It cannot change the question."
                rows={3}
                maxLength={400}
              />
            </Field>
          </section>

          <div className={styles.askFoot}>
            <Button className={styles.askButton} onClick={() => setStep(1)}>
              Continue
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.askStack}>
          <section className={styles.panel}>
            <dl className={styles.askReview}>
              <ReviewRow label="AGENT" value={`${persona.name} · paid read`} />
              <ReviewRow label="QUESTION" value={question} />
              <ReviewRow
                label="YOU GET"
                value={`Probability, reasons, sources · within ${service.sla}`}
              />
              <ReviewRow
                label="THEN"
                value={`Pickler checks ${market} 24h after delivery and writes the result on the card`}
              />
              <ReviewRow label="CONTEXT" value={context.trim() || "none"} />
              <div className={styles.askReviewRow}>
                <dt className={styles.label}>VISIBILITY</dt>
                <dd className={styles.askChoices}>
                  <Chip
                    className={styles.askChip}
                    selected={isPublic}
                    onClick={() => setPublic(true)}
                  >
                    PUBLIC CARD
                  </Chip>
                  <Chip
                    className={styles.askChip}
                    selected={!isPublic}
                    onClick={() => setPublic(false)}
                  >
                    AGGREGATE ONLY
                  </Chip>
                </dd>
              </div>
            </dl>
          </section>

          <section className={styles.askPay}>
            <span className={styles.askPayPrice}>
              <strong>
                ${service.price} <span className={styles.quiet}>AUSD</span>
              </strong>
              <span className={styles.quiet}>
                refunded if not delivered in {service.sla} · not a trading permission
              </span>
            </span>
            {/* A wallet can connect today; paying cannot happen until the testnet contracts are
                deployed, so the button says which of the two is missing. */}
            {wallet.status === "connected" ? (
              <Button className={styles.askButton} disabled aria-describedby="ask-status">
                Pay ${service.price}
              </Button>
            ) : (
              <Button
                variant="secondary"
                className={styles.askConnect}
                onClick={() => void wallet.connect()}
                disabled={wallet.status === "connecting"}
              >
                {wallet.status === "connecting" ? "Waiting for your wallet…" : "Connect wallet"}
              </Button>
            )}
          </section>
          <p id="ask-status" className={styles.quiet}>
            {wallet.status === "connected"
              ? "Paid reads open with the testnet contracts. Nothing is charged today, and no agent is queued."
              : "Connect the wallet that will pay for this read. Nothing is charged today."}
          </p>
        </div>
      )}
    </main>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.askReviewRow}>
      <dt className={styles.label}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
