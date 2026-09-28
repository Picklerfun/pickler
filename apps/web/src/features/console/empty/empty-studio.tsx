"use client";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Icon, type IconName } from "@pickler/ui";
import {
  consoleApi,
  errorCode,
  type Agent,
  type Catalog,
  type Config,
  type RunEvent,
} from "../api";
import {
  BEATS,
  STEPS,
  emptyDraft,
  guessFrom,
  stepReady,
  toCreate,
  type Draft,
  type Sport,
  type Step,
} from "./draft";
import { CreateFlow } from "./create-flow";
import { DraftOverview } from "./draft-overview";
import { Piece } from "./piece";
import { PasskeySheet, type SheetKind } from "./passkey-sheet";
import shell from "../studio.module.css";
import styles from "./empty.module.css";

/** The rail, disabled: every section needs an agent, and there is not one yet. */
const RAIL: { title: string; items: { icon: IconName; label: string }[] }[] = [
  {
    title: "RUN",
    items: [
      { icon: "grid", label: "Overview" },
      { icon: "chat", label: "Context" },
      { icon: "target", label: "Picks" },
      { icon: "activity", label: "Activity" },
    ],
  },
  {
    title: "BUILD",
    items: [
      { icon: "file", label: "Brief" },
      { icon: "sliders", label: "Skills" },
      { icon: "wallet", label: "Limits & funding" },
      { icon: "user", label: "Identity & voice" },
    ],
  },
  {
    title: "GROW",
    items: [
      { icon: "globe", label: "Public profile" },
      { icon: "coin", label: "Token" },
    ],
  },
];

/**
 * The studio with no agent in it: the journey from nothing to a first one.
 *
 * It shares the top bar, the rail and the main frame with Studio v4 and then its main column is a
 * different thing — a stepped flow beside the piece it is building, and then a draft overview.
 *
 * Four of the five steps collect something the API stores, and the fifth creates the agent and
 * starts its first run for real. Everything after that — voice, X, the agent's wallet, funding it —
 * is drawn and inert, because none of it is built. See `draft.ts` for which is which.
 */
export function EmptyStudio({
  openPhase,
  catalog,
  defaults,
  canManage,
  owner,
  onCreated,
}: {
  /** Which half of the screen to open on. Only a dev-guarded link ever sets it. */
  openPhase?: "create" | "draft" | undefined;
  catalog: Catalog | null;
  defaults: Config | null;
  canManage: boolean;
  owner: string;
  /** Hands the studio the agent once it exists, so the shell can swap to Studio v4. */
  onCreated(id: string): void;
}) {
  const [phase, setPhase] = useState<"create" | "draft">(openPhase ?? "create");
  const [step, setStep] = useState<Step>("start");
  /* A link that opens on the draft half needs a draft to be about, so it carries the canvas's own.
     Nothing is saved: this is the same screen a person reaches by finishing the first half. */
  const [draft, setDraft] = useState<Draft>(() =>
    openPhase === "draft"
      ? {
          ...emptyDraft(),
          name: "Halftime",
          beat: "Sports",
          sports: ["american-football"],
          why: "It reads injury reports before the books move.",
        }
      : emptyDraft(),
  );
  const [filled, setFilled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [agentId, setAgentId] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);
  const [open, setOpen] = useState<string | null>("voice");
  const [voice, setVoice] = useState("");
  const [sheet, setSheet] = useState<SheetKind | null>(null);

  const sports = (catalog?.categories[0]?.subcategories ?? []) as { id: Sport; label: string }[];
  const beatSwatch = BEATS.find((beat) => beat.name === draft.beat)?.swatch ?? "none";
  const patch = useCallback((next: Partial<Draft>) => setDraft((was) => ({ ...was, ...next })), []);

  /* The canvas offers to fill the draft in from one sentence. Nothing reads a sentence, so this is
     a word match in the browser and the screen says so where the button is. */
  const fill = useCallback(() => {
    const guess = guessFrom(draft.prompt);
    setDraft((was) => ({
      ...was,
      name: guess.name,
      beat: guess.beat,
      why: guess.why,
      tickerTouched: false,
      sports: guess.beat === "Sports" ? ["american-football"] : [],
    }));
    setFilled(true);
    setStep("name");
  }, [draft.prompt]);

  /* The last step is the only one that touches the API: it creates the agent, then starts the first
     run that agent will ever have. The canvas runs before the agent exists; a run belongs to an
     agent, so it cannot. */
  const createAndRun = useCallback(async () => {
    if (!defaults) {
      setError("The studio has not loaded its defaults yet.");
      return;
    }
    setBusy(true);
    setRunning(true);
    setError("");
    try {
      let id = agentId;
      if (!id) {
        const created = await consoleApi<Agent>("/agents", {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(toCreate(draft, defaults)),
        });
        id = created.productId ?? created.id;
        setAgentId(id);
      }
      const run = await consoleApi<{ runId: string }>(`/agents/${id}/runs`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({}),
      });
      const trace = await consoleApi<{ events: RunEvent[] }>(`/runs/${run.runId}/events`);
      setEvents(trace.events);
      setRan(true);
    } catch (caught) {
      const code = errorCode(caught);
      setError(
        caught instanceof Error
          ? caught.message
          : `Could not create the agent${code ? ` (${code})` : ""}.`,
      );
      /* The agent may exist even though its first run was refused — quota, paused admissions, a
         workspace without research. Saying so beats offering to create it twice. */
      setRan(Boolean(agentId));
    } finally {
      setBusy(false);
      setRunning(false);
    }
  }, [agentId, defaults, draft]);

  const next = useCallback(() => {
    if (step === "run") {
      if (ran && agentId) {
        onCreated(agentId);
        setPhase("draft");
        return;
      }
      void createAndRun();
      return;
    }
    const index = STEPS.indexOf(step);
    if (stepReady(step, draft)) {
      setStep(STEPS[index + 1]!);
    }
  }, [agentId, createAndRun, draft, onCreated, ran, step]);

  return (
    <main className={shell.studio} data-surface="dark">
      <header className={shell.topbar}>
        <Link href="/" className={shell.brand}>
          <Image src="/brand/logo.png" alt="" width={22} height={22} priority />
          <span>PICKLER</span>
        </Link>
        {draft.name.trim() ? (
          <span className={styles.agentChip}>
            <span className={styles.agentMark} data-swatch={beatSwatch}>
              {draft.name.trim().slice(0, 2).toUpperCase()}
            </span>
            {draft.name.trim()}
          </span>
        ) : (
          <span className={styles.noAgent}>
            <span className={styles.noAgentMark}>+</span>
            No agent yet
          </span>
        )}
        {draft.name.trim() && (
          <span className={shell.status} data-tint="amber">
            <span className={shell.dot} />
            DRAFT · PRIVATE
          </span>
        )}
        <span className={shell.spacer} />
        <span className={shell.pill} data-quiet="true">
          TESTNET
        </span>
        <Link href="/account" className={shell.switcher} data-quiet="true">
          <span className={shell.swatch} aria-hidden="true">
            <i data-swatch="lime" />
            <i data-swatch="violet" />
            <i data-swatch="amber" />
            <i data-swatch="blue" />
          </span>
          {owner}
        </Link>
      </header>

      <div className={shell.body}>
        <nav className={shell.rail} data-wide={true} aria-label="Studio sections">
          <div className={shell.railGroups}>
            {RAIL.map((group) => (
              <div key={group.title}>
                <p className={shell.railTitle}>{group.title}</p>
                <div className={shell.railItems}>
                  {group.items.map((item) => (
                    <span
                      key={item.label}
                      className={styles.railLocked}
                      title="After you create your agent"
                    >
                      <Icon name={item.icon} size={17} />
                      {item.label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <div className={styles.main} id="studio-panel-empty">
          {!canManage && (
            <p className={styles.error} role="status">
              <Icon name="lock" size={13} />
              This workspace cannot create agents yet. An operator enables it by hand; the steps
              below still show what creating one asks for.
            </p>
          )}
          {phase === "create" ? (
            <>
              <CreateFlow
                step={step}
                draft={draft}
                sports={sports}
                busy={busy || !canManage}
                filled={filled}
                error={error}
                events={events}
                running={running}
                ran={ran}
                onStep={setStep}
                onDraft={patch}
                onFill={fill}
                onNext={next}
              />
              <Piece
                draft={draft}
                beatSwatch={beatSwatch}
                call={ran && !error ? "FIRST RUN STARTED" : ""}
                owner={owner}
              />
            </>
          ) : (
            <DraftOverview
              draft={draft}
              open={open}
              voice={voice}
              onOpen={setOpen}
              onVoice={setVoice}
              onSheet={setSheet}
              onStudio={() => agentId && onCreated(agentId)}
            />
          )}
        </div>
      </div>

      {sheet && <PasskeySheet kind={sheet} onClose={() => setSheet(null)} />}
    </main>
  );
}
